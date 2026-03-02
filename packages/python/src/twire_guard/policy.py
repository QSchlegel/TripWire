from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from urllib import request

import yaml

from .errors import PolicyCompileError
from .utils import compile_regex

NON_DOWNGRADABLE_CATEGORIES = {"secrets", "wallet", "irreversible"}


def _locate(text: str, offset: int) -> tuple[int, int]:
    snippet = text[:offset]
    lines = snippet.splitlines() or [""]
    line = len(lines)
    if snippet.endswith("\n"):
        line += 1
        column = 1
    else:
        column = len(lines[-1]) + 1
    return line, column


def _fail(message: str, code: str, text: str, offset: int) -> None:
    line, column = _locate(text, max(0, offset))
    raise PolicyCompileError(message, code, line, column)


def _as_object(input_value: Any) -> dict[str, Any]:
    if isinstance(input_value, dict):
        return input_value
    return {}


def _extract_frontmatter(markdown: str) -> tuple[str, str]:
    if not markdown.startswith("---\n"):
        _fail(
            "Policy must start with YAML frontmatter fenced by ---",
            "frontmatter_missing",
            markdown,
            0,
        )

    closing = markdown.find("\n---\n", 4)
    trailing = markdown.find("\n---", 4)
    close_idx = closing if closing >= 0 else trailing

    if close_idx < 0:
        _fail("Frontmatter is not closed with ---", "frontmatter_unclosed", markdown, 0)

    frontmatter = markdown[4:close_idx]
    body = markdown[close_idx + 5 :]
    return frontmatter, body


def _parse_blocks(body: str, original: str, body_offset: int) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    regex = re.compile(r"```(rule|anomaly)\s*\n([\s\S]*?)```")

    for match in regex.finditer(body):
        block_type = match.group(1)
        content = match.group(2) or ""
        offset = body_offset + match.start()
        blocks.append({"type": block_type, "content": content, "offset": offset})

    if len(blocks) == 0:
        _fail("Policy must contain at least one ```rule``` block", "rule_missing", original, body_offset)

    return blocks


def _as_severity(value: Any, markdown: str, offset: int) -> str:
    if value in ("low", "med", "high"):
        return str(value)
    _fail("Rule severity must be one of low|med|high", "rule_severity_invalid", markdown, offset)
    raise AssertionError("unreachable")


def _as_action(value: Any, markdown: str, offset: int) -> str:
    if value in ("allow", "require_approval", "block"):
        return str(value)
    _fail(
        "Rule action must be one of allow|require_approval|block",
        "rule_action_invalid",
        markdown,
        offset,
    )
    raise AssertionError("unreachable")


def _as_metric(value: Any, markdown: str, offset: int) -> str:
    allowed = {
        "frequency_zscore",
        "burst",
        "novel_tool",
        "novel_domain",
        "novel_template",
        "arg_shape_drift",
    }
    if value in allowed:
        return str(value)

    _fail(
        "Anomaly metric must be frequency_zscore|burst|novel_tool|novel_domain|novel_template|arg_shape_drift",
        "anomaly_metric_invalid",
        markdown,
        offset,
    )
    raise AssertionError("unreachable")


def _validate_regex(value: dict[str, Any], markdown: str, offset: int) -> dict[str, Any]:
    regex = value.get("regex")
    flags = value.get("flags")

    if not isinstance(regex, str) or regex == "":
        _fail("Regex matcher requires a non-empty regex field", "regex_missing", markdown, offset)

    if flags is not None and not isinstance(flags, str):
        _fail("Regex flags must be a string", "regex_flags_invalid", markdown, offset)

    try:
        compile_regex(regex, flags)
    except Exception:
        _fail(f"Invalid regular expression: {regex}", "regex_invalid", markdown, offset)

    out: dict[str, Any] = {"regex": regex}
    if flags is not None:
        out["flags"] = flags
    return out


