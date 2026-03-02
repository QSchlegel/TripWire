from __future__ import annotations

import asyncio

from twire_guard import InMemoryStore, compile_policy, create_guard

SAMPLE_POLICY = """---
id: tripwire.test
version: 1
mode: enforce
defaults:
  action: allow
  severity: low
  confidence: 0.8
tags:
  - test
---

```rule
id: secrets.detect
category: secrets
severity: high
action: block
why: Prevent secret leakage
suggestion: Remove credentials
match:
  text:
    regex: "(api[_-]?key|secret|token)"
```

```rule
id: deploy.guard
category: external_side_effect
severity: med
action: require_approval
why: Deploy actions should be reviewed
suggestion: Ask for human approval
match:
  tool:
    - deploy
  text:
    regex: "deploy|apply"
```

```anomaly
id: anomaly.burst.guard
metric: burst
threshold: 3
action: require_approval
weight: 0.25
why: Rapid burst of commands is unusual
```
"""

STRICT_UNSUPPORTED_POLICY = """---
id: tripwire.strict
version: 1
mode: enforce
defaults:
  action: block
  severity: low
  confidence: 0.8
tags:
  - strict
---

```rule
id: allow.read
category: external_side_effect
severity: low
action: allow
why: Explicitly supported read operation.
suggestion: Continue.
match:
  tool:
    - read
```

```rule
id: block.destructive.exec
category: irreversible
severity: high
action: block
why: Destructive shell actions are explicitly blocked.
suggestion: Use safer alternatives.
match:
  tool:
    - exec
  text:
    regex: "\\b(rm -rf|mkfs|wipefs|dd if=)\\b"
```
"""


def test_policy_compiles() -> None:
    compiled = compile_policy(SAMPLE_POLICY)
    assert compiled["id"] == "tripwire.test"
    assert len(compiled["rules"]) == 2
    assert len(compiled["anomaly_rules"]) == 1


def test_guard_blocks_secret_rule() -> None:
    async def run() -> None:
        guard = create_guard({"policy": compile_policy(SAMPLE_POLICY), "store": InMemoryStore()})
        result = await guard.before_tool_call(
            {
                "tool_name": "exec",
                "text": "print secret token",
                "actor_id": "agent-1",
                "session_id": "s-1",
            }
        )

        assert result["decision"] == "block"
        assert result["findings"][0]["rule_id"] == "secrets.detect"

    asyncio.run(run())


def test_anomaly_escalates_burst() -> None:
    async def run() -> None:
        guard = create_guard({"policy": compile_policy(SAMPLE_POLICY), "store": InMemoryStore()})
        base = {
            "tool_name": "read",
            "text": "read docs",
            "actor_id": "agent-2",
            "session_id": "s-2",
        }

        one = await guard.before_tool_call(base)
        two = await guard.before_tool_call(base)
        three = await guard.before_tool_call(base)

        assert one["decision"] == "allow"
        assert two["decision"] == "allow"
        assert three["decision"] == "require_approval"
        assert three["escalated_by_anomaly"] is True

    asyncio.run(run())


def test_chain_of_command_permit_consumed_once() -> None:
    async def run() -> None:
        policy = compile_policy(STRICT_UNSUPPORTED_POLICY)
        guard = create_guard(
            {
                "policy": policy,
                "store": InMemoryStore(),
                "chain_of_command": {"enabled": True},
            }
        )
        context = {
            "tool_name": "exec",
            "text": "echo hello",
            "actor_id": "agent-coc",
            "session_id": "session-coc",
        }

        eligible = await guard.before_tool_call(context)
        assert eligible["decision"] == "block"
        assert eligible["unsupported_by_policy"] is True
        assert eligible["chain_of_command"]["status"] == "eligible"

        await guard.authorize_unsupported_call(
            context,
            {
                "reviewer_id": "security-lead",
                "reason": "Allow one diagnostic command",
                "review_trail": [
                    {
                        "level": 1,
                        "supervisor_id": "supervisor-level-1",
                        "decision": "yes",
                        "reviewer_id": "security-lead",
                        "reason": "Allow one diagnostic command",
                        "ts": "2026-01-01T00:00:00.000Z",
                    }
                ],
            },
        )

        first = await guard.before_tool_call(context)
        second = await guard.before_tool_call(context)

        assert first["decision"] == "allow"
        assert first["chain_of_command"]["status"] == "approved_once"
        assert second["decision"] == "block"
        assert second["chain_of_command"]["status"] == "eligible"

    asyncio.run(run())
