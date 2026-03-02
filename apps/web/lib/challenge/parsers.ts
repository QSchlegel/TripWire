import type { ChallengeMode, ChallengeTheme, ExternalEvalRequestNative } from "@/lib/challenge/types";
import { isChallengeMode, isChallengeTheme } from "@/lib/challenge/types";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

export function parseNativeEvalRequest(body: unknown): {
  request?: ExternalEvalRequestNative;
  theme?: ChallengeTheme;
  mode?: ChallengeMode;
  error?: string;
} {
  const row = asRecord(body);
  if (!row) {
    return { error: "Body must be a JSON object." };
  }

  const toolName = row.toolName;
  if (typeof toolName !== "string" || toolName.trim().length === 0) {
    return { error: "toolName is required and must be a string." };
  }

  const theme = isChallengeTheme(row.theme) ? row.theme : undefined;
  const mode = isChallengeMode(row.mode) ? row.mode : undefined;

  const destination = asRecord(row.destination);

  return {
    theme,
    mode,
    request: {
      toolName,
      text: typeof row.text === "string" ? row.text : undefined,
      intent: typeof row.intent === "string" ? row.intent : undefined,
      args: row.args,
      destination:
        destination && (typeof destination.domain === "string" || typeof destination.url === "string")
          ? {
              domain: typeof destination.domain === "string" ? destination.domain : undefined,
              url: typeof destination.url === "string" ? destination.url : undefined
            }
          : undefined,
      actorId: typeof row.actorId === "string" ? row.actorId : undefined,
      actorType: typeof row.actorType === "string" ? row.actorType : undefined,
      sessionId: typeof row.sessionId === "string" ? row.sessionId : undefined,
      ts: typeof row.ts === "string" ? row.ts : undefined,
      metadata: asRecord(row.metadata)
    }
  };
}
