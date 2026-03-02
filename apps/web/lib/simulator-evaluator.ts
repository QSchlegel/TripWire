import {
  GuardApprovalDeniedError,
  GuardApprovalRequiredError,
  GuardBlockedError
} from "@twire/guard";
import type {
  ChainOfCommandReviewResponse,
  GuardDecisionResult,
  GuardEngine,
  ToolCallContext
} from "@twire/guard";
import type {
  SimulatorApprovalDirective,
  SimulatorChainReviewStep,
  SimulatorExecutionStatus
} from "./simulator-smoke-cases";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function parseApprovalDirective(value: unknown): SimulatorApprovalDirective | undefined {
  const row = asRecord(value);
  if (!row) return undefined;
  if (typeof row.approved !== "boolean") return undefined;

  return {
    approved: row.approved,
    reviewerId: typeof row.reviewerId === "string" ? row.reviewerId : "sim-approver",
    reason:
      typeof row.reason === "string"
        ? row.reason
        : row.approved
          ? "Approved by simulator approval callback."
          : "Denied by simulator approval callback."
  };
}

function parseChainReviewScript(value: unknown): SimulatorChainReviewStep[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const script: SimulatorChainReviewStep[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    if (!row) continue;
    const decision = row.decision;
    if (decision !== "yes" && decision !== "no" && decision !== "escalate") continue;

    script.push({
      decision,
      reviewerId: typeof row.reviewerId === "string" ? row.reviewerId : undefined,
      reason: typeof row.reason === "string" ? row.reason : undefined,
      nextSupervisorId: typeof row.nextSupervisorId === "string" ? row.nextSupervisorId : undefined,
      supervisorSignature:
        typeof row.supervisorSignature === "string" ? row.supervisorSignature : undefined
    });
  }

  return script.length > 0 ? script : undefined;
}

export interface SimulatorEventExecution {
  result: GuardDecisionResult;
  execution: SimulatorExecutionStatus;
  chainEscalated: boolean;
  reviewReasons: string[];
}

export function eventToContext(event: Record<string, unknown>): ToolCallContext {
  const actor = (event.actor as Record<string, unknown> | undefined) ?? {};

  return {
    ts: typeof event.ts === "string" ? event.ts : undefined,
    sessionId: typeof event.session === "string" ? event.session : "sim-session",
    actorId: typeof actor.id === "string" ? actor.id : "sim-agent",
    actorType: typeof actor.type === "string" ? actor.type : "agent",
    toolName: typeof event.tool === "string" ? event.tool : "unknown",
    text: typeof event.text === "string" ? event.text : undefined,
    intent: typeof event.intent === "string" ? event.intent : undefined,
    args: event.args,
    destination:
      event.destination && typeof event.destination === "object"
        ? {
            domain:
              typeof (event.destination as Record<string, unknown>).domain === "string"
                ? String((event.destination as Record<string, unknown>).domain)
                : undefined,
            url:
              typeof (event.destination as Record<string, unknown>).url === "string"
                ? String((event.destination as Record<string, unknown>).url)
                : undefined
          }
        : undefined
  };
}

function extractReviewReasons(result: GuardDecisionResult): string[] {
  return result.chainOfCommand.reviewTrail
    .map((entry) => entry.reason?.trim())
    .filter((value): value is string => Boolean(value));
}

function didChainEscalate(result: GuardDecisionResult): boolean {
  return result.chainOfCommand.reviewTrail.some((entry) => entry.decision === "escalate");
}

function buildChainReviewCallback(
  script: SimulatorChainReviewStep[] | undefined
): ((request: { level: number }) => Promise<ChainOfCommandReviewResponse>) | undefined {
  if (!script) return undefined;

  let index = 0;
  return async ({ level }) => {
    const step = script[index] ?? {
      decision: "no" as const,
      reviewerId: `sim-reviewer-l${level}`,
      reason: "No scripted decision provided for this escalation level."
    };
    index += 1;

    if (step.decision === "escalate") {
      return {
        decision: "escalate",
        nextSupervisorId: step.nextSupervisorId,
        reason: step.reason,
        reviewerId: step.reviewerId,
        supervisorSignature: step.supervisorSignature
      };
    }

    return {
      decision: step.decision,
      reviewerId: step.reviewerId ?? `sim-reviewer-l${level}`,
      reason:
        step.reason ??
        (step.decision === "yes"
          ? "Approved by scripted chain decision."
          : "Denied by scripted chain decision."),
      supervisorSignature: step.supervisorSignature
    };
  };
}

function wrapToolExecution(
  guard: GuardEngine,
  context: ToolCallContext,
  approval: SimulatorApprovalDirective | undefined,
  chainScript: SimulatorChainReviewStep[] | undefined
) {
  let capturedResult: GuardDecisionResult | undefined;
  const onChainOfCommandReview = buildChainReviewCallback(chainScript);

  const wrapped = guard.wrapTool(
    context.toolName,
    async (_input, guardResult) => {
      capturedResult = guardResult;
      return "executed";
    },
    {
      buildContext: () => context,
      onRequireApproval: approval ? async () => approval.approved : undefined,
      onChainOfCommandReview
    }
  );

  return { wrapped, getCapturedResult: () => capturedResult };
}

export async function evaluateSimulatorEvent(
  guard: GuardEngine,
  event: Record<string, unknown>
): Promise<SimulatorEventExecution> {
  const context = eventToContext(event);
  const approval = parseApprovalDirective(event.approval);
  const chainScript = parseChainReviewScript(event.chainReview);
  const { wrapped, getCapturedResult } = wrapToolExecution(guard, context, approval, chainScript);

  try {
    await wrapped(context.args ?? {});
    const result = getCapturedResult();
    if (!result) {
      throw new Error("Simulator tool execution did not capture a guard decision result.");
    }

    return {
      result,
      execution: "executed",
      chainEscalated: didChainEscalate(result),
      reviewReasons: extractReviewReasons(result)
    };
  } catch (error) {
    if (error instanceof GuardBlockedError) {
      return {
        result: error.result,
        execution: "blocked",
        chainEscalated: didChainEscalate(error.result),
        reviewReasons: extractReviewReasons(error.result)
      };
    }

    if (error instanceof GuardApprovalRequiredError) {
      return {
        result: error.result,
        execution: "approval_required",
        chainEscalated: didChainEscalate(error.result),
        reviewReasons: extractReviewReasons(error.result)
      };
    }

    if (error instanceof GuardApprovalDeniedError) {
      return {
        result: error.result,
        execution: "approval_denied",
        chainEscalated: didChainEscalate(error.result),
        reviewReasons: extractReviewReasons(error.result)
      };
    }

    throw error;
  }
}
