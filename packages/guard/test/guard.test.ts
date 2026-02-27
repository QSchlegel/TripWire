import { describe, expect, it } from "vitest";
import {
  InMemoryStore,
  compilePolicy,
  createGuard,
  GuardApprovalRequiredError,
  GuardBlockedError,
  langchainMiddleware,
  openaiAdapter,
  type ToolCallContext
} from "../src/index.js";

const samplePolicy = `---
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

# Sample Policy

\`\`\`rule
id: secrets.detect
category: secrets
severity: high
action: block
why: Prevent secret leakage
suggestion: Remove credentials
match:
  text:
    regex: "(api[_-]?key|secret|token)"
\`\`\`

\`\`\`rule
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
\`\`\`

\`\`\`anomaly
id: anomaly.burst.guard
metric: burst
threshold: 3
action: require_approval
weight: 0.25
why: Rapid burst of commands is unusual
\`\`\`
`;

const strictUnsupportedPolicy = `---
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

# Strict Unsupported Policy

\`\`\`rule
id: allow.read
category: external_side_effect
severity: low
action: allow
why: Explicitly supported read operation.
suggestion: Continue.
match:
  tool:
    - read
\`\`\`

\`\`\`rule
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
    regex: "\\\\b(rm -rf|mkfs|wipefs|dd if=)\\\\b"
\`\`\`
`;

const anomalyBlockPolicy = `---
id: tripwire.anomaly.block
version: 1
mode: enforce
defaults:
  action: block
  severity: low
  confidence: 0.8
tags:
  - anomaly
---

# Anomaly Block Policy

\`\`\`rule
id: allow.read
category: external_side_effect
severity: low
action: allow
why: Supported read operation.
suggestion: Continue.
match:
  tool:
    - read
\`\`\`

\`\`\`anomaly
id: anomaly.always.block
metric: burst
threshold: 1
action: block
weight: 0.5
why: Any call in this fixture is considered anomalous.
\`\`\`
`;

describe("policy compiler", () => {
  it("compiles structured markdown policy", () => {
    const compiled = compilePolicy(samplePolicy);
    expect(compiled.id).toBe("tripwire.test");
    expect(compiled.rules).toHaveLength(2);
    expect(compiled.anomalyRules).toHaveLength(1);
  });

  it("rejects broad allow rules without scope", () => {
    const unsafe = `---
id: tripwire.unsafe
version: 1
mode: enforce
---

\`\`\`rule
id: unsafe.allow
category: external_side_effect
severity: low
action: allow
why: too broad
suggestion: narrow scope
match:
  text:
    regex: ".*"
\`\`\`
`;

    expect(() => compilePolicy(unsafe)).toThrowError(/Broad allow regex patterns/);
  });
});

describe("guard decisions", () => {
  const compiled = compilePolicy(samplePolicy);

  it("blocks on high-risk policy rule", async () => {
    const guard = createGuard({ policy: compiled, store: new InMemoryStore() });
    const result = await guard.beforeToolCall({
      toolName: "exec",
      text: "print secret token",
      actorId: "agent-1",
      sessionId: "s-1"
    });

    expect(result.decision).toBe("block");
    expect(result.findings[0]?.ruleId).toBe("secrets.detect");
  });

  it("escalates repeated bursts through anomaly scoring", async () => {
    const guard = createGuard({ policy: compiled, store: new InMemoryStore() });
    const base: ToolCallContext = {
      toolName: "read",
      text: "read docs",
      actorId: "agent-2",
      sessionId: "s-2"
    };

    const one = await guard.beforeToolCall(base);
    const two = await guard.beforeToolCall(base);
    const three = await guard.beforeToolCall(base);

    expect(one.decision).toBe("allow");
    expect(two.decision).toBe("allow");
    expect(three.decision).toBe("require_approval");
    expect(three.escalatedByAnomaly).toBe(true);
  });

  it("wrapTool enforces approval and block behavior", async () => {
    const guard = createGuard({ policy: compiled, store: new InMemoryStore() });

    const deploy = guard.wrapTool(
      "deploy",
      async () => "ok",
      {
        buildContext: () => ({ text: "deploy service", actorId: "agent-3", sessionId: "s-3" })
      }
    );

    await expect(deploy({})).rejects.toBeInstanceOf(GuardApprovalRequiredError);

    const exec = guard.wrapTool(
      "exec",
      async () => "ok",
      {
        buildContext: () => ({ text: "show api_key now", actorId: "agent-4", sessionId: "s-4" })
      }
    );

    await expect(exec({})).rejects.toBeInstanceOf(GuardBlockedError);
  });

  it("keeps require_approval behavior unchanged", async () => {
    const guard = createGuard({ policy: compiled, store: new InMemoryStore() });
    const result = await guard.beforeToolCall({
      toolName: "deploy",
      text: "deploy service",
      actorId: "agent-approval",
      sessionId: "approval-session"
    });

    expect(result.decision).toBe("require_approval");
    expect(result.policyDecision).toBe("require_approval");
    expect(result.chainOfCommand.status).toBe("not_applicable");
  });
});

