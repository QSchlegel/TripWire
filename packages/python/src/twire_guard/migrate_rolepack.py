from __future__ import annotations

from typing import Any

import yaml


def _to_action(severity: str | None) -> str:
    if severity == "high":
        return "block"
    if severity == "med":
        return "require_approval"
    return "allow"


def _yaml_dump(value: Any) -> str:
    return yaml.safe_dump(value, sort_keys=False, width=1000).strip()


def migrate_rolepack_json_to_policy_markdown(raw: dict[str, Any]) -> str:
    name = raw.get("name") if isinstance(raw.get("name"), str) else None
    policy_id = f"tripwire.{name}" if name else "tripwire.migrated"

    frontmatter = _yaml_dump(
        {
            "id": policy_id,
            "version": raw.get("version") if isinstance(raw.get("version"), (int, float)) else 1,
            "mode": "enforce",
            "defaults": {
                "action": "allow",
                "severity": "low",
                "confidence": 0.75,
            },
            "tags": [name, "migrated"] if name else ["migrated"],
        }
    )

    rules = raw.get("rules") if isinstance(raw.get("rules"), list) else []
    rule_blocks: list[str] = []

    for rule in rules:
        if not isinstance(rule, dict):
            continue

        severity = rule.get("severity") if isinstance(rule.get("severity"), str) else "med"
        match = rule.get("match") if isinstance(rule.get("match"), dict) else {}

        content = {
            "id": rule.get("id"),
            "title": rule.get("title"),
            "category": rule.get("category") if isinstance(rule.get("category"), str) else "other",
            "severity": severity,
            "action": _to_action(severity),
            "confidence": rule.get("confidence"),
            "why": rule.get("why") if isinstance(rule.get("why"), str) else "Migrated from legacy rolepack",
            "suggestion": (
                rule.get("suggestion")
                if isinstance(rule.get("suggestion"), str)
                else "Review and tune this migrated rule"
            ),
            "match": {
                "text": {
                    "regex": match.get("pattern") if isinstance(match.get("pattern"), str) else ".*",
                    "flags": match.get("flags") if isinstance(match.get("flags"), str) else "i",
                }
            },
        }

        rule_blocks.append(f"\n```rule\n{_yaml_dump(content)}\n```")

    anomaly_defaults = [
        {
            "id": "anomaly.burst.medium",
            "metric": "burst",
            "threshold": 4,
            "windowMs": 20000,
            "action": "require_approval",
            "weight": 0.2,
            "why": "Unexpected rapid tool call burst",
        },
        {
            "id": "anomaly.frequency.high",
            "metric": "frequency_zscore",
            "threshold": 4,
            "action": "block",
            "weight": 0.35,
            "why": "Tool call cadence is far outside baseline",
        },
    ]

    anomaly_blocks = [f"\n```anomaly\n{_yaml_dump(anomaly)}\n```" for anomaly in anomaly_defaults]

    description = raw.get("description") if isinstance(raw.get("description"), str) else "Migrated TripWire policy"
    return f"---\n{frontmatter}\n---\n\n# {policy_id}\n\n{description}\n{''.join(rule_blocks + anomaly_blocks)}"
