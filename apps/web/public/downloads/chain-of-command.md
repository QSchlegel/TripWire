# TripWire Chain Of Command

## Purpose

TripWire adds deliberate friction for high-risk tool execution by default and only permits tightly scoped exceptions after supervisor review.

Design goals:

- increase security for unsupported actions
- keep explicit approval accountability
- permit rare, one-time operational exceptions without weakening baseline policy

## Eligibility

Chain of command applies only when all conditions are true:

1. Policy posture is allowlist-style (`defaults.action: block`).
2. Deterministic policy decision is `block`.
3. No policy rules matched (`findings.length === 0`).

This is reported as:

- `unsupportedByPolicy: true`
- `chainOfCommand.status: "eligible"`

Explicit block rules are not eligible for chain-of-command override.

## Review Contract

Review callback decisions:

- `yes`: supervisor approves one-time execution
- `no`: supervisor denies execution
- `escalate`: supervisor forwards to a higher reviewer

Required evidence for terminal decisions (`yes` or `no`):

- `reviewerId` (required)
- `reason` (required)
- `supervisorSignature` (optional, if available)

## One-Time Permit Semantics

When terminal decision is `yes`, TripWire creates a one-time permit that is:

- fingerprint-scoped to exact normalized call:
  - `toolName`, `text`, `intent`, `args`, `destination`, `actorId`, `sessionId`
- session-scoped by key (`actorId + sessionId + fingerprint`)
- consumed on first successful use (`remainingUses` moves from `1` to `0`)

Permit validity is session lifetime and not reusable across different fingerprints or sessions.

## Audit Expectations

Each review should preserve immutable chain evidence:

- escalation level and supervisor id
- decision (`yes | no | escalate`)
- reviewer id and reason for terminal decisions
- optional supervisor signature
- timestamp

TripWire stores this as `chainOfCommand.reviewTrail`.

## Fail-Closed Rules

TripWire denies execution when any of the following occurs:

- no chain-of-command callback configured
- invalid decision payload
- missing `reviewerId` or `reason` on terminal decisions
- `escalate` without `nextSupervisorId`
- escalation depth exceeds `maxEscalationLevels`
- post-permit re-evaluation is still `block` (for example anomaly escalation)

## Suggested Operational Defaults

- `maxEscalationLevels: 3`
- keep allowlists narrow and explicit
- require structured reasons tied to incident/change tickets
