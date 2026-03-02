from __future__ import annotations

from typing import Any

from .decision import severity_to_decision
from .utils import compile_regex, get_by_path


def _as_array(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    return [str(value)]


def _resolve_action(rule_action: str | None, fallback_action: str) -> str:
    return rule_action or fallback_action


def _matches_text(text: str, matcher: dict[str, Any] | None) -> bool:
    if matcher is None:
        return True
    return bool(compile_regex(str(matcher["regex"]), matcher.get("flags"), default_insensitive=True).search(text))


def _matches_intent(intent: str, matcher: dict[str, Any] | None) -> bool:
    if matcher is None:
        return True
    return bool(compile_regex(str(matcher["regex"]), matcher.get("flags"), default_insensitive=True).search(intent))


def _matches_tool(tool_name: str, matcher: str | list[str] | None) -> bool:
    if matcher is None:
        return True
    allowed = [item.lower() for item in _as_array(matcher)]
    return tool_name.lower() in allowed


def _matches_arg(args: Any, matcher: dict[str, Any] | None) -> bool:
    if matcher is None:
        return True

    value = get_by_path(args, str(matcher.get("path", "")))

    if "eq" in matcher:
        return value == matcher.get("eq")

    regex = matcher.get("regex")
    if isinstance(regex, str):
        return bool(
            compile_regex(regex, matcher.get("flags"), default_insensitive=True).search(
                "" if value is None else str(value)
            )
        )

    return value is not None


def _matches_destination(domain: str | None, matcher: dict[str, Any] | None) -> bool:
    if matcher is None or matcher.get("domain") is None:
        return True

    expected = [item.lower() for item in _as_array(matcher.get("domain"))]
    if not domain:
        return False

    lower = domain.lower()
    return any(lower == candidate or lower.endswith(f".{candidate}") for candidate in expected)


def _matched_keys(event: dict[str, Any], match: dict[str, Any]) -> list[str]:
    keys: list[str] = []

    if match.get("tool") is not None and _matches_tool(str(event["tool_name"]), match.get("tool")):
        keys.append("tool")
    if match.get("text") is not None and _matches_text(str(event["text"]), match.get("text")):
        keys.append("text")
    if match.get("intent") is not None and _matches_intent(str(event["intent"]), match.get("intent")):
        keys.append("intent")
    if match.get("arg") is not None and _matches_arg(event.get("args"), match.get("arg")):
        keys.append(f"arg:{match['arg']['path']}")
    if match.get("destination") is not None and _matches_destination(event.get("destination_domain"), match.get("destination")):
        keys.append("destination")

    return keys


def evaluate_policy(event: dict[str, Any], policy: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []

    for rule in policy.get("rules", []):
        match = rule.get("match", {})

        criteria_pass = (
            _matches_tool(str(event["tool_name"]), match.get("tool"))
            and _matches_text(str(event.get("text", "")), match.get("text"))
            and _matches_intent(str(event.get("intent", "")), match.get("intent"))
            and _matches_arg(event.get("args"), match.get("arg"))
            and _matches_destination(event.get("destination_domain"), match.get("destination"))
        )

        if not criteria_pass:
            continue

        fallback_decision = severity_to_decision(str(rule.get("severity", "low")))
        finding_action = _resolve_action(rule.get("action"), fallback_decision)

        defaults = policy.get("defaults", {}) if isinstance(policy.get("defaults"), dict) else {}
        confidence = rule.get("confidence")
        if not isinstance(confidence, (int, float)):
            default_confidence = defaults.get("confidence")
            confidence = float(default_confidence) if isinstance(default_confidence, (int, float)) else 0.75

        findings.append(
            {
                "event_id": event["event_id"],
                "rule_id": rule["id"],
                "title": rule.get("title") or rule["id"],
                "category": rule["category"],
                "severity": rule["severity"],
                "action": finding_action,
                "confidence": confidence,
                "why": rule["why"],
                "suggestion": rule["suggestion"],
                "matched_on": _matched_keys(event, match),
            }
        )

    return findings
