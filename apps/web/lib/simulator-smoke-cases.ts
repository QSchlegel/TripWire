export type SimulatorDecision = "allow" | "require_approval" | "block";
export type SimulatorExecutionStatus =
  | "executed"
  | "blocked"
  | "approval_required"
  | "approval_denied";
export type SimulatorChainStatus = "not_applicable" | "eligible" | "approved_once" | "denied";
export type SimulatorChainDecision = "yes" | "no" | "escalate";

export interface SimulatorSmokeActor {
  id: string;
  type: string;
}

export interface SimulatorApprovalDirective {
  approved: boolean;
  reviewerId: string;
  reason: string;
}

export interface SimulatorChainReviewStep {
  decision: SimulatorChainDecision;
  reviewerId?: string;
  reason?: string;
  nextSupervisorId?: string;
  supervisorSignature?: string;
}

export interface SimulatorSmokeEventPayload {
  ts: string;
  tool: string;
  text: string;
  session: string;
  actor: SimulatorSmokeActor;
  intent?: string;
  args?: unknown;
  destination?: {
    domain?: string;
    url?: string;
  };
  approval?: SimulatorApprovalDirective;
  chainReview?: SimulatorChainReviewStep[];
}

export interface SimulatorSmokeEvent extends SimulatorSmokeEventPayload {
  expectedDecision: SimulatorDecision;
  expectedExecution?: SimulatorExecutionStatus;
  expectedChainStatus?: SimulatorChainStatus;
  expectedChainEscalated?: boolean;
  expectedReasonIncludes?: string[];
}

export interface SimulatorSmokeCase {
  id: string;
  name: string;
  description: string;
  policy: string;
  events: SimulatorSmokeEvent[];
}

const simulatorSmokePolicy = `---
id: tripwire.simulator.smoke
version: 1
mode: enforce
defaults:
  action: allow
  severity: low
  confidence: 0.8
tags:
  - simulator
  - smoke
---

# Simulator Smoke Policy

\`\`\`rule
id: network.review
category: external_side_effect
severity: med
action: require_approval
why: Outbound network actions can exfiltrate data.
suggestion: Validate destination and payload.
match:
  tool:
    - exec
  text:
    regex: "\\\\b(curl|wget|scp|rsync)\\\\b"
\`\`\`

\`\`\`rule
id: secrets.block
category: secrets
severity: high
action: block
why: Secret-like material must be blocked before tool execution.
suggestion: Remove or redact credentials.
match:
  text:
    regex: "(api[_-]?key|token|private key|seed phrase|secret)"
\`\`\`

\`\`\`rule
id: destructive.block
category: irreversible
severity: high
action: block
why: Destructive shell commands are not allowed in simulator smoke scenarios.
suggestion: Use dry-run alternatives and narrow scope.
match:
  tool:
    - exec
  text:
    regex: "\\\\b(rm -rf|mkfs|wipefs|dd if=)\\\\b"
\`\`\`

\`\`\`anomaly
id: burst.guard
metric: burst
threshold: 4
windowMs: 20000
action: require_approval
weight: 0.25
why: Rapid command burst indicates possible runaway automation.
\`\`\`
`;

const simulatorChainPolicy = `---
id: tripwire.simulator.chain
version: 1
mode: enforce
defaults:
  action: block
  severity: low
  confidence: 0.8
tags:
  - simulator
  - smoke
  - chain
---

# Simulator Chain Policy

\`\`\`rule
id: allow.read.commands
category: external_side_effect
severity: low
action: allow
why: Basic read commands are explicitly supported.
suggestion: Continue.
match:
  tool:
    - exec
  text:
    regex: "\\\\b(ls|cat|pwd|npm test)\\\\b"
\`\`\`

\`\`\`rule
id: block.destructive.commands
category: irreversible
severity: high
action: block
why: Explicit destructive commands are blocked.
suggestion: Use safer alternatives.
match:
  tool:
    - exec
  text:
    regex: "\\\\b(rm -rf|mkfs|wipefs|dd if=)\\\\b"
\`\`\`
`;

