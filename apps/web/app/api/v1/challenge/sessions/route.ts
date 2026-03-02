import { NextRequest } from "next/server";
import { badRequest, jsonResponse, newRequestId, notFound, serverError } from "@/lib/server/api";
import { requireApiAuthAndRateLimit } from "@/lib/server/route-helpers";
import { createChallengeSession, getChallengeSession } from "@/lib/challenge/service";
import { dailyFlagVersion } from "@/lib/challenge/flags";
import { isChallengeInputType, isChallengeMode, isChallengeTheme } from "@/lib/challenge/types";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const authCheck = await requireApiAuthAndRateLimit(request, requestId);
    if (authCheck.response) return authCheck.response;

    const body = (await request.json()) as Record<string, unknown>;

    const theme = body.theme;
    const mode = body.mode;
    const inputType = body.inputType;

    if (!isChallengeTheme(theme)) {
      return badRequest(requestId, "INVALID_THEME", "theme must be one of: devops, wallet, support");
    }

    if (!isChallengeMode(mode)) {
      return badRequest(requestId, "INVALID_MODE", "mode must be one of: vulnerable, hardened");
    }

    if (!isChallengeInputType(inputType)) {
      return badRequest(requestId, "INVALID_INPUT_TYPE", "inputType must be chat, tool, or mixed");
    }

    const session = await createChallengeSession({
      profileId: authCheck.auth!.profileId,
      theme,
      mode,
      inputType,
      dailyFlagVersion: dailyFlagVersion()
    });

    return jsonResponse(
      requestId,
      {
        sessionId: session.id,
        theme: session.theme,
        mode: session.mode,
        inputType: session.inputType,
        startedAt: session.startedAt.toISOString(),
        dailyFlagVersion: session.dailyFlagVersion
      },
      {
        rateLimitHeaders: authCheck.auth?.rateLimitHeaders
      }
    );
  } catch (error) {
    console.error("POST /api/v1/challenge/sessions failed", error);
    return serverError(requestId);
  }
}

export async function GET(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const authCheck = await requireApiAuthAndRateLimit(request, requestId);
    if (authCheck.response) return authCheck.response;

    const sessionId = request.nextUrl.searchParams.get("sessionId");
    if (!sessionId) {
      return badRequest(requestId, "MISSING_SESSION_ID", "Provide sessionId query parameter.");
    }

    const session = await getChallengeSession(authCheck.auth!.profileId, sessionId);
    if (!session) {
      return notFound(requestId, "Session not found.");
    }

    return jsonResponse(
      requestId,
      {
        sessionId: session.id,
        theme: session.theme,
        mode: session.mode,
        inputType: session.inputType,
        status: session.status,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
        dailyFlagVersion: session.dailyFlagVersion,
        solved: session.outcomes.length > 0,
        outcomes: session.outcomes.map((outcome) => ({
          goalType: outcome.goalType,
          solvedAt: outcome.solvedAt.toISOString(),
          solveMs: outcome.solveMs,
          verificationData: outcome.verificationData
        })),
        recentAttempts: session.attempts.map((attempt) => ({
          id: attempt.id,
          source: attempt.source,
          decisionStatus: attempt.decisionStatus,
          executionStatus: attempt.executionStatus,
          moderationStatus: attempt.moderationStatus,
          createdAt: attempt.createdAt.toISOString()
        }))
      },
      {
        rateLimitHeaders: authCheck.auth?.rateLimitHeaders
      }
    );
  } catch (error) {
    console.error("GET /api/v1/challenge/sessions failed", error);
    return serverError(requestId);
  }
}
