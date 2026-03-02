---
id: twire.dev
version: 1
mode: enforce
defaults:
  action: block
  severity: low
  confidence: 0.8
tags:
  - dev
  - edge
---

# TripWire Developer Policy

```rule
id: allow.safe.dev.commands
category: external_side_effect
severity: low
action: allow
why: Explicitly allow read-only and low-risk local development commands.
suggestion: Keep command patterns narrow and auditable.
match:
  tool:
    - exec
  text:
    regex: "\\b(ls|cat|pwd|echo|npm test|npm run test|npm run lint)\\b"
```

```rule
id: secrets.regex.credentials
title: Possible credential exposure
category: secrets
severity: high
action: block
why: Prevent secret leakage from agent output and tool arguments.
suggestion: Remove secret material and use vault references.
match:
  text:
    regex: "(api[_-]?key|secret|token|mnemonic|seed phrase|private key)"
```

```rule
id: destructive.exec
category: irreversible
severity: high
action: block
why: Irreversible shell commands should not run without explicit exception flows.
suggestion: Use dry-run alternatives and narrow scope.
match:
  tool:
    - exec
  text:
    regex: "\\b(rm -rf|mkfs|dd if=|wipefs)\\b"
```

```rule
id: deploy.guard
category: external_side_effect
severity: med
action: require_approval
why: Deploy operations are sensitive side effects.
suggestion: Require human approval and validate targets.
match:
  text:
    regex: "\\b(terraform apply|kubectl apply|helm upgrade|fly deploy)\\b"
```

```anomaly
id: anomaly.frequency.high
metric: frequency_zscore
threshold: 4
action: block
weight: 0.35
why: Tool call cadence is outside expected baseline.
```

```anomaly
id: anomaly.burst.medium
metric: burst
threshold: 4
windowMs: 20000
action: require_approval
weight: 0.2
why: Burst activity may indicate runaway behavior.
```
