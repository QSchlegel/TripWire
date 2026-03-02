import { NextRequest } from "next/server";
import { forbidden, jsonResponse, newRequestId, serverError } from "@/lib/server/api";
import { requireAdminKey } from "@/lib/server/auth";
import { approveRlCandidate } from "@/lib/rl/training";

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
    const reviewer = request.headers.get("x-admin-reviewer") ?? "admin";

    const result = await approveRlCandidate(id, reviewer);

    return jsonResponse(requestId, {
      approved: true,
      ...result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Approval failed";
    console.error("POST /api/v1/admin/rl/candidates/[id]/approve failed", error);
    return jsonResponse(requestId, { error: { code: "APPROVAL_FAILED", message } }, { status: 400 });
  }
}
