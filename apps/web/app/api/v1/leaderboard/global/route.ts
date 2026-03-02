import { NextRequest } from "next/server";
import { jsonResponse, newRequestId, serverError } from "@/lib/server/api";
import { requireApiAuthAndRateLimit } from "@/lib/server/route-helpers";
import { listGlobalLeaderboard } from "@/lib/challenge/service";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const authCheck = await requireApiAuthAndRateLimit(request, requestId);
    if (authCheck.response) return authCheck.response;

    const page = Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10);
    const pageSize = Number.parseInt(request.nextUrl.searchParams.get("pageSize") ?? "25", 10);

    const leaderboard = await listGlobalLeaderboard(page, pageSize);

    return jsonResponse(requestId, leaderboard, {
      rateLimitHeaders: authCheck.auth?.rateLimitHeaders
    });
  } catch (error) {
    console.error("GET /api/v1/leaderboard/global failed", error);
    return serverError(requestId);
  }
}
