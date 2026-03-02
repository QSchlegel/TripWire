---
name: twire-chain-of-command
description: Use when handling unsupported-by-policy TripWire tool calls that may require supervisor escalation, one-time exception review, and auditable yes/no/escalate decisions.
---

# TripWire Chain Of Command Skill

## Trigger Conditions

Use this skill when all are true:

- TripWire decision is `block`
- `unsupportedByPolicy` is `true`
- policy posture is allowlist (`defaults.action: block`)
- caller requests exception handling instead of outright deny

Do not use this skill for explicit block-rule matches (for example `secrets`, `wallet`, `irreversible` policy findings).

## Workflow

1. Confirm eligibility
   - verify `chainOfCommand.status === "eligible"`
   - verify zero deterministic findings
2. Request supervisor review
   - call the chain-of-command reviewer callback
   - accept only `yes | no | escalate`
3. Process decision
   - `yes`: require `reviewerId` and `reason`, optional `supervisorSignature`, then call `authorizeUnsupportedCall(...)`
   - `no`: deny execution
   - `escalate`: require `nextSupervisorId` and continue until max level
4. Re-evaluate tool call
   - run `beforeToolCall(...)` after permit issuance
   - execute only if final decision is not `block`
5. Record audit trail
   - include every escalation step in `chainOfCommand.reviewTrail`

## Required Output Fields

For every terminal review (`yes` or `no`), capture:

- `reviewerId`
- `reason`
- `level`
- `supervisorId`
- `decision`
- `ts`

Optional:

- `supervisorSignature`

## Guardrails

- Fail closed on malformed review payloads.
- Fail closed when escalation depth exceeds `maxEscalationLevels`.
- Never bypass explicit policy block rules using this skill.
- One-time permit must be exact-call fingerprint scoped and consumed after one use.
