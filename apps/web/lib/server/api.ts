import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export interface RateLimitHeaders {
  "X-RateLimit-Limit-Minute"?: string;
  "X-RateLimit-Limit-Day"?: string;
  "X-RateLimit-Remaining-Minute"?: string;
  "X-RateLimit-Remaining-Day"?: string;
  "X-RateLimit-Reset-Minute"?: string;
  "X-RateLimit-Reset-Day"?: string;
}

export function newRequestId(): string {
  return randomUUID();
}

export function jsonResponse<T>(
  requestId: string,
  body: T,
  init?: {
    status?: number;
    rateLimitHeaders?: RateLimitHeaders;
    extraHeaders?: Record<string, string>;
  }
): NextResponse<T> {
  const response = NextResponse.json(body, { status: init?.status ?? 200 });
  response.headers.set("X-Request-Id", requestId);

  for (const [key, value] of Object.entries(init?.rateLimitHeaders ?? {})) {
    if (value) response.headers.set(key, value);
  }

  for (const [key, value] of Object.entries(init?.extraHeaders ?? {})) {
    response.headers.set(key, value);
  }

  return response;
}

export function badRequest(requestId: string, code: string, message: string): NextResponse {
  return jsonResponse(requestId, { error: { code, message } }, { status: 400 });
}

export function unauthorized(requestId: string, message = "Unauthorized"): NextResponse {
  return jsonResponse(requestId, { error: { code: "UNAUTHORIZED", message } }, { status: 401 });
}

export function forbidden(requestId: string, message = "Forbidden"): NextResponse {
  return jsonResponse(requestId, { error: { code: "FORBIDDEN", message } }, { status: 403 });
}

export function notFound(requestId: string, message = "Not found"): NextResponse {
  return jsonResponse(requestId, { error: { code: "NOT_FOUND", message } }, { status: 404 });
}

export function tooManyRequests(
  requestId: string,
  message: string,
  rateLimitHeaders?: RateLimitHeaders
): NextResponse {
  return jsonResponse(
    requestId,
    {
      error: {
        code: "RATE_LIMITED",
        message
      }
    },
    { status: 429, rateLimitHeaders }
  );
}

export function serverError(requestId: string, message = "Internal server error"): NextResponse {
  return jsonResponse(requestId, { error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
}
