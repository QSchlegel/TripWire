import { NextRequest } from "next/server";
import { forbidden, jsonResponse, newRequestId } from "@/lib/server/api";
import { requireAdminKey } from "@/lib/server/auth";
import { rejectRlCandidate } from "@/lib/rl/training";

interface Params {
  params: Promise<{
    id: string;
  }>;
}

export async function POST(request: NextRequest, context: Params) {
  const requestId = newRequestId();

  try {
    const isAdmin = await requireAdminKey(request);
    if (!isAdmin) {
      return forbidden(requestId, "Invalid x-admin-key");
    }

    const { id } = await context.params;
    let reason: string | undefined;
    try {
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body.reason === "string") {
        reason = body.reason;
      }
    } catch {
      reason = undefined;
    }

    const reviewer = request.headers.get("x-admin-reviewer") ?? "admin";
    const result = await rejectRlCandidate(id, reviewer, reason);

    return jsonResponse(requestId, {
      rejected: true,
      candidateId: result.id,
      status: result.status,
      reviewedAt: result.reviewedAt?.toISOString() ?? null,
      reviewReason: result.reviewReason
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rejection failed";
    console.error("POST /api/v1/admin/rl/candidates/[id]/reject failed", error);
    return jsonResponse(requestId, { error: { code: "REJECTION_FAILED", message } }, { status: 400 });
  }
}
