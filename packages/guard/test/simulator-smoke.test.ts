import { describe, expect, it } from "vitest";
import {
  GuardApprovalDeniedError,
  GuardApprovalRequiredError,
  GuardBlockedError,
  InMemoryStore,
  compilePolicy,
  createGuard,
  type ChainOfCommandReviewResponse,
  type GuardDecisionResult,
  type GuardEngine,
  type ToolCallContext
} from "../src/index.js";
import {
  simulatorSmokeCases,
  smokeEventExpectedChainStatus,
  smokeEventExpectedExecution,
  type SimulatorSmokeEvent
} from "../../../apps/web/lib/simulator-smoke-cases";

function eventToContext(event: SimulatorSmokeEvent): ToolCallContext {
  return {
    ts: event.ts,
    sessionId: event.session,
    actorId: event.actor.id,
    actorType: event.actor.type,
    toolName: event.tool,
    text: event.text,
    intent: event.intent,
    args: event.args,
    destination: event.destination
  };
}

function didChainEscalate(result: GuardDecisionResult): boolean {
  return result.chainOfCommand.reviewTrail.some((entry) => entry.decision === "escalate");
}

function reviewReasons(result: GuardDecisionResult): string[] {
  return result.chainOfCommand.reviewTrail
    .map((entry) => entry.reason?.trim())
    .filter((value): value is string => Boolean(value));
}

function chainReviewCallback(event: SimulatorSmokeEvent) {
  if (!event.chainReview || event.chainReview.length === 0) return undefined;

  let index = 0;
  return async ({ level }: { level: number }): Promise<ChainOfCommandReviewResponse> => {
    const step = event.chainReview?.[index] ?? {
      decision: "no" as const,
      reviewerId: `fallback-reviewer-l${level}`,
      reason: "No scripted chain decision provided."
    };
    index += 1;

    if (step.decision === "escalate") {
      return {
        decision: "escalate",
        nextSupervisorId: step.nextSupervisorId,
        reviewerId: step.reviewerId,
        reason: step.reason,
        supervisorSignature: step.supervisorSignature
      };
    }

    return {
      decision: step.decision,
      reviewerId: step.reviewerId ?? `reviewer-l${level}`,
      reason:
        step.reason ??
        (step.decision === "yes"
          ? "Approved in simulator smoke test."
          : "Denied in simulator smoke test."),
      supervisorSignature: step.supervisorSignature
    };
  };
}

async function evaluateEvent(guard: GuardEngine, event: SimulatorSmokeEvent): Promise<{
  result: GuardDecisionResult;
  execution: "executed" | "blocked" | "approval_required" | "approval_denied";
  chainEscalated: boolean;
  reasons: string[];
}> {
  const context = eventToContext(event);
  let captured: GuardDecisionResult | undefined;

  const wrapped = guard.wrapTool(
    context.toolName,
    async (_input, guardResult) => {
      captured = guardResult;
      return "ok";
    },
    {
      buildContext: () => context,
      onRequireApproval: event.approval ? async () => event.approval?.approved ?? false : undefined,
      onChainOfCommandReview: chainReviewCallback(event)
    }
  );

  try {
    await wrapped(context.args ?? {});
    if (!captured) {
      throw new Error("Missing captured guard result from wrapped execution.");
    }

    return {
      result: captured,
      execution: "executed",
      chainEscalated: didChainEscalate(captured),
      reasons: reviewReasons(captured)
    };
  } catch (error) {
    if (error instanceof GuardBlockedError) {
      return {
        result: error.result,
        execution: "blocked",
        chainEscalated: didChainEscalate(error.result),
        reasons: reviewReasons(error.result)
      };
    }

    if (error instanceof GuardApprovalRequiredError) {
      return {
        result: error.result,
        execution: "approval_required",
        chainEscalated: didChainEscalate(error.result),
        reasons: reviewReasons(error.result)
      };
    }

    if (error instanceof GuardApprovalDeniedError) {
      return {
        result: error.result,
        execution: "approval_denied",
        chainEscalated: didChainEscalate(error.result),
        reasons: reviewReasons(error.result)
      };
    }

    throw error;
  }
}

