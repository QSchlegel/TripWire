import { NextRequest } from "next/server";
import { badRequest, forbidden, jsonResponse, newRequestId } from "@/lib/server/api";
import { requireAdminKey } from "@/lib/server/auth";
import { setApiKeyTrainingOptOut } from "@/lib/rl/training";

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

    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.enabled !== "boolean") {
      return badRequest(requestId, "INVALID_ENABLED", "Body must include boolean field: enabled");
    }

    const { id } = await context.params;
    const updated = await setApiKeyTrainingOptOut(id, body.enabled);

    return jsonResponse(requestId, {
      apiKeyId: updated.id,
      isTrainingOptOut: updated.isTrainingOptOut
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update opt-out";
    console.error("POST /api/v1/admin/api-keys/[id]/training-opt-out failed", error);
    return jsonResponse(requestId, { error: { code: "UPDATE_FAILED", message } }, { status: 400 });
  }
}
