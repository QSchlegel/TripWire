import type { NormalizedToolEvent, ToolCallContext } from "../types/index.js";
import { hashString } from "../utils/hash.js";
import { argShapeSignature, sanitizeText, stableStringify } from "../utils/serialize.js";

function extractDomain(raw?: string): string | undefined {
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    return url.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function asEpochMs(ts: string): number {
  const parsed = Date.parse(ts);
  if (Number.isNaN(parsed)) return Date.now();
  return parsed;
}

function normalizeText(context: ToolCallContext): string {
  if (context.text && context.text.trim()) return context.text;
  if (context.intent && context.intent.trim()) return context.intent;
  if (context.args !== undefined) return stableStringify(context.args);
  return "";
}

export function normalizeToolCall(context: ToolCallContext): NormalizedToolEvent {
  const ts = context.ts ?? new Date().toISOString();
  const text = normalizeText(context);
  const intent = context.intent ?? text;
  const destinationUrl = context.destination?.url;
  const destinationDomain = context.destination?.domain?.toLowerCase() ?? extractDomain(destinationUrl);
  const args = context.args ?? {};
  const actionTemplate = sanitizeText(`${context.toolName} ${text}`);
  const shape = argShapeSignature(args);

  const identityPayload = {
    ts,
    sessionId: context.sessionId ?? "default-session",
    actorId: context.actorId ?? "anonymous",
    toolName: context.toolName,
    text,
    destinationDomain,
    shape
  };

  return {
    eventId: hashString(stableStringify(identityPayload)),
    ts,
    epochMs: asEpochMs(ts),
    sessionId: context.sessionId ?? "default-session",
    actorId: context.actorId ?? "anonymous",
    actorType: context.actorType ?? "agent",
    toolName: context.toolName,
    text,
    intent,
    args,
    destinationDomain,
    destinationUrl,
    actionTemplate,
    argShapeSignature: shape,
    metadata: context.metadata
  };
}
