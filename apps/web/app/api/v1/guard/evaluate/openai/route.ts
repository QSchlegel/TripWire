import { NextRequest } from "next/server";
import { badRequest, jsonResponse, newRequestId, serverError } from "@/lib/server/api";
import { requireApiAuthAndRateLimit } from "@/lib/server/route-helpers";
import { evaluateExternalGuard } from "@/lib/challenge/engine";
import { providerAdapter } from "@/lib/challenge/provider";
import { getActiveHardeningPatch } from "@/lib/rl/patches";
import { isChallengeMode, isChallengeTheme } from "@/lib/challenge/types";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const authCheck = await requireApiAuthAndRateLimit(request, requestId);
    if (authCheck.response) return authCheck.response;

    const body = (await request.json()) as Record<string, unknown>;
    const toolName = body.tool_name;
    if (typeof toolName !== "string" || toolName.trim().length === 0) {
      return badRequest(requestId, "INVALID_REQUEST", "tool_name is required.");
    }

    const runContext = asRecord(body.run_context);
    const theme = runContext && isChallengeTheme(runContext.theme) ? runContext.theme : undefined;
    const mode = runContext && isChallengeMode(runContext.mode) ? runContext.mode : undefined;

    const textForModeration =
      typeof runContext?.prompt === "string"
        ? runContext.prompt
        : JSON.stringify(body.tool_input ?? body.run_context ?? {});

    const moderation = await providerAdapter.moderate({ text: textForModeration });
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
          openai_guardrail_hook: {
            allowed: false,
            reason: moderation.reasonCode ?? "blocked_by_moderation"
          }
        },
        {
          status: 200,
          rateLimitHeaders: authCheck.auth?.rateLimitHeaders
        }
      );
    }

    const patch = theme && mode ? await getActiveHardeningPatch(theme, mode) : { addBlockedTextRegexes: [], promptAppend: [] };

    const result = await evaluateExternalGuard(
      requestId,
      theme,
      mode,
      {
        toolName,
        args: body.tool_input,
        text: typeof runContext?.prompt === "string" ? runContext.prompt : JSON.stringify(body.tool_input ?? {}),
        sessionId: typeof runContext?.sessionId === "string" ? runContext.sessionId : `openai-${authCheck.auth?.profileId}`,
        actorId: authCheck.auth?.profileId,
        actorType: "agent",
        metadata: runContext
      },
      patch.addBlockedTextRegexes
    );

    return jsonResponse(
      requestId,
      {
        ...result,
        openai_guardrail_hook: {
          allowed: result.decision === "allow",
          decision: result.decision
        }
      },
      {
        status: 200,
        rateLimitHeaders: authCheck.auth?.rateLimitHeaders
      }
    );
  } catch (error) {
    console.error("/api/v1/guard/evaluate/openai failed", error);
    return serverError(requestId);
  }
}
