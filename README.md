# Tripwire (MVP)

Sensible Request Monitor for agent systems.

**Goal:** watch prompts + tool calls, flag risky/irreversible/high-cost/credential-ish actions, explain why, suggest a safer alternative, and emit an audit log.

## MVP scope
- **Core**: rules engine (regex + heuristics + allowlists) → `findings[]`
- **Adapters**: ingest events from logs/JSONL (OpenClaw events later)
- **UI**: out of scope for first commit; emit JSON that a dashboard can read

## Repo layout
- `packages/core` – rule evaluation + types
- `packages/cli` – `tripwire` CLI (evaluate a JSONL file)
- `examples/` – sample events + sample rulepacks
- `rolepacks/` – batteries-included rulepacks by agent role
- `ROLEPACKS.md` – how to pick and safely evolve rolepacks
- `packages/mesh-plugin` – Mesh-shaped adapter (decision mapping + capability wrapper)

## Next steps (implementation)
1. Define event schema (minimal) + finding schema
2. Implement rulepack loader (YAML/JSON)
3. Implement evaluators: regex, keyword, cost/irreversible tool allowlist
4. CLI: `tripwire eval --rules rules.json --in events.jsonl`