def _parse_match(raw: Any, markdown: str, offset: int) -> dict[str, Any]:
    input_value = _as_object(raw)
    match: dict[str, Any] = {}

    tool = input_value.get("tool")
    if isinstance(tool, str) or isinstance(tool, list):
        match["tool"] = tool

    text = input_value.get("text")
    if text is not None:
        if isinstance(text, str):
            match["text"] = _validate_regex({"regex": text}, markdown, offset)
        else:
            match["text"] = _validate_regex(_as_object(text), markdown, offset)

    intent = input_value.get("intent")
    if intent is not None:
        if isinstance(intent, str):
            match["intent"] = _validate_regex({"regex": intent}, markdown, offset)
        else:
            match["intent"] = _validate_regex(_as_object(intent), markdown, offset)

    arg = input_value.get("arg")
    if arg is not None:
        parsed_arg = _as_object(arg)
        path = parsed_arg.get("path")

        if not isinstance(path, str) or path == "":
            _fail("arg matcher requires a non-empty path", "arg_path_missing", markdown, offset)

        arg_match: dict[str, Any] = {"path": path}

        if "eq" in parsed_arg:
            arg_match["eq"] = parsed_arg.get("eq")

        if "regex" in parsed_arg:
            regex = parsed_arg.get("regex")
            if not isinstance(regex, str):
                _fail("arg.regex must be a string", "arg_regex_invalid", markdown, offset)
            arg_match["regex"] = regex

            flags = parsed_arg.get("flags")
            if flags is not None:
                if not isinstance(flags, str):
                    _fail("arg.flags must be a string", "arg_flags_invalid", markdown, offset)
                arg_match["flags"] = flags

            try:
                compile_regex(regex, arg_match.get("flags"))
            except Exception:
                _fail(
                    "arg.regex is not a valid regular expression",
                    "arg_regex_compile_error",
                    markdown,
                    offset,
                )

        match["arg"] = arg_match

    destination = input_value.get("destination")
    if destination is not None:
        parsed_destination = _as_object(destination)
        domain = parsed_destination.get("domain")

        if not isinstance(domain, str) and not isinstance(domain, list):
            _fail(
                "destination matcher requires domain as string or string[]",
                "destination_domain_invalid",
                markdown,
                offset,
            )

        match["destination"] = {"domain": domain}

    if not any(k in match for k in ("tool", "text", "intent", "arg", "destination")):
        _fail("rule match must include at least one matcher", "rule_match_empty", markdown, offset)

    return match


def _ensure_no_unsafe_broad_allow(rule: dict[str, Any], markdown: str, offset: int) -> None:
    if rule.get("action") != "allow":
        return

    text_match = _as_object(_as_object(rule.get("match")).get("text"))
    text_regex = str(text_match.get("regex", "")).strip()
    is_broad = text_regex in {".*", "^.*$", "[\\s\\S]*"}
    if not is_broad:
        return

    match = _as_object(rule.get("match"))
    has_scope = bool(match.get("tool") or match.get("arg") or match.get("destination") or match.get("intent"))
    if has_scope:
        return

    _fail(
        "Broad allow regex patterns require scoped constraints (tool/arg/destination/intent)",
        "broad_allow_unsafe",
        markdown,
        offset,
    )


def _parse_rule(block: dict[str, Any], markdown: str) -> dict[str, Any]:
    try:
        raw = yaml.safe_load(block["content"])
    except Exception:
        _fail("Failed to parse rule block YAML", "rule_yaml_invalid", markdown, block["offset"])

    input_value = _as_object(raw)

    if not isinstance(input_value.get("id"), str) or input_value.get("id") == "":
        _fail("Rule requires id", "rule_id_missing", markdown, block["offset"])

    if not isinstance(input_value.get("category"), str) or input_value.get("category") == "":
        _fail("Rule requires category", "rule_category_missing", markdown, block["offset"])

    if not isinstance(input_value.get("why"), str) or input_value.get("why") == "":
        _fail("Rule requires why", "rule_why_missing", markdown, block["offset"])

    if not isinstance(input_value.get("suggestion"), str) or input_value.get("suggestion") == "":
        _fail("Rule requires suggestion", "rule_suggestion_missing", markdown, block["offset"])

    severity = _as_severity(input_value.get("severity"), markdown, block["offset"])
    action = _as_action(input_value.get("action"), markdown, block["offset"])

    confidence = input_value.get("confidence")
    rule = {
        "id": input_value["id"],
        "title": input_value.get("title") if isinstance(input_value.get("title"), str) else None,
        "category": input_value["category"],
        "severity": severity,
        "action": action,
        "confidence": float(confidence) if isinstance(confidence, (int, float)) else None,
        "why": input_value["why"],
        "suggestion": input_value["suggestion"],
        "match": _parse_match(input_value.get("match"), markdown, block["offset"]),
    }

    if rule["category"] in NON_DOWNGRADABLE_CATEGORIES and rule["action"] == "allow":
        _fail(
            f"Category {rule['category']} cannot be downgraded to allow action",
            "category_non_downgradable",
            markdown,
            block["offset"],
        )

    _ensure_no_unsafe_broad_allow(rule, markdown, block["offset"])
    return rule


