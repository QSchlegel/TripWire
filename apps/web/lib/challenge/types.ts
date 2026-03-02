import type { GuardDecisionResult, ToolCallContext } from "@twire/guard";

export const CHALLENGE_THEMES = ["devops", "wallet", "support"] as const;
export const CHALLENGE_MODES = ["vulnerable", "hardened"] as const;
export const CHALLENGE_GOAL_TYPES = ["flag_exfiltration", "blocked_action_bypass"] as const;

export type ChallengeTheme = (typeof CHALLENGE_THEMES)[number];
export type ChallengeMode = (typeof CHALLENGE_MODES)[number];
export type ChallengeGoalType = (typeof CHALLENGE_GOAL_TYPES)[number];
export type ChallengeInputType = "chat" | "tool" | "mixed";

export interface ExternalEvalRequestNative {
  toolName: string;
  text?: string;
  intent?: string;
  args?: unknown;
  destination?: {
    domain?: string;
    url?: string;
  };
  actorId?: string;
  actorType?: string;
  sessionId?: string;
  ts?: string;
  metadata?: Record<string, unknown>;
}

export interface ExternalEvalRequestOpenAI {
  tool_name: string;
  tool_input?: unknown;
  run_context?: Record<string, unknown>;
}

export interface ExternalEvalResponse {
  requestId: string;
  decision: GuardDecisionResult["decision"];
  policyDecision: GuardDecisionResult["policyDecision"];
  findings: GuardDecisionResult["findings"];
  anomaly: GuardDecisionResult["anomaly"];
  unsupportedByPolicy: boolean;
  chainOfCommand: GuardDecisionResult["chainOfCommand"];
  latencyMs: number;
  challengeMeta?: {
    theme?: ChallengeTheme;
    mode?: ChallengeMode;
    notes?: string[];
  };
}

export type ProviderCredentialMode = "hosted" | "byo";

export interface HostedProviderCredentials {
  mode: "hosted";
}

export interface ByoProviderCredentials {
  mode: "byo";
  apiKey: string;
}

export type ProviderCredentials = HostedProviderCredentials | ByoProviderCredentials;

export interface ProviderConfig {
  provider?: "simulated" | "openai";
  model?: string;
  credentials?: ProviderCredentials;
}

export interface ModerationResult {
  blocked: boolean;
  reasonCode?: string;
}

export interface ProposedToolCall {
  toolName: string;
  text: string;
  args?: Record<string, unknown>;
  destination?: {
    domain?: string;
    url?: string;
  };
}

export interface ProviderChatTurnInput {
  theme: ChallengeTheme;
  mode: ChallengeMode;
  message: string;
  sessionId: string;
  profileHandle: string;
  providerConfig?: ProviderConfig;
}

export interface ProviderChatTurnOutput {
  assistantMessage: string;
  proposedToolCalls: ProposedToolCall[];
}

export interface ProviderToolProposalInput {
  theme: ChallengeTheme;
  mode: ChallengeMode;
  message: string;
}

export interface ProviderAdapter {
  moderate(input: { text: string; theme?: ChallengeTheme; mode?: ChallengeMode }): Promise<ModerationResult>;
  runChatTurn(input: ProviderChatTurnInput): Promise<ProviderChatTurnOutput>;
  proposeToolCalls(input: ProviderToolProposalInput): Promise<ProposedToolCall[]>;
}

export interface ChallengeToolAttempt {
  toolName: string;
  text: string;
  args?: Record<string, unknown>;
  intent?: string;
  destination?: {
    domain?: string;
    url?: string;
  };
}

export interface ToolAttemptOutcome {
  requestId: string;
  toolCall: ChallengeToolAttempt;
  guard: GuardDecisionResult;
  executionStatus: "executed" | "blocked" | "approval_required";
  output?: string;
  goalSolved?: ChallengeGoalType;
  goalDetails?: Record<string, unknown>;
  vulnerabilityPath?: string;
}

export interface ChallengeSessionState {
  sessionId: string;
  profileId: string;
  profileHandle: string;
  theme: ChallengeTheme;
  mode: ChallengeMode;
  inputType: ChallengeInputType;
  startedAt: string;
  dailyFlagVersion: string;
  solved: boolean;
  solveGoalType?: ChallengeGoalType;
}

export interface DecisionTraceEntry {
  requestId: string;
  toolName: string;
  decision: GuardDecisionResult["decision"];
  executionStatus: "executed" | "blocked" | "approval_required";
  findings: string[];
  anomalyReasons: string[];
  chainStatus: GuardDecisionResult["chainOfCommand"]["status"];
}

export function toToolContext(input: ExternalEvalRequestNative): ToolCallContext {
  return {
    toolName: input.toolName,
    text: input.text,
    intent: input.intent,
    args: input.args,
    destination: input.destination,
    actorId: input.actorId,
    actorType: input.actorType,
    sessionId: input.sessionId,
    ts: input.ts,
    metadata: input.metadata
  };
}

export function isChallengeTheme(value: unknown): value is ChallengeTheme {
  return typeof value === "string" && (CHALLENGE_THEMES as readonly string[]).includes(value);
}

export function isChallengeMode(value: unknown): value is ChallengeMode {
  return typeof value === "string" && (CHALLENGE_MODES as readonly string[]).includes(value);
}

export function isChallengeInputType(value: unknown): value is ChallengeInputType {
  return value === "chat" || value === "tool" || value === "mixed";
}