describe("simulator smoke usecases", () => {
  for (const smokeCase of simulatorSmokeCases) {
    it(`matches expected decisions and execution flow for ${smokeCase.name}`, async () => {
      process.stdout.write(`\n[smoke-case] ${smokeCase.id} :: ${smokeCase.name}\n`);
      process.stdout.write(`[smoke-case] ${smokeCase.description}\n`);

      const guard = createGuard({
        policy: compilePolicy(smokeCase.policy),
        store: new InMemoryStore(),
        chainOfCommand: { enabled: true, maxEscalationLevels: 3 }
      });

      for (let i = 0; i < smokeCase.events.length; i += 1) {
        const event = smokeCase.events[i];
        const execution = await evaluateEvent(guard, event);

        process.stdout.write(
          `[event #${i + 1}] cmd="${event.text}" expected(decision=${event.expectedDecision}, execution=${smokeEventExpectedExecution(event)}, chain=${smokeEventExpectedChainStatus(event)}) actual(decision=${execution.result.decision}, execution=${execution.execution}, chain=${execution.result.chainOfCommand.status}, escalated=${String(execution.chainEscalated)})\n`
        );

        if (event.approval) {
          process.stdout.write(
            `[event #${i + 1}] approval callback: approved=${String(event.approval.approved)} reviewer=${event.approval.reviewerId} reason="${event.approval.reason}"\n`
          );
        }

        if (execution.reasons.length > 0) {
          process.stdout.write(`[event #${i + 1}] review reasons: ${execution.reasons.join(" | ")}\n`);
        }

        expect(execution.result.decision).toBe(event.expectedDecision);
        expect(execution.execution).toBe(smokeEventExpectedExecution(event));
        expect(execution.result.chainOfCommand.status).toBe(smokeEventExpectedChainStatus(event));

        if (typeof event.expectedChainEscalated === "boolean") {
          expect(execution.chainEscalated).toBe(event.expectedChainEscalated);
        }

        for (const reason of event.expectedReasonIncludes ?? []) {
          expect(execution.reasons.some((entry) => entry.includes(reason))).toBe(true);
        }
      }
    });
  }

  it("covers allow/approval/block decisions plus denied and escalated dispatcher paths", async () => {
    const seenDecisions = new Set<string>();
    const seenExecution = new Set<string>();
    let sawEscalatedTrue = false;
    let sawEscalatedFalse = false;
    let sawDeniedChain = false;
    let sawDispatcherReason = false;

    for (const smokeCase of simulatorSmokeCases) {
      const guard = createGuard({
        policy: compilePolicy(smokeCase.policy),
        store: new InMemoryStore(),
        chainOfCommand: { enabled: true, maxEscalationLevels: 3 }
      });

      for (const event of smokeCase.events) {
        const execution = await evaluateEvent(guard, event);
        seenDecisions.add(execution.result.decision);
        seenExecution.add(execution.execution);

        if (execution.chainEscalated) sawEscalatedTrue = true;
        if (!execution.chainEscalated) sawEscalatedFalse = true;
        if (execution.result.chainOfCommand.status === "denied") sawDeniedChain = true;
        if (execution.reasons.some((reason) => reason.toLowerCase().includes("dispatcher"))) {
          sawDispatcherReason = true;
        }
      }
    }

    expect(seenDecisions.has("allow")).toBe(true);
    expect(seenDecisions.has("require_approval")).toBe(true);
    expect(seenDecisions.has("block")).toBe(true);

    expect(seenExecution.has("executed")).toBe(true);
    expect(seenExecution.has("approval_required")).toBe(true);
    expect(seenExecution.has("approval_denied")).toBe(true);
    expect(seenExecution.has("blocked")).toBe(true);

    expect(sawEscalatedTrue).toBe(true);
    expect(sawEscalatedFalse).toBe(true);
    expect(sawDeniedChain).toBe(true);
    expect(sawDispatcherReason).toBe(true);
  });
});