describe("chain of command", () => {
  const strictCompiled = compilePolicy(strictUnsupportedPolicy);

  function unsupportedContext(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
    return {
      toolName: "exec",
      text: "echo hello",
      actorId: "agent-coc",
      sessionId: "session-coc",
      ...overrides
    };
  }

  it("marks unsupported calls as eligible under default-block posture", async () => {
    const guard = createGuard({
      policy: strictCompiled,
      store: new InMemoryStore(),
      chainOfCommand: { enabled: true }
    });

    const result = await guard.beforeToolCall(unsupportedContext());

    expect(result.decision).toBe("block");
    expect(result.policyDecision).toBe("block");
    expect(result.unsupportedByPolicy).toBe(true);
    expect(result.chainOfCommand.status).toBe("eligible");
    expect(result.chainOfCommand.fingerprint).toBeTruthy();
  });

  it("consumes one-time permits after a single successful use", async () => {
    const guard = createGuard({
      policy: strictCompiled,
      store: new InMemoryStore(),
      chainOfCommand: { enabled: true }
    });
    const context = unsupportedContext();

    await guard.authorizeUnsupportedCall(context, {
      reviewerId: "security-lead",
      reason: "Allow one diagnostic command",
      reviewTrail: [
        {
          level: 1,
          supervisorId: "supervisor-level-1",
          decision: "yes",
          reviewerId: "security-lead",
          reason: "Allow one diagnostic command",
          ts: new Date().toISOString()
        }
      ]
    });

    const first = await guard.beforeToolCall(context);
    const second = await guard.beforeToolCall(context);

    expect(first.decision).toBe("allow");
    expect(first.policyDecision).toBe("block");
    expect(first.chainOfCommand.status).toBe("approved_once");
    expect(second.decision).toBe("block");
    expect(second.chainOfCommand.status).toBe("eligible");
  });

  it("does not reuse permits across different fingerprints", async () => {
    const guard = createGuard({
      policy: strictCompiled,
      store: new InMemoryStore(),
      chainOfCommand: { enabled: true }
    });

    await guard.authorizeUnsupportedCall(unsupportedContext({ text: "echo alpha" }), {
      reviewerId: "security-lead",
      reason: "One-time approval",
      reviewTrail: [
        {
          level: 1,
          supervisorId: "supervisor-level-1",
          decision: "yes",
          reviewerId: "security-lead",
          reason: "One-time approval",
          ts: new Date().toISOString()
        }
      ]
    });

    const result = await guard.beforeToolCall(unsupportedContext({ text: "echo beta" }));
    expect(result.decision).toBe("block");
    expect(result.chainOfCommand.status).toBe("eligible");
  });

  it("does not reuse permits across sessions", async () => {
    const guard = createGuard({
      policy: strictCompiled,
      store: new InMemoryStore(),
      chainOfCommand: { enabled: true }
    });

    await guard.authorizeUnsupportedCall(unsupportedContext({ sessionId: "session-a" }), {
      reviewerId: "security-lead",
      reason: "One-time approval",
      reviewTrail: [
        {
          level: 1,
          supervisorId: "supervisor-level-1",
          decision: "yes",
          reviewerId: "security-lead",
          reason: "One-time approval",
          ts: new Date().toISOString()
        }
      ]
    });

    const result = await guard.beforeToolCall(unsupportedContext({ sessionId: "session-b" }));
    expect(result.decision).toBe("block");
    expect(result.chainOfCommand.status).toBe("eligible");
  });

  it("supports escalate then yes across supervisor levels", async () => {
    const guard = createGuard({
      policy: strictCompiled,
      store: new InMemoryStore(),
      chainOfCommand: { enabled: true, maxEscalationLevels: 3 }
    });

    let reviewCount = 0;
    const wrapped = guard.wrapTool(
      "exec",
      async () => "ok",
      {
        buildContext: () => unsupportedContext(),
        onChainOfCommandReview: async () => {
          reviewCount += 1;
          if (reviewCount === 1) {
            return {
              decision: "escalate",
              nextSupervisorId: "supervisor-level-2"
            };
          }

          return {
            decision: "yes",
            reviewerId: "security-director",
            reason: "Escalated approval granted"
          };
        }
      }
    );

    await expect(wrapped({})).resolves.toBe("ok");
    expect(reviewCount).toBe(2);
  });

  it("allows execution when first-level supervisor approves", async () => {
    const guard = createGuard({
      policy: strictCompiled,
      store: new InMemoryStore(),
      chainOfCommand: { enabled: true }
    });

    const wrapped = guard.wrapTool(
      "exec",
      async () => "ok",
      {
        buildContext: () => unsupportedContext({ actorId: "agent-level1", sessionId: "session-level1" }),
        onChainOfCommandReview: async () => ({
          decision: "yes",
          reviewerId: "security-lead",
          reason: "Approved at level one"
        })
      }
    );

    await expect(wrapped({})).resolves.toBe("ok");
  });

  it("fails closed when escalation has no next supervisor", async () => {
    const guard = createGuard({
      policy: strictCompiled,
      store: new InMemoryStore(),
      chainOfCommand: { enabled: true, maxEscalationLevels: 3 }
    });

    const wrapped = guard.wrapTool(
      "exec",
      async () => "ok",
      {
        buildContext: () => unsupportedContext(),
        onChainOfCommandReview: async () => ({
          decision: "escalate"
        })
      }
    );

    let thrown: GuardBlockedError | null = null;
    try {
      await wrapped({});
    } catch (error) {
      thrown = error as GuardBlockedError;
    }

    expect(thrown).toBeInstanceOf(GuardBlockedError);
    expect(thrown?.result.chainOfCommand.status).toBe("denied");
  });

  it("fails closed when escalation chain is exhausted", async () => {
    const guard = createGuard({
      policy: strictCompiled,
      store: new InMemoryStore(),
      chainOfCommand: { enabled: true, maxEscalationLevels: 2 }
    });

    const wrapped = guard.wrapTool(
      "exec",
      async () => "ok",
      {
        buildContext: () => unsupportedContext(),
        onChainOfCommandReview: async () => ({
          decision: "escalate",
          nextSupervisorId: "higher-supervisor"
        })
      }
    );

    let thrown: GuardBlockedError | null = null;
    try {
      await wrapped({});
    } catch (error) {
      thrown = error as GuardBlockedError;
    }

    expect(thrown).toBeInstanceOf(GuardBlockedError);
    expect(thrown?.result.chainOfCommand.status).toBe("denied");
  });

  it("fails closed when supervisor denies", async () => {
    const guard = createGuard({
      policy: strictCompiled,
      store: new InMemoryStore(),
      chainOfCommand: { enabled: true }
    });

    const wrapped = guard.wrapTool(
      "exec",
      async () => "ok",
      {
        buildContext: () => unsupportedContext(),
        onChainOfCommandReview: async () => ({
          decision: "no",
          reviewerId: "security-lead",
          reason: "Denied due risk"
        })
      }
    );

    let thrown: GuardBlockedError | null = null;
    try {
      await wrapped({});
    } catch (error) {
      thrown = error as GuardBlockedError;
    }

    expect(thrown).toBeInstanceOf(GuardBlockedError);
    expect(thrown?.result.chainOfCommand.status).toBe("denied");
  });

  it("keeps explicit block rules non-eligible for chain of command", async () => {
    const guard = createGuard({
      policy: strictCompiled,
      store: new InMemoryStore(),
      chainOfCommand: { enabled: true }
    });

    const result = await guard.beforeToolCall(
      unsupportedContext({
        text: "rm -rf /tmp/app"
      })
    );

    expect(result.decision).toBe("block");
    expect(result.unsupportedByPolicy).toBe(false);
    expect(result.chainOfCommand.status).toBe("not_applicable");
  });

  it("still blocks when anomaly escalates after a one-time unsupported permit", async () => {
    const guard = createGuard({
      policy: compilePolicy(anomalyBlockPolicy),
      store: new InMemoryStore(),
      chainOfCommand: { enabled: true }
    });

    const wrapped = guard.wrapTool(
      "exec",
      async () => "ok",
      {
        buildContext: () => unsupportedContext({ actorId: "agent-anomaly", sessionId: "session-anomaly" }),
        onChainOfCommandReview: async () => ({
          decision: "yes",
          reviewerId: "security-lead",
          reason: "Allow one attempt"
        })
      }
    );

    let thrown: GuardBlockedError | null = null;
    try {
      await wrapped({});
    } catch (error) {
      thrown = error as GuardBlockedError;
    }

    expect(thrown).toBeInstanceOf(GuardBlockedError);
    expect(thrown?.result.chainOfCommand.status).toBe("approved_once");
    expect(thrown?.result.escalatedByAnomaly).toBe(true);
  });
});