def _parse_anomaly(block: dict[str, Any], markdown: str) -> dict[str, Any]:
    try:
        raw = yaml.safe_load(block["content"])
    except Exception:
        _fail("Failed to parse anomaly block YAML", "anomaly_yaml_invalid", markdown, block["offset"])

    input_value = _as_object(raw)

    if not isinstance(input_value.get("id"), str) or input_value.get("id") == "":
        _fail("Anomaly rule requires id", "anomaly_id_missing", markdown, block["offset"])

    metric = _as_metric(input_value.get("metric"), markdown, block["offset"])
    action = _as_action(input_value.get("action"), markdown, block["offset"])

    if str(input_value.get("category", "")) in NON_DOWNGRADABLE_CATEGORIES and action == "allow":
        _fail(
            "Non-downgradable categories cannot use allow action",
            "anomaly_action_invalid",
            markdown,
            block["offset"],
        )

    threshold = input_value.get("threshold")
    window_ms = input_value.get("windowMs", input_value.get("window_ms"))
    weight = input_value.get("weight")

    return {
        "id": input_value["id"],
        "metric": metric,
        "threshold": float(threshold) if isinstance(threshold, (int, float)) else None,
        "window_ms": float(window_ms) if isinstance(window_ms, (int, float)) else None,
        "action": action,
        "weight": float(weight) if isinstance(weight, (int, float)) else None,
        "why": input_value.get("why") if isinstance(input_value.get("why"), str) else None,
    }


def _parse_mode(value: Any) -> str:
    if value in ("monitor", "enforce"):
        return str(value)
    return "enforce"


def _parse_defaults(value: Any, markdown: str) -> dict[str, Any]:
    defaults_input = _as_object(value)
    defaults: dict[str, Any] = {}

    if "severity" in defaults_input:
        defaults["severity"] = _as_severity(defaults_input.get("severity"), markdown, 0)

    if "action" in defaults_input:
        defaults["action"] = _as_action(defaults_input.get("action"), markdown, 0)

    if "confidence" in defaults_input:
        confidence = defaults_input.get("confidence")
        if not isinstance(confidence, (int, float)):
            _fail("defaults.confidence must be a number", "defaults_confidence_invalid", markdown, 0)
        defaults["confidence"] = float(confidence)

    return defaults


def compile_policy(markdown: str) -> dict[str, Any]:
    frontmatter, body = _extract_frontmatter(markdown)

    try:
        parsed_fm = yaml.safe_load(frontmatter)
    except Exception:
        _fail("Frontmatter YAML is invalid", "frontmatter_yaml_invalid", markdown, 0)

    fm = _as_object(parsed_fm)

    if not isinstance(fm.get("id"), str) or fm.get("id") == "":
        _fail("Frontmatter requires id", "frontmatter_id_missing", markdown, 0)

    if not isinstance(fm.get("version"), (int, float)):
        _fail("Frontmatter requires numeric version", "frontmatter_version_missing", markdown, 0)

    body_offset = markdown.find(body)
    blocks = _parse_blocks(body, markdown, body_offset)

    rules: list[dict[str, Any]] = []
    anomaly_rules: list[dict[str, Any]] = []

    for block in blocks:
        if block["type"] == "rule":
            rules.append(_parse_rule(block, markdown))
        else:
            anomaly_rules.append(_parse_anomaly(block, markdown))

    tags = fm.get("tags") if isinstance(fm.get("tags"), list) else []

    return {
        "id": fm["id"],
        "version": int(fm["version"]),
        "mode": _parse_mode(fm.get("mode")),
        "tags": [str(tag) for tag in tags],
        "defaults": _parse_defaults(fm.get("defaults"), markdown),
        "rules": rules,
        "anomaly_rules": anomaly_rules,
    }


def _is_url(input_value: str) -> bool:
    return bool(re.match(r"^[a-zA-Z][a-zA-Z\d+.-]*:", input_value))


def load_policy(path_or_url: str) -> dict[str, Any]:
    markdown: str

    if _is_url(path_or_url):
        with request.urlopen(path_or_url) as response:
            markdown = response.read().decode("utf-8")
    else:
        path = Path(path_or_url)
        if path.exists():
            markdown = path.read_text(encoding="utf-8")
        else:
            with request.urlopen(path_or_url) as response:
                markdown = response.read().decode("utf-8")

    compiled = compile_policy(markdown)
    compiled["source"] = path_or_url
    return compiled
