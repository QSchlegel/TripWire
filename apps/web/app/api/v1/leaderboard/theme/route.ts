import { NextRequest } from "next/server";
import { badRequest, jsonResponse, newRequestId, serverError } from "@/lib/server/api";
import { requireApiAuthAndRateLimit } from "@/lib/server/route-helpers";
import { isChallengeMode, isChallengeTheme } from "@/lib/challenge/types";
import { listThemeLeaderboard } from "@/lib/challenge/service";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const authCheck = await requireApiAuthAndRateLimit(request, requestId);
    if (authCheck.response) return authCheck.response;

    const themeRaw = request.nextUrl.searchParams.get("theme");
    const modeRaw = request.nextUrl.searchParams.get("mode");

    if (!isChallengeTheme(themeRaw)) {
      return badRequest(requestId, "INVALID_THEME", "theme must be one of: devops, wallet, support");
    }

    if (!isChallengeMode(modeRaw)) {
      return badRequest(requestId, "INVALID_MODE", "mode must be vulnerable or hardened");
    }

    const page = Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10);
    const pageSize = Number.parseInt(request.nextUrl.searchParams.get("pageSize") ?? "25", 10);

    const leaderboard = await listThemeLeaderboard(themeRaw, modeRaw, page, pageSize);

    return jsonResponse(
      requestId,
      {
        theme: themeRaw,
        mode: modeRaw,
        ...leaderboard
      },
      {
        rateLimitHeaders: authCheck.auth?.rateLimitHeaders
      }
    );
  } catch (error) {
    console.error("GET /api/v1/leaderboard/theme failed", error);
    return serverError(requestId);
  }
}
