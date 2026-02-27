# TripWire v1 Spec

## Overview

TripWire is a TypeScript guard framework that evaluates agent tool calls **before execution** and returns one of:

- `allow`
- `require_approval`
- `block`

TripWire combines deterministic policy evaluation with lightweight anomaly scoring.
For unsupported-by-policy calls in default-block posture, TripWire can run a chain-of-command exception flow with one-time supervisor permits.

## Runtime contract

### Input

`ToolCallContext` (normalized by `normalizeToolCall`):

- `toolName` (required)
- optional runtime metadata: `actorId`, `sessionId`, `ts`, `text`, `intent`, `args`, `destination`

### Output

`GuardDecisionResult`:

- `decision`
- `policyDecision`
- `findings[]`
- `anomaly`
- `eventId`, `policyId`, `latencyMs`, `escalatedByAnomaly`
- `unsupportedByPolicy`
- `chainOfCommand` (`status`, `fingerprint`, optional `permitId`, `reviewTrail[]`)

`GuardEngine` also exposes:

- `authorizeUnsupportedCall(context, input)` to issue one-time permits after validated supervisor evidence.

## Policy format

Policies are `.policy.md` files containing:

1. YAML frontmatter (`id`, `version`, `mode`, `defaults`, `tags`)
2. fenced `rule` blocks
3. fenced `anomaly` blocks

Compiler behavior:

- Markdown -> typed AST (`CompiledPolicy`)
- deterministic validation errors via `PolicyCompileError` (`code`, `line`, `column`)
- safety checks for broad allow patterns
- non-downgradable categories: `secrets`, `wallet`, `irreversible`

Unsupported detection contract:

- Requires allowlist posture (`defaults.action: block`).
- Eligible only when deterministic evaluation returns `block` with **zero** rule findings.

## Anomaly engine

v1 signals:

- tool-call frequency z-score
- burst detection in short window
- novelty signals: tool/domain/action template
- argument shape drift

Anomaly proposes escalation; final merge only escalates by one decision level.
Even after a one-time unsupported permit, anomaly may still escalate to `require_approval` or `block`.

## Chain of command

Runtime behavior:

- Escalation decisions are `yes | no | escalate`.
- Multi-level review is supported up to `maxEscalationLevels` (default: `3`).
- `yes` requires `reviewerId` + `reason` and creates a one-time exact-call permit.
- Permits are scoped to `actorId + sessionId + fingerprint` and consumed on first use.
- Explicit block rules are not eligible for this path.

## Package and exports

Published package: `@tripwire/guard`

Subpath exports:

- `@tripwire/guard`
- `@tripwire/guard/core`
- `@tripwire/guard/policy`
- `@tripwire/guard/anomaly`
- `@tripwire/guard/adapters/openai`
- `@tripwire/guard/adapters/langchain`
- `@tripwire/guard/cli`
- `@tripwire/guard/types`

## CLI contract

- `tripwire policy compile --in policy.policy.md --out policy.json`
- `tripwire policy migrate --in rolepack.json --out rolepack.policy.md`
- `tripwire eval --policy policy.policy.md --in events.jsonl [--out results.jsonl]`
- `tripwire replay --policy policy.policy.md --in events.jsonl --report report.json`

## Web application

Public Next.js app in `apps/web`:

- `/` landing page with Three.js guard visualization
- `/simulator` in-browser policy + event replay
- `/research` similar-solutions matrix
