import { NextRequest } from "next/server";
import { newRequestId, serverError } from "@/lib/server/api";
import { jsonResponse } from "@/lib/server/api";
import { requireCookieProfile } from "@/lib/server/route-helpers";
import { revokeActiveApiKeys } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const cookieProfile = await requireCookieProfile(request, requestId);
    if (cookieProfile.response) return cookieProfile.response;

    await revokeActiveApiKeys(cookieProfile.profileId!);

    return jsonResponse(requestId, {
      revoked: true,
      message: "Active API key revoked. Rotate to continue API access."
    });
  } catch (error) {
    console.error("/api/v1/keys/revoke failed", error);
    return serverError(requestId);
  }
}
