# Tripwire Rolepacks (batteries included)

A **rolepack** is a ready-made rulepack tuned for a common *agent role* (what the agent is allowed to do + what it must be careful about).

Principles:
- Prefer **deterministic, explainable rules** (regex/allowlists/thresholds).
- Keep rolepacks **small and composable**.
- Separate **detection** (Tripwire) from **enforcement** (Mesh/app wrapper).

## Included rolepacks

- `rolepacks/reader.json` – Read-only / research agent
- `rolepacks/dev.json` – Developer agent (local dev, builds/tests)
- `rolepacks/devops.json` – Ops agent (deploys, infra)
- `rolepacks/wallet.json` – Wallet/treasury agent (signing, transfers)

## How to pick a rolepack

Start strict, then loosen:
1) choose the closest rolepack
2) set allowlists (domains, paths, repos)
3) run in **monitor-only** mode
4) promote to **require_approval** for high-risk categories
5) only then consider auto-allow rules

## Safe evolution (agent can propose changes)

Tripwire rulepacks should evolve like code:

### 1) Proposal flow (no silent self-editing)
- Agent may output a **patch proposal** (diff) to a rulepack.
- A human (or policy gate) must approve before it becomes active.

### 2) Add “why” + tests for every change
Each new/modified rule should include:
- `why` (what incident or failure mode it addresses)
- at least 1 **positive** and 1 **negative** test event

### 3) Two-phase rollout
- Phase A: **monitor-only** (log findings, no blocking)
- Phase B: **require_approval** (block unless approved)
- Phase C: **enforce/deny** (only when false positives are low)

### 4) Guardrails for self-modification
If an agent is allowed to propose rulepack changes, lock these down:
- Cannot change/remove rules in categories: `secrets`, `wallet`, `irreversible` without explicit approval.
- Cannot add broad allow rules (e.g., `.*`) unless accompanied by a narrowed allowlist.
- Must bump a `rulepack_revision` and include changelog entry.

### 5) Regressions
Keep a small corpus of “bad ideas” that must always be caught (golden tests).

---

Next: rolepack JSON files live in `rolepacks/`.
