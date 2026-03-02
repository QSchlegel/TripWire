import type { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, extractClientIp, requireProfileFromCookie } from "@/lib/server/auth";
import { tooManyRequests, unauthorized } from "@/lib/server/api";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export interface AuthResult {
  profileId: string;
  handle: string;
  apiKeyId: string;
  rateLimitHeaders: Record<string, string>;
}

export async function requireApiAuthAndRateLimit(
  request: NextRequest,
  requestId: string
): Promise<{ auth?: AuthResult; response?: NextResponse }> {
  const auth = await authenticateApiKey(request);
  if (!auth) {
    return {
      response: unauthorized(requestId, "Missing or invalid x-tripwire-api-key")
    };
  }

  const clientIp = extractClientIp(request);
  const identity = `${auth.profile.id}:${auth.apiKey.id}:${clientIp}`;
  const limit = await enforceRateLimit(identity);

  if (!limit.allowed) {
    return {
      response: tooManyRequests(
        requestId,
        "Rate limit exceeded. Slow down and retry once the window resets.",
        limit.headers
      )
    };
  }

  return {
    auth: {
      profileId: auth.profile.id,
      handle: auth.profile.handle,
      apiKeyId: auth.apiKey.id,
      rateLimitHeaders: limit.headers as Record<string, string>
    }
  };
}

export async function requireCookieProfile(request: NextRequest, requestId: string): Promise<{
  profileId?: string;
  handle?: string;
  response?: NextResponse;
}> {
  const profile = await requireProfileFromCookie(request);
  if (!profile) {
    return {
      response: unauthorized(requestId, "Profile cookie missing or invalid. Initialize profile first.")
    };
  }

  return {
    profileId: profile.id,
    handle: profile.handle
  };
}
