import { InMemoryRateLimitStore } from "./stores.js";
import type {
  PrescreenRejectReason,
  PrescreenWebhookRequestInput,
  PrescreenWebhookResult,
  RateLimitStore,
  WebhookPrescreenConfig
} from "./types.js";

const defaultRateLimitStore = new InMemoryRateLimitStore();

const BOT_ID_PATTERN = /^[A-Za-z0-9._:-]{3,128}$/;

export const defaultWebhookPrescreenConfig: WebhookPrescreenConfig = {
  maxBodyBytes: 256 * 1024,
  botIdPattern: BOT_ID_PATTERN,
  allowIps: [],
  denyIps: [],
  rateLimitPerMinute: 60,
  rateLimitWindowMs: 60_000,
  requireJsonContentType: true
};

export async function prescreenWebhookRequest(
  input: PrescreenWebhookRequestInput
): Promise<PrescreenWebhookResult> {
  const config = resolveConfig(input.config);
  const now = input.now ?? new Date();
  const rawBody = Buffer.isBuffer(input.rawBody) ? input.rawBody : Buffer.from(input.rawBody, "utf8");

  if (input.method.toUpperCase() !== "POST") {
    return reject(405, "method-not-allowed", "Only POST is allowed for webhook ingress.");
  }

  if (!config.botIdPattern.test(input.botId)) {
    return reject(400, "invalid-bot-id", "Bot ID must match [A-Za-z0-9._:-]{3,128}.");
  }

  const clientIp = normalizeIp(input.clientIp);
  if (clientIp && config.denyIps.includes(clientIp)) {
    return reject(403, "denied-ip", "Client IP is denylisted.");
  }

  if (config.allowIps.length > 0 && (!clientIp || !config.allowIps.includes(clientIp))) {
    return reject(403, "ip-not-allowlisted", "Client IP is not allowlisted.");
  }

  if (config.requireJsonContentType && !isJsonContentType(input.contentType)) {
    return reject(415, "unsupported-content-type", "Only application/json content type is accepted.");
  }

  if (rawBody.byteLength > config.maxBodyBytes) {
    return reject(413, "payload-too-large", `Body exceeds ${config.maxBodyBytes} bytes.`);
  }

  const limiter = input.rateLimitStore ?? defaultRateLimitStore;
  if (config.rateLimitPerMinute > 0) {
    const key = `${input.botId}:${clientIp ?? "unknown"}`;
    const hit = await applyRateLimit(limiter, key, config.rateLimitWindowMs);
    if (hit.count > config.rateLimitPerMinute) {
      return reject(429, "rate-limit", "Ingress rate limit exceeded for this bot/IP window.");
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return reject(400, "invalid-json", "Body must be valid JSON.");
  }

  if (!isRecord(parsed)) {
    return reject(422, "invalid-schema", "JSON body must be an object.");
  }

  const event = parsed.event;
  if (typeof event !== "string" || event.trim().length === 0) {
    return reject(422, "invalid-schema", "Body.event must be a non-empty string.");
  }

  const payload = parsed.payload;
  if (!isRecord(payload)) {
    return reject(422, "invalid-schema", "Body.payload must be an object.");
  }

  const timestamp = parsed.timestamp;
  if (timestamp !== undefined && typeof timestamp !== "string" && typeof timestamp !== "number") {
    return reject(422, "invalid-schema", "Body.timestamp must be a string or number when provided.");
  }

  const meta = parsed.meta;
  if (meta !== undefined && !isRecord(meta)) {
    return reject(422, "invalid-schema", "Body.meta must be an object when provided.");
  }

  return {
    ok: true,
    status: 202,
    accepted: {
      botId: input.botId,
      event,
      payload,
      timestamp,
      meta,
      receivedAt: now.toISOString(),
      bodyBytes: rawBody.byteLength,
      rawBody: rawBody.toString("utf8")
    }
  };
}

function resolveConfig(config: Partial<WebhookPrescreenConfig> | undefined): WebhookPrescreenConfig {
  return {
    ...defaultWebhookPrescreenConfig,
    ...config,
    allowIps: config?.allowIps ?? defaultWebhookPrescreenConfig.allowIps,
    denyIps: config?.denyIps ?? defaultWebhookPrescreenConfig.denyIps
  };
}

function reject(
  status: 400 | 403 | 405 | 413 | 415 | 422 | 429,
  reason: PrescreenRejectReason,
  detail: string
): PrescreenWebhookResult {
  return {
    ok: false,
    status,
    reason,
    detail
  };
}

function normalizeIp(clientIp: string | null | undefined): string | null {
  if (!clientIp) {
    return null;
  }

  return clientIp.split(",")[0]?.trim() || null;
}

function isJsonContentType(contentType: string | null | undefined): boolean {
  if (!contentType) {
    return false;
  }

  const [main] = contentType.toLowerCase().split(";");
  return main.trim() === "application/json";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function applyRateLimit(store: RateLimitStore, key: string, windowMs: number) {
  return store.increment(key, windowMs);
}
