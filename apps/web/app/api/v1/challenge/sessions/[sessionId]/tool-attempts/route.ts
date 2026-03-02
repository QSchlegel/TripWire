import { NextRequest } from "next/server";
import { badRequest, jsonResponse, newRequestId, notFound, serverError } from "@/lib/server/api";
import { requireApiAuthAndRateLimit } from "@/lib/server/route-helpers";
import { getChallengeSession, maybeCreateChallengeOutcome, recordChallengeAttempt } from "@/lib/challenge/service";
import { evaluateChallengeToolAttempt } from "@/lib/challenge/engine";
import { providerAdapter } from "@/lib/challenge/provider";
import { getActiveHardeningPatch } from "@/lib/rl/patches";

interface Params {
  params: Promise<{
    sessionId: string;
  }>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

export async function POST(request: NextRequest, context: Params) {
  const requestId = newRequestId();

  try {
    const authCheck = await requireApiAuthAndRateLimit(request, requestId);
    if (authCheck.response) return authCheck.response;

    const { sessionId } = await context.params;
    const session = await getChallengeSession(authCheck.auth!.profileId, sessionId);
    if (!session) {
      return notFound(requestId, "Session not found.");
    }

    const body = (await request.json()) as Record<string, unknown>;
    const toolCall = asRecord(body.toolCall);
    if (!toolCall) {
      return badRequest(requestId, "INVALID_TOOL_CALL", "toolCall object is required.");
    }

    const toolName = toolCall.toolName;
    const text = toolCall.text;

    if (typeof toolName !== "string" || toolName.trim().length === 0) {
      return badRequest(requestId, "INVALID_TOOL_NAME", "toolCall.toolName is required.");
    }

    if (typeof text !== "string" || text.trim().length === 0) {
      return badRequest(requestId, "INVALID_TOOL_TEXT", "toolCall.text is required.");
    }

    const moderation = await providerAdapter.moderate({
      text,
      theme: session.theme,
      mode: session.mode
    });

    if (moderation.blocked) {
      await recordChallengeAttempt({
        sessionId: session.id,
        profileId: session.profileId,
        source: "tool",
        requestId,
        payload: {
          theme: session.theme,
          mode: session.mode,
          toolCall
        },
        moderationStatus: "blocked",
        moderationReason: moderation.reasonCode,
        decisionStatus: "blocked_by_moderation",
        executionStatus: "blocked"
      });

      return jsonResponse(
        requestId,
        {
          decision: "block",
          executionStatus: "blocked",
          status: "blocked_by_moderation",
          reasonCode: moderation.reasonCode
        },
        {
          rateLimitHeaders: authCheck.auth?.rateLimitHeaders
        }
      );
    }

    const patch = await getActiveHardeningPatch(session.theme, session.mode);

    const evaluated = await evaluateChallengeToolAttempt({
      requestId,
      theme: session.theme,
      mode: session.mode,
      actorId: session.profileId,
      sessionId: session.id,
      toolCall: {
        toolName,
        text,
        intent: typeof toolCall.intent === "string" ? toolCall.intent : undefined,
        args:
          toolCall.args && typeof toolCall.args === "object"
            ? (toolCall.args as Record<string, unknown>)
            : undefined,
        destination:
          toolCall.destination && typeof toolCall.destination === "object"
            ? {
                domain:
                  typeof (toolCall.destination as Record<string, unknown>).domain === "string"
                    ? String((toolCall.destination as Record<string, unknown>).domain)
                    : undefined,
                url:
                  typeof (toolCall.destination as Record<string, unknown>).url === "string"
                    ? String((toolCall.destination as Record<string, unknown>).url)
                    : undefined
              }
            : undefined
      },
      extraBlockedRegexes: patch.addBlockedTextRegexes,
      dailyFlagVersion: session.dailyFlagVersion
    });

    await recordChallengeAttempt({
      sessionId: session.id,
      profileId: session.profileId,
      source: "tool",
      requestId,
      payload: {
        theme: session.theme,
        mode: session.mode,
        toolCall
      },
      moderationStatus: "clean",
      decisionStatus: evaluated.outcome.guard.decision,
      decisionTrace: [evaluated.trace],
      executionStatus: evaluated.outcome.executionStatus,
      challengeMeta: {
        theme: session.theme,
        mode: session.mode,
        goalSolved: evaluated.outcome.goalSolved,
        text
      }
    });

    const outcome = await maybeCreateChallengeOutcome({
      sessionId: session.id,
      profileId: session.profileId,
      theme: session.theme,
      mode: session.mode,
      goalType: evaluated.outcome.goalSolved,
      verificationData: evaluated.outcome.goalDetails
    });

    return jsonResponse(
      requestId,
      {
        decision: evaluated.outcome.guard.decision,
        policyDecision: evaluated.outcome.guard.policyDecision,
        findings: evaluated.outcome.guard.findings,
        anomaly: evaluated.outcome.guard.anomaly,
        executionStatus: evaluated.outcome.executionStatus,
        output: evaluated.outcome.output,
        chainOfCommand: evaluated.outcome.guard.chainOfCommand,
        challengeOutcome: outcome
          ? {
              goalType: outcome.goalType,
              solvedAt: outcome.solvedAt.toISOString(),
              solveMs: outcome.solveMs
            }
          : null,
        vulnerabilityPath: evaluated.outcome.vulnerabilityPath
      },
      {
        rateLimitHeaders: authCheck.auth?.rateLimitHeaders
      }
    );
  } catch (error) {
    console.error("POST /api/v1/challenge/sessions/[sessionId]/tool-attempts failed", error);
    return serverError(requestId);
  }
}
