import { NextRequest } from "next/server";
import type { ChallengeOutcome } from "@prisma/client";
import { jsonResponse, newRequestId, notFound, serverError } from "@/lib/server/api";
import { requireApiAuthAndRateLimit } from "@/lib/server/route-helpers";
import { getChallengeSession } from "@/lib/challenge/service";

interface Params {
  params: Promise<{
    sessionId: string;
  }>;
}

export async function GET(request: NextRequest, context: Params) {
  const requestId = newRequestId();

  try {
    const authCheck = await requireApiAuthAndRateLimit(request, requestId);
    if (authCheck.response) return authCheck.response;

    const { sessionId } = await context.params;
    const session = await getChallengeSession(authCheck.auth!.profileId, sessionId);
    if (!session) {
      return notFound(requestId, "Session not found.");
    }

    return jsonResponse(
      requestId,
      {
        sessionId: session.id,
        profileId: session.profileId,
        profileHandle: session.profile.handle,
        theme: session.theme,
        mode: session.mode,
        inputType: session.inputType,
        status: session.status,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
        dailyFlagVersion: session.dailyFlagVersion,
        solved: session.outcomes.length > 0,
        solveGoalType: session.outcomes[0]?.goalType,
        outcomes: session.outcomes.map((outcome: ChallengeOutcome) => ({
          id: outcome.id,
          goalType: outcome.goalType,
          solvedAt: outcome.solvedAt.toISOString(),
          solveMs: outcome.solveMs,
          verificationData: outcome.verificationData
        }))
      },
      {
        rateLimitHeaders: authCheck.auth?.rateLimitHeaders
      }
    );
  } catch (error) {
    console.error("GET /api/v1/challenge/sessions/[sessionId] failed", error);
    return serverError(requestId);
  }
}
