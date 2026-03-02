import { NextRequest } from "next/server";
import { newRequestId, serverError, notFound } from "@/lib/server/api";
import { jsonResponse } from "@/lib/server/api";
import { requireCookieProfile } from "@/lib/server/route-helpers";
import { prisma } from "@/lib/server/prisma";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const cookieProfile = await requireCookieProfile(request, requestId);
    if (cookieProfile.response) return cookieProfile.response;

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        profileId: cookieProfile.profileId,
        status: "ACTIVE"
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (!apiKey) {
      return notFound(requestId, "No active API key found for this profile.");
    }

    return jsonResponse(requestId, {
      keyId: apiKey.id,
      prefix: apiKey.prefix,
      status: apiKey.status,
      createdAt: apiKey.createdAt.toISOString(),
      isTrainingOptOut: apiKey.isTrainingOptOut
    });
  } catch (error) {
    console.error("/api/v1/keys/current failed", error);
    return serverError(requestId);
  }
}
