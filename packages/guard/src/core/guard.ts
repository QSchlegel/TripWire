import { InMemoryStore } from "../anomaly/store.js";
import { getDefaultAnomalyConfig, scoreAnomaly } from "../anomaly/scorer.js";
import type {
  ChainOfCommandAuthorizationInput,
  ChainOfCommandDecision,
  ChainOfCommandReviewResponse,
  ChainOfCommandReviewTrailEntry,
  Decision,
  GuardConfig,
  GuardDecisionResult,
  GuardEngine,
  ToolCallContext,
  WrapToolOptions
} from "../types/index.js";
import {
  chainOfCommandEnabled,
  chainOfCommandMaxLevels,
  consumePermit,
  createPermitRecord,
  isUnsupportedByPolicy,
  unsupportedCallFingerprint,
  writePermit
} from "./chain-of-command.js";
import { decisionFromFindings, mergeDecisionWithAnomaly } from "./decision.js";
import { evaluatePolicy } from "./evaluate.js";
import {
  GuardApprovalDeniedError,
  GuardApprovalRequiredError,
  GuardBlockedError
} from "./errors.js";
import { normalizeToolCall } from "./normalize.js";

function fallbackAction(policyDefault: Decision | undefined): Decision {
  return policyDefault ?? "allow";
}

function decisionFromReviewResponse(response: ChainOfCommandReviewResponse): ChainOfCommandDecision | undefined {
  const decision = response.decision;
  if (decision === "yes" || decision === "no" || decision === "escalate") return decision;
  return undefined;
}

function initialSupervisorId(context: ToolCallContext): string {
  const metadata = context.metadata;
  const value = metadata?.chainOfCommandSupervisorId;
  if (typeof value !== "string" || value.trim().length === 0) {
    return "supervisor-level-1";
  }
  return value.trim();
}

function deniedChainResult(
  result: GuardDecisionResult,
  reviewTrail: ChainOfCommandReviewTrailEntry[]
): GuardDecisionResult {
  return {
    ...result,
    chainOfCommand: {
      ...result.chainOfCommand,
      status: "denied",
      reviewTrail: reviewTrail.map((entry) => ({ ...entry }))
    }
  };
}

function assertTerminalEvidence(response: ChainOfCommandReviewResponse): {
  reviewerId: string;
  reason: string;
  supervisorSignature?: string;
} | null {
  const reviewerId = response.reviewerId?.trim();
  const reason = response.reason?.trim();

  if (!reviewerId || !reason) {
    return null;
  }

  return {
    reviewerId,
    reason,
    supervisorSignature: response.supervisorSignature
  };
}

