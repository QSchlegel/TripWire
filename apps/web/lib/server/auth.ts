import type { ApiKey, Profile } from "@prisma/client";
import type { NextRequest } from "next/server";
import { env } from "@/lib/server/env";
import { randomToken, sha256 } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import { readProfileCookie } from "@/lib/server/cookies";

const API_KEY_PREFIX = "twk_";

export interface AuthenticatedProfile {
  profile: Profile;
  apiKey: ApiKey;
}

export function hashApiKey(raw: string): string {
  return sha256(raw);
}

export function maskApiKeyPrefix(raw: string): string {
  return raw.slice(0, 12);
}

export function generateApiKey(): { plaintext: string; keyHash: string; prefix: string } {
  const token = `${API_KEY_PREFIX}${randomToken(24)}`;
  return {
    plaintext: token,
    keyHash: hashApiKey(token),
    prefix: maskApiKeyPrefix(token)
  };
}

export function extractApiKeyHeader(request: NextRequest): string | undefined {
  const value = request.headers.get("x-tripwire-api-key")?.trim();
  if (!value || !value.startsWith(API_KEY_PREFIX)) return undefined;
  return value;
}

export function extractClientIp(request: NextRequest): string {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return "0.0.0.0";
}

export async function requireProfileFromCookie(request: NextRequest): Promise<Profile | undefined> {
  const cookie = readProfileCookie(request);
  if (!cookie) return undefined;

  const profile = await prisma.profile.findUnique({ where: { id: cookie.profileId } });
  if (!profile) return undefined;

  if (profile.handle !== cookie.handle) {
    return undefined;
  }

  await prisma.profile.update({
    where: { id: profile.id },
    data: { lastSeenAt: new Date() }
  });

  return profile;
}

export async function authenticateApiKey(
  request: NextRequest
): Promise<AuthenticatedProfile | undefined> {
  const headerKey = extractApiKeyHeader(request);
  if (!headerKey) return undefined;

  const keyHash = hashApiKey(headerKey);
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash }
  });

  if (!apiKey || apiKey.status !== "ACTIVE") return undefined;

  const profile = await prisma.profile.findUnique({ where: { id: apiKey.profileId } });
  if (!profile) return undefined;

  await prisma.profile.update({
    where: { id: profile.id },
    data: { lastSeenAt: new Date() }
  });

  return { profile, apiKey };
}

export async function requireAdminKey(request: NextRequest): Promise<boolean> {
  const header = request.headers.get("x-admin-key")?.trim();
  if (!header) return false;
  return header === env.adminApiKey;
}

export async function getOrCreateActiveApiKey(profileId: string): Promise<{ plaintext?: string; apiKey: ApiKey }> {
  const active = await prisma.apiKey.findFirst({
    where: { profileId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" }
  });

  if (active) {
    return { apiKey: active };
  }

  const generated = generateApiKey();
  const apiKey = await prisma.apiKey.create({
    data: {
      profileId,
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      status: "ACTIVE"
    }
  });

  return { plaintext: generated.plaintext, apiKey };
}

export async function revokeActiveApiKeys(profileId: string): Promise<void> {
  await prisma.apiKey.updateMany({
    where: { profileId, status: "ACTIVE" },
    data: {
      status: "REVOKED",
      revokedAt: new Date()
    }
  });
}

export async function rotateApiKey(profileId: string): Promise<{ plaintext: string; apiKey: ApiKey }> {
  await revokeActiveApiKeys(profileId);
  const generated = generateApiKey();
  const apiKey = await prisma.apiKey.create({
    data: {
      profileId,
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      status: "ACTIVE"
    }
  });

  return { plaintext: generated.plaintext, apiKey };
}
