import { NextRequest } from "next/server";
import { badRequest, jsonResponse, newRequestId, serverError } from "@/lib/server/api";
import { requireApiAuthAndRateLimit } from "@/lib/server/route-helpers";
import { evaluateExternalGuard } from "@/lib/challenge/engine";
import { parseNativeEvalRequest } from "@/lib/challenge/parsers";
import { getActiveHardeningPatch } from "@/lib/rl/patches";
import { providerAdapter } from "@/lib/challenge/provider";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const authCheck = await requireApiAuthAndRateLimit(request, requestId);
    if (authCheck.response) return authCheck.response;

    const body = await request.json();
    const parsed = parseNativeEvalRequest(body);
    if (!parsed.request) {
      return badRequest(requestId, "INVALID_REQUEST", parsed.error ?? "Invalid payload");
    }

    const moderation = await providerAdapter.moderate({
      text: parsed.request.text ?? JSON.stringify(parsed.request.args ?? {})
    });

    if (moderation.blocked) {
      return jsonResponse(
        requestId,
        {
          requestId,
          decision: "block",
          policyDecision: "block",
          findings: [],
          anomaly: {
            score: 0,
            proposedAction: "allow",
            signals: {
              frequencyZScore: 0,
              burstCount: 0,
              novelTool: false,
              novelDomain: false,
              novelTemplate: false,
              argShapeDrift: false
            },
            reasons: ["blocked_by_moderation"],
            triggeredRules: []
          },
          unsupportedByPolicy: false,
          chainOfCommand: { status: "not_applicable", reviewTrail: [] },
          latencyMs: 0,
          challengeMeta: {
            theme: parsed.theme,
            mode: parsed.mode,
            notes: [`blocked_by_moderation:${moderation.reasonCode ?? "policy"}`]
          }
        },
        {
          status: 200,
          rateLimitHeaders: authCheck.auth?.rateLimitHeaders
        }
      );
    }

    const patch =
      parsed.theme && parsed.mode
        ? await getActiveHardeningPatch(parsed.theme, parsed.mode)
        : { addBlockedTextRegexes: [], promptAppend: [] };

    const result = await evaluateExternalGuard(
      requestId,
      parsed.theme,
      parsed.mode,
      {
        ...parsed.request,
        actorId: parsed.request.actorId ?? authCheck.auth?.profileId,
        sessionId: parsed.request.sessionId ?? `ext-${authCheck.auth?.profileId}`
      },
      patch.addBlockedTextRegexes
    );

    return jsonResponse(requestId, result, {
      status: 200,
      rateLimitHeaders: authCheck.auth?.rateLimitHeaders
    });
  } catch (error) {
    console.error("/api/v1/guard/evaluate failed", error);
    return serverError(requestId);
  }
}
