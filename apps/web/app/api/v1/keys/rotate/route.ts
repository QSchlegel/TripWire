import { NextRequest } from "next/server";
import { newRequestId, serverError } from "@/lib/server/api";
import { jsonResponse } from "@/lib/server/api";
import { requireCookieProfile } from "@/lib/server/route-helpers";
import { rotateApiKey } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const cookieProfile = await requireCookieProfile(request, requestId);
    if (cookieProfile.response) return cookieProfile.response;

    const rotated = await rotateApiKey(cookieProfile.profileId!);

    return jsonResponse(requestId, {
      keyId: rotated.apiKey.id,
      prefix: rotated.apiKey.prefix,
      apiKey: rotated.plaintext,
      createdAt: rotated.apiKey.createdAt.toISOString()
    });
  } catch (error) {
    console.error("/api/v1/keys/rotate failed", error);
    return serverError(requestId);
  }
}
