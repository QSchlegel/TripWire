import { NextRequest } from "next/server";
import type { DecisionStatus } from "@prisma/client";
import { badRequest, jsonResponse, newRequestId, notFound, serverError } from "@/lib/server/api";
import { requireApiAuthAndRateLimit } from "@/lib/server/route-helpers";
import { getChallengeSession, maybeCreateChallengeOutcome, recordChallengeAttempt } from "@/lib/challenge/service";
import { providerAdapter } from "@/lib/challenge/provider";
import { evaluateChallengeToolAttempt } from "@/lib/challenge/engine";
import { getActiveHardeningPatch } from "@/lib/rl/patches";
import type { DecisionTraceEntry, ProviderConfig } from "@/lib/challenge/types";

interface Params {
  params: Promise<{
    sessionId: string;
  }>;
}

function toDecisionStatus(entries: Array<{ decision: "allow" | "require_approval" | "block" }>): DecisionStatus {
  if (entries.some((entry) => entry.decision === "block")) return "block";
  if (entries.some((entry) => entry.decision === "require_approval")) return "require_approval";
  return "allow";
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
    const message = body.message;
    if (typeof message !== "string" || message.trim().length === 0) {
      return badRequest(requestId, "INVALID_MESSAGE", "message is required.");
    }

    const providerConfig =
      body.providerConfig && typeof body.providerConfig === "object"
        ? (body.providerConfig as ProviderConfig)
        : undefined;

    const moderation = await providerAdapter.moderate({
      text: message,
      theme: session.theme,
      mode: session.mode
    });

    if (moderation.blocked) {
      await recordChallengeAttempt({
        sessionId: session.id,
        profileId: session.profileId,
        source: "chat",
        requestId,
        payload: {
          message,
          providerConfig,
          theme: session.theme,
          mode: session.mode
        },
        moderationStatus: "blocked",
        moderationReason: moderation.reasonCode,
        decisionStatus: "blocked_by_moderation",
        executionStatus: "blocked"
      });

      return jsonResponse(
        requestId,
        {
          assistantMessage: "Request blocked by moderation policy.",
          toolCalls: [],
          decisionTrace: [],
          status: "blocked_by_moderation",
          reasonCode: moderation.reasonCode,
          sessionState: {
            sessionId: session.id,
            solved: session.outcomes.length > 0,
            solveGoalType: session.outcomes[0]?.goalType
          }
        },
        {
          rateLimitHeaders: authCheck.auth?.rateLimitHeaders
        }
      );
    }

    const patch = await getActiveHardeningPatch(session.theme, session.mode);

    const turn = await providerAdapter.runChatTurn({
      theme: session.theme,
      mode: session.mode,
      message,
      sessionId: session.id,
      profileHandle: session.profile.handle,
      providerConfig
    });

    const toolResults: Array<{
      toolName: string;
      text: string;
      decision: string;
      executionStatus: string;
      output?: string;
      vulnerabilityPath?: string;
    }> = [];
    const traces: DecisionTraceEntry[] = [];
    let solvedGoal: "flag_exfiltration" | "blocked_action_bypass" | undefined;
    let solvedDetails: Record<string, unknown> | undefined;

    for (let i = 0; i < turn.proposedToolCalls.length; i += 1) {
      const proposal = turn.proposedToolCalls[i];
      const evalRequestId = `${requestId}-${i + 1}`;
      const evaluated = await evaluateChallengeToolAttempt({
        requestId: evalRequestId,
        theme: session.theme,
        mode: session.mode,
        actorId: session.profileId,
        sessionId: session.id,
        toolCall: {
          toolName: proposal.toolName,
          text: proposal.text,
          args: proposal.args,
          destination: proposal.destination
        },
        extraBlockedRegexes: patch.addBlockedTextRegexes,
        dailyFlagVersion: session.dailyFlagVersion
      });

      traces.push(evaluated.trace);
      toolResults.push({
        toolName: proposal.toolName,
        text: proposal.text,
        decision: evaluated.outcome.guard.decision,
        executionStatus: evaluated.outcome.executionStatus,
        output: evaluated.outcome.output,
        vulnerabilityPath: evaluated.outcome.vulnerabilityPath
      });

      if (!solvedGoal && evaluated.outcome.goalSolved) {
        solvedGoal = evaluated.outcome.goalSolved;
        solvedDetails = {
          ...(evaluated.outcome.goalDetails ?? {}),
          requestId: evalRequestId,
          toolName: proposal.toolName,
          text: proposal.text
        };
      }
    }

    await recordChallengeAttempt({
      sessionId: session.id,
      profileId: session.profileId,
      source: "chat",
      requestId,
      payload: {
        message,
        providerConfig,
        theme: session.theme,
        mode: session.mode,
        toolCalls: turn.proposedToolCalls
      },
      moderationStatus: "clean",
      decisionStatus: toDecisionStatus(traces),
      decisionTrace: traces,
      executionStatus: traces.some((trace) => trace.executionStatus === "executed") ? "executed" : traces[0]?.executionStatus,
      challengeMeta: {
        theme: session.theme,
        mode: session.mode,
        goalSolved: solvedGoal,
        text: message
      }
    });

    const outcome = await maybeCreateChallengeOutcome({
      sessionId: session.id,
      profileId: session.profileId,
      theme: session.theme,
      mode: session.mode,
      goalType: solvedGoal,
      verificationData: solvedDetails
    });

    return jsonResponse(
      requestId,
      {
        assistantMessage: turn.assistantMessage,
        toolCalls: toolResults,
        decisionTrace: traces,
        sessionState: {
          sessionId: session.id,
          solved: Boolean(outcome || session.outcomes.length > 0),
          solveGoalType: outcome?.goalType ?? session.outcomes[0]?.goalType,
          solvedAt: outcome?.solvedAt?.toISOString() ?? session.outcomes[0]?.solvedAt?.toISOString() ?? null
        }
      },
      {
        rateLimitHeaders: authCheck.auth?.rateLimitHeaders
      }
    );
  } catch (error) {
    console.error("POST /api/v1/challenge/sessions/[sessionId]/turns failed", error);
    return serverError(requestId);
  }
}