describe("adapter parity", () => {
  const strictCompiled = compilePolicy(strictUnsupportedPolicy);

  it("openai adapter forwards chain-of-command review callback", async () => {
    const guard = createGuard({
      policy: strictCompiled,
      store: new InMemoryStore(),
      chainOfCommand: { enabled: true }
    });
    let reviewCount = 0;

    const adapter = openaiAdapter(guard, {
      onChainOfCommandReview: async () => {
        reviewCount += 1;
        return {
          decision: "yes",
          reviewerId: "security-lead",
          reason: "OpenAI adapter approval"
        };
      }
    });

    const wrapped = adapter.wrapTool(
      "exec",
      async () => "ok",
      {
        buildContext: () => ({
          text: "echo openai",
          actorId: "agent-openai",
          sessionId: "session-openai"
        })
      }
    );

    await expect(wrapped({ cmd: "echo openai" })).resolves.toBe("ok");
    expect(reviewCount).toBe(1);
  });

  it("langchain middleware uses wrapTool path for chain-of-command behavior", async () => {
    const guard = createGuard({
      policy: strictCompiled,
      store: new InMemoryStore(),
      chainOfCommand: { enabled: true }
    });
    let reviewCount = 0;

    const middleware = langchainMiddleware(guard, {
      actorId: "agent-langchain",
      sessionId: "session-langchain",
      onChainOfCommandReview: async () => {
        reviewCount += 1;
        return {
          decision: "yes",
          reviewerId: "security-lead",
          reason: "LangChain adapter approval"
        };
      }
    });

    const request = {
      toolCall: {
        toolName: "exec",
        text: "echo langchain",
        args: { cmd: "echo langchain" }
      }
    };

    const result = await middleware(request, async () => "ok");
    expect(result).toBe("ok");
    expect(reviewCount).toBe(1);
  });
});
