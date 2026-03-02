import type { NextRequest, NextResponse } from "next/server";
import { env, isProduction } from "@/lib/server/env";
import { hmacSha256, safeEqualHex } from "@/lib/server/crypto";

export interface ProfileCookieValue {
  profileId: string;
  handle: string;
}

function encodePayload(value: ProfileCookieValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodePayload(payload: string): ProfileCookieValue | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ProfileCookieValue;
    if (!parsed || typeof parsed !== "object") return undefined;
    if (typeof parsed.profileId !== "string" || typeof parsed.handle !== "string") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function sign(payload: string): string {
  return hmacSha256(payload, env.profileCookieSecret);
}

export function encodeProfileCookie(value: ProfileCookieValue): string {
  const payload = encodePayload(value);
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function decodeProfileCookie(raw: string | undefined): ProfileCookieValue | undefined {
  if (!raw) return undefined;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return undefined;

  const expected = sign(payload);
  if (!safeEqualHex(expected, signature)) return undefined;

  return decodePayload(payload);
}

export function readProfileCookie(request: NextRequest): ProfileCookieValue | undefined {
  const raw = request.cookies.get(env.profileCookieName)?.value;
  return decodeProfileCookie(raw);
}

export function writeProfileCookie(response: NextResponse, value: ProfileCookieValue): void {
  response.cookies.set(env.profileCookieName, encodeProfileCookie(value), {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });
}
