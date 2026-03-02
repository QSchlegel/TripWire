import { NextRequest } from "next/server";
import { createProfile } from "@/lib/challenge/service";
import { newRequestId, serverError } from "@/lib/server/api";
import { decodeProfileCookie, writeProfileCookie } from "@/lib/server/cookies";
import { env } from "@/lib/server/env";
import { getOrCreateActiveApiKey } from "@/lib/server/auth";
import { jsonResponse, badRequest } from "@/lib/server/api";
import { prisma } from "@/lib/server/prisma";

interface InitBody {
  handle?: string;
}

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    let body: InitBody = {};
    try {
      body = (await request.json()) as InitBody;
    } catch {
      body = {};
    }

    if (body.handle !== undefined && typeof body.handle !== "string") {
      return badRequest(requestId, "INVALID_HANDLE", "handle must be a string when provided");
    }

    const existingCookie = decodeProfileCookie(request.cookies.get(env.profileCookieName)?.value);

    if (existingCookie) {
      const profile = await prisma.profile.findUnique({ where: { id: existingCookie.profileId } });
      if (profile && profile.handle === existingCookie.handle) {
        const keyResult = await getOrCreateActiveApiKey(profile.id);

        const response = jsonResponse(requestId, {
          profileId: profile.id,
          handle: profile.handle,
          created: false,
          apiKey: keyResult.plaintext ?? null,
          apiKeyPrefix: keyResult.apiKey.prefix
        });

        writeProfileCookie(response, { profileId: profile.id, handle: profile.handle });
        return response;
      }
    }

    const createdProfile = await createProfile(body.handle);
    const keyResult = await getOrCreateActiveApiKey(createdProfile.id);

    const response = jsonResponse(requestId, {
      profileId: createdProfile.id,
      handle: createdProfile.handle,
      created: true,
      apiKey: keyResult.plaintext ?? null,
      apiKeyPrefix: keyResult.apiKey.prefix
    });

    writeProfileCookie(response, {
      profileId: createdProfile.id,
      handle: createdProfile.handle
    });

    return response;
  } catch (error) {
    console.error("/api/v1/profiles/init failed", error);
    return serverError(requestId);
  }
}