export function createGuard(config: GuardConfig): GuardEngine {
  const policy = config.policy;
  const store = config.store ?? new InMemoryStore();
  const anomalyConfig = {
    ...getDefaultAnomalyConfig(),
    ...(config.anomaly ?? {})
  };
  const chainEnabled = chainOfCommandEnabled(config.chainOfCommand?.enabled);
  const maxEscalationLevels = chainOfCommandMaxLevels(config.chainOfCommand?.maxEscalationLevels);

  const engine: GuardEngine = {
    async beforeToolCall(context: ToolCallContext): Promise<GuardDecisionResult> {
      const started = performance.now();
      const event = normalizeToolCall(context);
      const findings = evaluatePolicy(event, policy);
      const defaultAction = fallbackAction(policy.defaults.action);
      const policyDecision = decisionFromFindings(findings, defaultAction);
      const unsupportedByPolicy = isUnsupportedByPolicy({
        fallbackAction: defaultAction,
        findingsCount: findings.length,
        policyDecision
      });

      const fingerprint = unsupportedByPolicy ? unsupportedCallFingerprint(event) : undefined;
      let effectivePolicyDecision = policyDecision;
      let chainOfCommand: GuardDecisionResult["chainOfCommand"] = {
        status: "not_applicable",
        reviewTrail: []
      };

      if (chainEnabled && unsupportedByPolicy && fingerprint) {
        const permit = await consumePermit(
          store,
          { actorId: event.actorId, sessionId: event.sessionId },
          fingerprint
        );

        if (permit) {
          effectivePolicyDecision = "allow";
          chainOfCommand = {
            status: "approved_once",
            fingerprint,
            permitId: permit.permitId,
            reviewTrail: permit.reviewTrail.map((entry) => ({ ...entry }))
          };
        } else {
          chainOfCommand = {
            status: "eligible",
            fingerprint,
            reviewTrail: []
          };
        }
      }

      const anomaly = await scoreAnomaly(event, policy, store, anomalyConfig);

      const merged = mergeDecisionWithAnomaly(effectivePolicyDecision, anomaly.proposedAction);
      let decision = merged.decision;
      let escalatedByAnomaly = merged.escalatedByAnomaly;

      if (chainOfCommand.status === "approved_once" && anomaly.proposedAction === "block") {
        decision = "block";
        escalatedByAnomaly = true;
      }

      if (policy.mode === "monitor") {
        decision = "allow";
      }

      const latencyMs = Number((performance.now() - started).toFixed(3));

      const result: GuardDecisionResult = {
        decision,
        policyDecision,
        findings,
        anomaly,
        eventId: event.eventId,
        policyId: policy.id,
        latencyMs,
        escalatedByAnomaly,
        unsupportedByPolicy,
        chainOfCommand
      };

      if (config.onAudit) {
        try {
          await config.onAudit({ event, result });
        } catch {
          // Audit sink issues must not affect the guarded decision path.
        }
      }

      return result;
    },

    async authorizeUnsupportedCall(
      context: ToolCallContext,
      input: ChainOfCommandAuthorizationInput
    ) {
      if (!chainEnabled) {
        throw new Error("Chain of command is disabled for this guard instance");
      }

      const reviewerId = input.reviewerId?.trim();
      const reason = input.reason?.trim();
      if (!reviewerId || !reason) {
        throw new Error("Chain of command approval requires reviewerId and reason");
      }

      if (!Array.isArray(input.reviewTrail) || input.reviewTrail.length === 0) {
        throw new Error("Chain of command approval requires a non-empty reviewTrail");
      }

      const event = normalizeToolCall(context);
      const findings = evaluatePolicy(event, policy);
      const defaultAction = fallbackAction(policy.defaults.action);
      const policyDecision = decisionFromFindings(findings, defaultAction);
      const unsupportedByPolicy = isUnsupportedByPolicy({
        fallbackAction: defaultAction,
        findingsCount: findings.length,
        policyDecision
      });

      if (!unsupportedByPolicy) {
        throw new Error("Chain of command approval is only available for unsupported-by-policy calls");
      }

      const fingerprint = unsupportedCallFingerprint(event);
      const permit = createPermitRecord(event, fingerprint, {
        reviewerId,
        reason,
        supervisorSignature: input.supervisorSignature,
        reviewTrail: input.reviewTrail
      });

      await writePermit(store, permit);
      return permit;
    },

    wrapTool<TInput, TOutput>(
      toolName: string,
      toolFn: (input: TInput, guardResult: GuardDecisionResult) => Promise<TOutput> | TOutput,
      opts: WrapToolOptions<TInput> = {}
    ) {
      return async (input: TInput): Promise<TOutput> => {
        const contextPatch = opts.buildContext?.(input) ?? {};
        const context: ToolCallContext = {
          ...contextPatch,
          toolName,
          args: contextPatch.args ?? input
        };

        let result = await engine.beforeToolCall(context);

        if (
          result.decision === "block" &&
          result.chainOfCommand.status === "eligible" &&
          opts.onChainOfCommandReview
        ) {
          const reviewTrail: ChainOfCommandReviewTrailEntry[] = [];
          let supervisorId = initialSupervisorId(context);

          for (let level = 1; level <= maxEscalationLevels; level += 1) {
            const response = await opts.onChainOfCommandReview({
              level,
              maxLevels: maxEscalationLevels,
              supervisorId,
              input,
              result,
              fingerprint: result.chainOfCommand.fingerprint ?? "",
              reviewTrail: reviewTrail.map((entry) => ({ ...entry }))
            });

            const decision = decisionFromReviewResponse(response);
            if (!decision) {
              result = deniedChainResult(result, reviewTrail);
              break;
            }

            const trailEntry: ChainOfCommandReviewTrailEntry = {
              level,
              supervisorId,
              decision,
              reviewerId: response.reviewerId,
              reason: response.reason,
              supervisorSignature: response.supervisorSignature,
              nextSupervisorId: response.nextSupervisorId,
              ts: new Date().toISOString()
            };

            reviewTrail.push(trailEntry);

            if (decision === "escalate") {
              const nextSupervisorId = response.nextSupervisorId?.trim();
              if (!nextSupervisorId) {
                result = deniedChainResult(result, reviewTrail);
                break;
              }

              supervisorId = nextSupervisorId;
              if (level === maxEscalationLevels) {
                result = deniedChainResult(result, reviewTrail);
              }
              continue;
            }

            const evidence = assertTerminalEvidence(response);
            if (!evidence) {
              result = deniedChainResult(result, reviewTrail);
              break;
            }

            if (decision === "no") {
              result = deniedChainResult(result, reviewTrail);
              break;
            }

            await engine.authorizeUnsupportedCall(context, {
              reviewerId: evidence.reviewerId,
              reason: evidence.reason,
              supervisorSignature: evidence.supervisorSignature,
              reviewTrail
            });

            result = await engine.beforeToolCall(context);
            break;
          }
        }

        if (result.decision === "block") {
          throw new GuardBlockedError(result);
        }

        if (result.decision === "require_approval") {
          if (!opts.onRequireApproval) {
            throw new GuardApprovalRequiredError(result);
          }

          const approved = await opts.onRequireApproval(result, input);
          if (!approved) {
            throw new GuardApprovalDeniedError(result);
          }
        }

        return await toolFn(input, result);
      };
    }
  };

  return engine;
}
