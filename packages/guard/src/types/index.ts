export type Decision = "allow" | "require_approval" | "block";
export type ChainOfCommandDecision = "yes" | "no" | "escalate";
export type ChainOfCommandStatus = "not_applicable" | "eligible" | "approved_once" | "denied";

export type Severity = "low" | "med" | "high";

export type PolicyMode = "monitor" | "enforce";

export type GuardCategory =
  | "secrets"
  | "wallet"
  | "irreversible"
  | "external_side_effect"
  | "high_cost"
  | "social_engineering"
  | string;

export interface RegexMatcher {
  regex: string;
  flags?: string;
}

export interface ArgMatcher {
  path: string;
  regex?: string;
  flags?: string;
  eq?: unknown;
}

export interface DestinationMatcher {
  domain?: string | string[];
}

export interface RuleMatch {
  tool?: string | string[];
  text?: RegexMatcher;
  intent?: RegexMatcher;
  arg?: ArgMatcher;
  destination?: DestinationMatcher;
}

export interface PolicyRule {
  id: string;
  title?: string;
  category: GuardCategory;
  severity: Severity;
  action?: Decision;
  confidence?: number;
  why: string;
  suggestion: string;
  match: RuleMatch;
}

export type AnomalyMetric =
  | "frequency_zscore"
  | "burst"
  | "novel_tool"
  | "novel_domain"
  | "novel_template"
  | "arg_shape_drift";

export interface PolicyAnomalyRule {
  id: string;
  metric: AnomalyMetric;
  threshold?: number;
  windowMs?: number;
  action: Decision;
  weight?: number;
  why?: string;
}

export interface PolicyDefaults {
  severity?: Severity;
  action?: Decision;
  confidence?: number;
}

export interface CompiledPolicy {
  id: string;
  version: number;
  mode: PolicyMode;
  tags: string[];
  defaults: PolicyDefaults;
  rules: PolicyRule[];
  anomalyRules: PolicyAnomalyRule[];
  source?: string;
}

export interface ToolCallContext {
  ts?: string;
  sessionId?: string;
  actorId?: string;
  actorType?: string;
  toolName: string;
  text?: string;
  intent?: string;
  args?: unknown;
  destination?: {
    domain?: string;
    url?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface NormalizedToolEvent {
  eventId: string;
  ts: string;
  epochMs: number;
  sessionId: string;
  actorId: string;
  actorType: string;
  toolName: string;
  text: string;
  intent: string;
  args: unknown;
  destinationDomain?: string;
  destinationUrl?: string;
  actionTemplate: string;
  argShapeSignature: string;
  metadata?: Record<string, unknown>;
}

export interface Finding {
  eventId: string;
  ruleId: string;
  title: string;
  category: GuardCategory;
  severity: Severity;
  action: Decision;
  confidence: number;
  why: string;
  suggestion: string;
  matchedOn: string[];
}

export interface AnomalySignals {
  frequencyZScore: number;
  burstCount: number;
  novelTool: boolean;
  novelDomain: boolean;
  novelTemplate: boolean;
  argShapeDrift: boolean;
}

export interface AnomalyRuleTrigger {
  id: string;
  metric: AnomalyMetric;
  observed: number;
  threshold: number;
  action: Decision;
}

export interface AnomalyResult {
  score: number;
  proposedAction: Decision;
  signals: AnomalySignals;
  reasons: string[];
  triggeredRules: AnomalyRuleTrigger[];
}

export interface GuardDecisionResult {
  decision: Decision;
  policyDecision: Decision;
  findings: Finding[];
  anomaly: AnomalyResult;
  eventId: string;
  policyId: string;
  latencyMs: number;
  escalatedByAnomaly: boolean;
  unsupportedByPolicy: boolean;
  chainOfCommand: ChainOfCommandResult;
}

export interface AuditEvent {
  event: NormalizedToolEvent;
  result: GuardDecisionResult;
}

export interface FrequencyStats {
  count: number;
  meanDeltaMs: number;
  m2: number;
  lastTs: number;
}

export interface StateStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
}

export interface AnomalyConfig {
  burstWindowMs: number;
  burstMediumCount: number;
  burstHighCount: number;
  zScoreMedium: number;
  zScoreHigh: number;
  requireApprovalScore: number;
  blockScore: number;
}

export interface GuardConfig {
  policy: CompiledPolicy;
  store?: StateStore;
  anomaly?: Partial<AnomalyConfig>;
  chainOfCommand?: {
    enabled?: boolean;
    maxEscalationLevels?: number;
  };
  onAudit?: (audit: AuditEvent) => void | Promise<void>;
}

export interface ChainOfCommandReviewTrailEntry {
  level: number;
  supervisorId: string;
  decision: ChainOfCommandDecision;
  reviewerId?: string;
  reason?: string;
  supervisorSignature?: string;
  nextSupervisorId?: string;
  ts: string;
}

export interface ChainOfCommandResult {
  status: ChainOfCommandStatus;
  fingerprint?: string;
  permitId?: string;
  reviewTrail: ChainOfCommandReviewTrailEntry[];
}

export interface ChainOfCommandReviewRequest<TInput> {
  level: number;
  maxLevels: number;
  supervisorId: string;
  input: TInput;
  result: GuardDecisionResult;
  fingerprint: string;
  reviewTrail: ChainOfCommandReviewTrailEntry[];
}

export interface ChainOfCommandReviewResponse {
  decision: ChainOfCommandDecision;
  reviewerId?: string;
  reason?: string;
  supervisorSignature?: string;
  nextSupervisorId?: string;
}

export interface ChainOfCommandPermitRecord {
  permitId: string;
  fingerprint: string;
  actorId: string;
  sessionId: string;
  toolName: string;
  remainingUses: number;
  createdAt: string;
  reviewerId: string;
  reason: string;
  supervisorSignature?: string;
  reviewTrail: ChainOfCommandReviewTrailEntry[];
}

export interface ChainOfCommandAuthorizationInput {
  reviewerId: string;
  reason: string;
  supervisorSignature?: string;
  reviewTrail: ChainOfCommandReviewTrailEntry[];
}

export interface WrapToolOptions<TInput> {
  buildContext?: (input: TInput) => Omit<ToolCallContext, "toolName">;
  onRequireApproval?: (result: GuardDecisionResult, input: TInput) => Promise<boolean> | boolean;
  onChainOfCommandReview?: (
    request: ChainOfCommandReviewRequest<TInput>
  ) => Promise<ChainOfCommandReviewResponse> | ChainOfCommandReviewResponse;
}

export type WrappedToolFn<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

export interface GuardEngine {
  beforeToolCall(context: ToolCallContext): Promise<GuardDecisionResult>;
  authorizeUnsupportedCall(
    context: ToolCallContext,
    input: ChainOfCommandAuthorizationInput
  ): Promise<ChainOfCommandPermitRecord>;
  wrapTool<TInput, TOutput>(
    toolName: string,
    toolFn: (input: TInput, guardResult: GuardDecisionResult) => Promise<TOutput> | TOutput,
    opts?: WrapToolOptions<TInput>
  ): WrappedToolFn<TInput, TOutput>;
}