export const simulatorSmokeCases: SimulatorSmokeCase[] = [
  {
    id: "local-read-only",
    name: "Local Read-Only Dev Flow",
    description: "Read-only local shell workflow should remain allow.",
    policy: simulatorSmokePolicy,
    events: [
      {
        ts: "2026-02-26T09:00:00Z",
        tool: "exec",
        text: "ls -la",
        session: "smoke-local-read",
        actor: { id: "agent-local", type: "agent" },
        expectedDecision: "allow"
      },
      {
        ts: "2026-02-26T09:02:00Z",
        tool: "exec",
        text: "pwd",
        session: "smoke-local-read",
        actor: { id: "agent-local", type: "agent" },
        expectedDecision: "allow"
      },
      {
        ts: "2026-02-26T09:04:00Z",
        tool: "exec",
        text: "cat package.json",
        session: "smoke-local-read",
        actor: { id: "agent-local", type: "agent" },
        expectedDecision: "allow"
      },
      {
        ts: "2026-02-26T09:06:00Z",
        tool: "exec",
        text: "npm test",
        session: "smoke-local-read",
        actor: { id: "agent-local", type: "agent" },
        expectedDecision: "allow"
      }
    ]
  },
  {
    id: "network-review",
    name: "Outbound Network Review",
    description: "Typical outbound transfer commands route to higher-up approval.",
    policy: simulatorSmokePolicy,
    events: [
      {
        ts: "2026-02-26T10:00:00Z",
        tool: "exec",
        text: "curl https://example.com/upload -d @build.log",
        session: "smoke-network-review",
        actor: { id: "agent-network", type: "agent" },
        destination: {
          domain: "example.com",
          url: "https://example.com/upload"
        },
        expectedDecision: "require_approval",
        expectedExecution: "approval_required"
      },
      {
        ts: "2026-02-26T10:03:00Z",
        tool: "exec",
        text: "scp ./artifact.tgz deploy@example.net:/srv/releases/",
        session: "smoke-network-review",
        actor: { id: "agent-network", type: "agent" },
        destination: {
          domain: "example.net"
        },
        expectedDecision: "require_approval",
        expectedExecution: "approval_required"
      }
    ]
  },
  {
    id: "secret-leakage",
    name: "Secret Leakage Attempt",
    description: "Secret-like content should be blocked immediately.",
    policy: simulatorSmokePolicy,
    events: [
      {
        ts: "2026-02-26T11:00:00Z",
        tool: "exec",
        text: "echo api_key=$OPENAI_API_KEY",
        session: "smoke-secret",
        actor: { id: "agent-secret", type: "agent" },
        expectedDecision: "block"
      },
      {
        ts: "2026-02-26T11:03:00Z",
        tool: "exec",
        text: "print token from env file",
        session: "smoke-secret",
        actor: { id: "agent-secret", type: "agent" },
        expectedDecision: "block"
      }
    ]
  },
  {
    id: "destructive-command",
    name: "Destructive Command Attempt",
    description: "Irreversible shell commands should be blocked.",
    policy: simulatorSmokePolicy,
    events: [
      {
        ts: "2026-02-26T12:00:00Z",
        tool: "exec",
        text: "rm -rf /tmp/build-cache",
        session: "smoke-destructive",
        actor: { id: "agent-destructive", type: "agent" },
        expectedDecision: "block"
      },
      {
        ts: "2026-02-26T12:04:00Z",
        tool: "exec",
        text: "wipefs -a /dev/sdb",
        session: "smoke-destructive",
        actor: { id: "agent-destructive", type: "agent" },
        expectedDecision: "block"
      }
    ]
  },
  {
    id: "burst-escalation",
    name: "Burst Escalation",
    description: "Rapid low-risk command bursts should escalate to approval.",
    policy: simulatorSmokePolicy,
    events: [
      {
        ts: "2026-02-26T13:00:00Z",
        tool: "exec",
        text: "ls -la",
        session: "smoke-burst",
        actor: { id: "agent-burst", type: "agent" },
        expectedDecision: "allow"
      },
      {
        ts: "2026-02-26T13:00:04Z",
        tool: "exec",
        text: "pwd",
        session: "smoke-burst",
        actor: { id: "agent-burst", type: "agent" },
        expectedDecision: "allow"
      },
      {
        ts: "2026-02-26T13:00:08Z",
        tool: "exec",
        text: "cat README.md",
        session: "smoke-burst",
        actor: { id: "agent-burst", type: "agent" },
        expectedDecision: "allow"
      },
      {
        ts: "2026-02-26T13:00:11Z",
        tool: "exec",
        text: "npm test",
        session: "smoke-burst",
        actor: { id: "agent-burst", type: "agent" },
        expectedDecision: "require_approval",
        expectedExecution: "approval_required"
      }
    ]
  },
  {
    id: "session-context-shift",
    name: "Session Context Shift",
    description: "Burst escalation in one session should not contaminate a fresh session.",
    policy: simulatorSmokePolicy,
    events: [
      {
        ts: "2026-02-26T14:00:00Z",
        tool: "exec",
        text: "ls -la",
        session: "smoke-session-a",
        actor: { id: "agent-session", type: "agent" },
        expectedDecision: "allow"
      },
      {
        ts: "2026-02-26T14:00:03Z",
        tool: "exec",
        text: "pwd",
        session: "smoke-session-a",
        actor: { id: "agent-session", type: "agent" },
        expectedDecision: "allow"
      },
      {
        ts: "2026-02-26T14:00:06Z",
        tool: "exec",
        text: "cat package.json",
        session: "smoke-session-a",
        actor: { id: "agent-session", type: "agent" },
        expectedDecision: "allow"
      },
      {
        ts: "2026-02-26T14:00:09Z",
        tool: "exec",
        text: "npm test",
        session: "smoke-session-a",
        actor: { id: "agent-session", type: "agent" },
        expectedDecision: "require_approval",
        expectedExecution: "approval_required"
      },
      {
        ts: "2026-02-26T14:00:12Z",
        tool: "exec",
        text: "ls",
        session: "smoke-session-b",
        actor: { id: "agent-session", type: "agent" },
        expectedDecision: "allow"
      }
    ]
  },
  {
    id: "approval-denied",
    name: "Approval Callback Denied",
    description: "Require-approval command denied by callback with reviewer reason.",
    policy: simulatorSmokePolicy,
    events: [
      {
        ts: "2026-02-26T15:00:00Z",
        tool: "exec",
        text: "curl https://exports.example.org/push -d @payload.json",
        session: "smoke-approval-denied",
        actor: { id: "agent-approval", type: "agent" },
        destination: {
          domain: "exports.example.org",
          url: "https://exports.example.org/push"
        },
        approval: {
          approved: false,
          reviewerId: "reviewer-compliance",
          reason: "Destination is not on the approved outbound allowlist."
        },
        expectedDecision: "require_approval",
        expectedExecution: "approval_denied"
      }
    ]
  },
  {
    id: "approval-granted",
    name: "Approval Callback Granted",
    description: "Require-approval command approved and then executed.",
    policy: simulatorSmokePolicy,
    events: [
      {
        ts: "2026-02-26T15:20:00Z",
        tool: "exec",
        text: "curl https://exports.example.org/push -d @payload.json",
        session: "smoke-approval-granted",
        actor: { id: "agent-approval", type: "agent" },
        destination: {
          domain: "exports.example.org",
          url: "https://exports.example.org/push"
        },
        approval: {
          approved: true,
          reviewerId: "reviewer-compliance",
          reason: "Approved one-time export after destination and payload review."
        },
        expectedDecision: "require_approval",
        expectedExecution: "executed"
      }
    ]
  },
  {
    id: "chain-denied-level1",
    name: "Chain Denied At Level 1",
    description: "Unsupported command denied immediately by first-level supervisor.",
    policy: simulatorChainPolicy,
    events: [
      {
        ts: "2026-02-26T16:00:00Z",
        tool: "exec",
        text: "echo diagnostics snapshot",
        session: "smoke-chain-denied",
        actor: { id: "agent-chain-denied", type: "agent" },
        chainReview: [
          {
            decision: "no",
            reviewerId: "sec-lead",
            reason: "Denied due to insufficient change-ticket evidence."
          }
        ],
        expectedDecision: "block",
        expectedExecution: "blocked",
        expectedChainStatus: "denied",
        expectedChainEscalated: false,
        expectedReasonIncludes: ["Denied due to insufficient change-ticket evidence."]
      }
    ]
  },
  {
    id: "chain-pass-dispatcher-approved",
    name: "Chain Escalates To Dispatcher (Approved)",
    description: "Request is passed on to dispatcher, then approved with reason.",
    policy: simulatorChainPolicy,
    events: [
      {
        ts: "2026-02-26T17:00:00Z",
        tool: "exec",
        text: "echo temporary diagnostics packet",
        session: "smoke-chain-dispatcher-yes",
        actor: { id: "agent-chain-dispatcher-yes", type: "agent" },
        chainReview: [
          {
            decision: "escalate",
            nextSupervisorId: "dispatcher",
            reason: "Pass on to dispatcher for final routing."
          },
          {
            decision: "yes",
            reviewerId: "dispatcher",
            reason: "Dispatcher approved one-time diagnostic run."
          }
        ],
        expectedDecision: "allow",
        expectedExecution: "executed",
        expectedChainStatus: "approved_once",
        expectedChainEscalated: true,
        expectedReasonIncludes: [
          "Pass on to dispatcher for final routing.",
          "Dispatcher approved one-time diagnostic run."
        ]
      }
    ]
  },
  {
    id: "chain-pass-dispatcher-denied",
    name: "Chain Escalates To Dispatcher (Denied)",
    description: "Request is passed on to dispatcher, then denied with reason.",
    policy: simulatorChainPolicy,
    events: [
      {
        ts: "2026-02-26T18:00:00Z",
        tool: "exec",
        text: "echo temporary diagnostics packet",
        session: "smoke-chain-dispatcher-no",
        actor: { id: "agent-chain-dispatcher-no", type: "agent" },
        chainReview: [
          {
            decision: "escalate",
            nextSupervisorId: "dispatcher",
            reason: "Pass on to dispatcher for final routing."
          },
          {
            decision: "no",
            reviewerId: "dispatcher",
            reason: "Dispatcher denied request: no active incident."
          }
        ],
        expectedDecision: "block",
        expectedExecution: "blocked",
        expectedChainStatus: "denied",
        expectedChainEscalated: true,
        expectedReasonIncludes: [
          "Pass on to dispatcher for final routing.",
          "Dispatcher denied request: no active incident."
        ]
      }
    ]
  }
];

