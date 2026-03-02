from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from .anomaly import InMemoryStore
from .guard import create_guard
from .migrate_rolepack import migrate_rolepack_json_to_policy_markdown
from .policy import compile_policy


def usage(exit_code: int = 0) -> None:
    text = "\n".join(
        [
            "Twire CLI",
            "",
            "Commands:",
            "  twire policy compile --in policy.policy.md --out policy.json",
            "  twire policy migrate --in rolepack.json --out policy.policy.md",
            "  twire eval --policy policy.policy.md --in events.jsonl [--out results.jsonl]",
            "  twire replay --policy policy.policy.md --in events.jsonl --report report.json",
        ]
    )
    sys.stdout.write(f"{text}\n")
    raise SystemExit(exit_code)


def parse_args(argv: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}

    i = 0
    while i < len(argv):
        token = argv[i]
        if not token.startswith("--"):
            i += 1
            continue

        key = token[2:]
        next_token = argv[i + 1] if (i + 1) < len(argv) else None
        if next_token is None or next_token.startswith("--"):
            out[key] = "true"
            i += 1
            continue

        out[key] = next_token
        i += 2

    return out


def load_compiled_policy(path: str) -> dict[str, Any]:
    raw = Path(path).read_text(encoding="utf-8")
    if path.endswith(".json"):
        return json.loads(raw)
    return compile_policy(raw)


def read_jsonl(path: str) -> list[Any]:
    text = Path(path).read_text(encoding="utf-8")
    lines = [line.strip() for line in text.splitlines()]
    return [json.loads(line) for line in lines if line]


def as_context(input_value: Any) -> dict[str, Any]:
    row = input_value if isinstance(input_value, dict) else {}
    actor = row.get("actor") if isinstance(row.get("actor"), dict) else {}
    destination = row.get("destination") if isinstance(row.get("destination"), dict) else {}
    metadata = row.get("meta") if isinstance(row.get("meta"), dict) else None

    tool_name = row.get("toolName") if isinstance(row.get("toolName"), str) else row.get("tool")
    if not isinstance(tool_name, str):
        tool_name = "unknown"

    return {
        "ts": row.get("ts") if isinstance(row.get("ts"), str) else None,
        "session_id": row.get("session") if isinstance(row.get("session"), str) else None,
        "actor_id": actor.get("id") if isinstance(actor.get("id"), str) else None,
        "actor_type": actor.get("type") if isinstance(actor.get("type"), str) else None,
        "tool_name": tool_name,
        "text": row.get("text") if isinstance(row.get("text"), str) else None,
        "intent": row.get("intent") if isinstance(row.get("intent"), str) else None,
        "args": row.get("args"),
        "destination": {
            "domain": destination.get("domain") if isinstance(destination.get("domain"), str) else None,
            "url": destination.get("url") if isinstance(destination.get("url"), str) else None,
        }
        if destination
        else None,
        "metadata": metadata,
    }


async def evaluate_events(policy: dict[str, Any], events: list[Any]) -> list[dict[str, Any]]:
    guard = create_guard({"policy": policy, "store": InMemoryStore()})
    results: list[dict[str, Any]] = []

    for i, event in enumerate(events):
        context = as_context(event)
        result = await guard.before_tool_call(context)
        results.append({"index": i, "result": result})

    return results


def make_replay_report(policy: dict[str, Any], evaluations: list[dict[str, Any]]) -> dict[str, Any]:
    totals = {"events": len(evaluations), "allow": 0, "require_approval": 0, "block": 0}
    findings_by_category: dict[str, int] = {}
    top_rules: dict[str, int] = {}
    anomaly_scores: list[float] = []

    for entry in evaluations:
        result = entry["result"]
        decision = result.get("decision")
        if decision in totals:
            totals[decision] += 1

        anomaly = result.get("anomaly") if isinstance(result.get("anomaly"), dict) else {}
        anomaly_scores.append(float(anomaly.get("score", 0)))

        findings = result.get("findings") if isinstance(result.get("findings"), list) else []
        for finding in findings:
            if not isinstance(finding, dict):
                continue
            category = str(finding.get("category", "unknown"))
            rule_id = str(finding.get("rule_id", "unknown"))
            findings_by_category[category] = findings_by_category.get(category, 0) + 1
            top_rules[rule_id] = top_rules.get(rule_id, 0) + 1

    top_rule_entries = [
        {"rule_id": rule_id, "hits": hits}
        for rule_id, hits in sorted(top_rules.items(), key=lambda item: item[1], reverse=True)[:10]
    ]

    average_score = 0.0 if len(anomaly_scores) == 0 else (sum(anomaly_scores) / len(anomaly_scores))

    return {
        "policy_id": policy.get("id"),
        "totals": totals,
        "findings_by_category": findings_by_category,
        "top_rules": top_rule_entries,
        "anomaly": {
            "average_score": round(average_score, 4),
            "max_score": round(max([0.0] + anomaly_scores), 4),
            "escalated_decisions": len([entry for entry in evaluations if entry["result"].get("escalated_by_anomaly")]),
        },
    }


async def _main_async(argv: list[str]) -> None:
    if not argv:
        usage(1)

    command = argv[0]
    subcommand = argv[1] if len(argv) > 1 else None
    rest = argv[2:] if len(argv) > 2 else []

    if command in ("-h", "--help"):
        usage(0)

    if command == "policy":
        args = parse_args(rest)

        if subcommand == "compile":
            if not args.get("in") or not args.get("out"):
                usage(1)
            markdown = Path(args["in"]).read_text(encoding="utf-8")
            compiled = compile_policy(markdown)
            Path(args["out"]).write_text(f"{json.dumps(compiled, indent=2)}\n", encoding="utf-8")
            return

        if subcommand == "migrate":
            if not args.get("in") or not args.get("out"):
                usage(1)
            raw = json.loads(Path(args["in"]).read_text(encoding="utf-8"))
            markdown = migrate_rolepack_json_to_policy_markdown(raw)
            Path(args["out"]).write_text(f"{markdown.rstrip()}\n", encoding="utf-8")
            return

        usage(1)

    if command == "eval":
        args = parse_args(([subcommand] if subcommand else []) + rest)
        if not args.get("policy") or not args.get("in"):
            usage(1)

        policy = load_compiled_policy(args["policy"])
        events = read_jsonl(args["in"])
        results = await evaluate_events(policy, events)
        output = "\n".join(json.dumps(entry) for entry in results)

        if args.get("out"):
            Path(args["out"]).write_text(f"{output}{'\n' if output else ''}", encoding="utf-8")
            return

        sys.stdout.write(f"{output}{'\n' if output else ''}")
        return

    if command == "replay":
        args = parse_args(([subcommand] if subcommand else []) + rest)
        if not args.get("policy") or not args.get("in"):
            usage(1)

        policy = load_compiled_policy(args["policy"])
        events = read_jsonl(args["in"])
        results = await evaluate_events(policy, events)
        report = make_replay_report(policy, results)

        if args.get("report"):
            Path(args["report"]).write_text(f"{json.dumps(report, indent=2)}\n", encoding="utf-8")
            return

        sys.stdout.write(f"{json.dumps(report, indent=2)}\n")
        return

    usage(1)


def main() -> None:
    try:
        asyncio.run(_main_async(sys.argv[1:]))
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:  # pragma: no cover
        sys.stderr.write(f"{error}\n")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
