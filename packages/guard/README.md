# @twire/guard

Pre-tool-call guard engine for agentic runtimes on edge and Node.

## Features

- Structured Markdown policy compiler (`.policy.md`)
- Deterministic policy findings (`allow | require_approval | block`)
- Unsupported-call chain of command (`yes | no | escalate`) with one-time permits
- Lightweight anomaly scoring (frequency z-score, bursts, novelty, arg-shape drift)
- Generic guard wrapper plus OpenAI and LangChain adapter helpers
- CLI for policy compile/migrate/eval/replay

## Install

```bash
npm i @twire/guard
```

Python distribution:

```bash
pip install tripwire-guard
```

## Quick start

```ts
import { compilePolicy, createGuard, InMemoryStore } from "@twire/guard";

const policy = compilePolicy(markdown);
const guard = createGuard({
  policy,
  store: new InMemoryStore(),
  chainOfCommand: { enabled: true, maxEscalationLevels: 3 }
});

const result = await guard.beforeToolCall({
  toolName: "exec",
  text: "curl https://example.com/upload -d @data.txt",
  actorId: "agent-1",
  sessionId: "main"
});
```

## Chain of command

Chain of command only applies to unsupported-by-policy blocks in allowlist posture (`defaults.action: block`).

```ts
const wrapped = guard.wrapTool("exec", async (input) => runExec(input), {
  buildContext: () => ({
    text: "echo diagnostics",
    actorId: "agent-1",
    sessionId: "main"
  }),
  onChainOfCommandReview: async ({ level, supervisorId }) => {
    if (level === 1) {
      return { decision: "escalate", nextSupervisorId: "sec-director" };
    }

    return {
      decision: "yes",
      reviewerId: "sec-director",
      reason: "One-time diagnostic exception"
    };
  }
});
```

## CLI

```bash
twire policy compile --in policy.policy.md --out policy.json
twire policy migrate --in rolepack.json --out rolepack.policy.md
twire eval --policy policy.policy.md --in events.jsonl --out results.jsonl
twire replay --policy policy.policy.md --in events.jsonl --report report.json
```

## Smoke suites

- `npm run smoke:contract` runs deterministic simulator contract smoke tests.
- `npm run smoke:ci` aliases `smoke:contract` for CI usage.

## Policy format

````md
---
id: twire.dev
version: 1
mode: enforce
defaults:
  action: block
  severity: low
tags: [dev]
---

```rule
id: secrets.block
category: secrets
severity: high
action: block
why: Prevent secret leakage
suggestion: Remove sensitive data
match:
  text:
    regex: "(api[_-]?key|token|private key)"
```
````