export const defaultSimulatorSmokeCase = simulatorSmokeCases[0];

export const simulatorSmokeCasesById = Object.fromEntries(
  simulatorSmokeCases.map((smokeCase) => [smokeCase.id, smokeCase])
) as Record<string, SimulatorSmokeCase>;

export function smokeEventExpectedExecution(event: SimulatorSmokeEvent): SimulatorExecutionStatus {
  if (event.expectedExecution) return event.expectedExecution;
  if (event.expectedDecision === "allow") return "executed";
  if (event.expectedDecision === "require_approval") return "approval_required";
  return "blocked";
}

export function smokeEventExpectedChainStatus(event: SimulatorSmokeEvent): SimulatorChainStatus {
  return event.expectedChainStatus ?? "not_applicable";
}

function smokeEventToPayload(event: SimulatorSmokeEvent): SimulatorSmokeEventPayload {
  const {
    expectedDecision: _expectedDecision,
    expectedExecution: _expectedExecution,
    expectedChainStatus: _expectedChainStatus,
    expectedChainEscalated: _expectedChainEscalated,
    expectedReasonIncludes: _expectedReasonIncludes,
    ...payload
  } = event;

  return payload;
}

export function smokeCaseToJsonl(smokeCase: SimulatorSmokeCase): string {
  return smokeCase.events.map((event) => JSON.stringify(smokeEventToPayload(event))).join("\n");
}

export function smokeCaseExpectedDecisions(smokeCase: SimulatorSmokeCase): SimulatorDecision[] {
  return smokeCase.events.map((event) => event.expectedDecision);
}
