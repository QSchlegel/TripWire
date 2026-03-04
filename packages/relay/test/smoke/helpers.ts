import { randomUUID } from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import { signRelayDelivery } from "../../src/index.js";
import type { RelayQueuedDelivery } from "../../src/types.js";

export type SmokeMode = "contract" | "local" | "hosted-public";

export interface SmokeEnv {
  mode: SmokeMode;
  baseUrl: string;
  timeoutMs: number;
  sharedSecret?: string;
  botIdPrefix: string;
  requireTunnel: boolean;
}

export interface JsonHttpResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

export interface MockRelayServer {
  readonly baseUrl: string;
  readonly state: {
    pulls: Array<{ botId: string; maxBatch?: number; waitMs?: number }>;
    acks: Array<Record<string, unknown>>;
    nacks: Array<Record<string, unknown>>;
  };
  enqueue(delivery: RelayQueuedDelivery): void;
  close(): Promise<void>;
}

interface SignedDeliveryInput {
  botId: string;
  secret: string;
  requestId: string;
  event: string;
  payload: Record<string, unknown>;
  meta?: Record<string, unknown>;
  method?: string;
  path?: string;
  timestamp?: string;
  nonce?: string;
}

export function resolveSmokeEnv(): SmokeEnv {
  const mode = toSmokeMode(process.env.SMOKE_MODE);
  const baseUrl = process.env.SMOKE_BASE_URL ?? (mode === "hosted-public" ? "https://bot-relay.com" : "http://localhost:3000");
  const timeoutRaw = Number.parseInt(process.env.SMOKE_TIMEOUT_MS ?? "15000", 10);
  const timeoutMs = Number.isFinite(timeoutRaw) ? timeoutRaw : 15_000;
  const requireTunnelDefault = mode === "hosted-public" ? false : true;

  return {
    mode,
    baseUrl,
    timeoutMs,
    sharedSecret: process.env.SMOKE_SHARED_SECRET,
    botIdPrefix: process.env.SMOKE_BOT_ID_PREFIX ?? "smoke-relay",
    requireTunnel: parseBoolean(process.env.SMOKE_REQUIRE_TUNNEL, requireTunnelDefault)
  };
}

export async function postJson(url: string, body: unknown): Promise<JsonHttpResponse> {
  return requestJson(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

export async function getJson(url: string): Promise<JsonHttpResponse> {
  return requestJson(url, {
    method: "GET"
  });
}

export async function requestJson(url: string, init: RequestInit): Promise<JsonHttpResponse> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = text;

  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    status: response.status,
    body,
    headers: response.headers
  };
}

export function createEphemeralBotId(prefix: string): string {
  const compact = randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}-${compact}`;
}

export function logSkip(reason: string, details: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({
    type: "smoke-skip",
    reason,
    ...details
  })}\n`);
}

export async function startMockRelayServer(): Promise<MockRelayServer> {
  const queue: RelayQueuedDelivery[] = [];
  const state = {
    pulls: [] as Array<{ botId: string; maxBatch?: number; waitMs?: number }>,
    acks: [] as Array<Record<string, unknown>>,
    nacks: [] as Array<Record<string, unknown>>
  };

  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const url = new URL(request.url, "http://localhost");
    const bodyText = await readBody(request);

    if (request.method === "POST" && url.pathname === "/api/relay/runtime/pull") {
      const payload = safeParseObject(bodyText);
      const botId = typeof payload?.botId === "string" ? payload.botId : "";
      const maxBatch = typeof payload?.maxBatch === "number" ? payload.maxBatch : undefined;
      const waitMs = typeof payload?.waitMs === "number" ? payload.waitMs : undefined;
      state.pulls.push({ botId, maxBatch, waitMs });

      const limit = maxBatch && maxBatch > 0 ? maxBatch : queue.length;
      const deliveries = queue.splice(0, limit);

      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ deliveries }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/relay/runtime/ack") {
      state.acks.push(safeParseObject(bodyText) ?? {});
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/relay/runtime/nack") {
      state.nacks.push(safeParseObject(bodyText) ?? {});
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "not-found" }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("failed-to-bind-mock-relay");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    state,
    enqueue(delivery: RelayQueuedDelivery) {
      queue.push(delivery);
    },
    async close() {
      server.close();
      await once(server, "close");
    }
  };
}

export function createSignedQueuedDelivery(input: SignedDeliveryInput): RelayQueuedDelivery {
  const method = input.method ?? "POST";
  const path = input.path ?? "/runtime/events";
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? `nonce-${randomUUID().slice(0, 8)}`;

  const rawBody = JSON.stringify({
    requestId: input.requestId,
    event: input.event,
    payload: input.payload,
    meta: input.meta,
    receivedAt: new Date().toISOString()
  });

  const signature = signRelayDelivery({
    method,
    path,
    timestamp,
    nonce,
    rawBody: Buffer.from(rawBody, "utf8"),
    secret: input.secret
  });

  return {
    requestId: input.requestId,
    botId: input.botId,
    method,
    path,
    timestamp,
    nonce,
    signature,
    rawBody
  };
}

function toSmokeMode(value: string | undefined): SmokeMode {
  if (value === "contract" || value === "local" || value === "hosted-public") {
    return value;
  }

  return "local";
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  return raw === "1" || raw.toLowerCase() === "true";
}

function safeParseObject(value: string): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return null;
  } catch {
    return null;
  }
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    request.on("error", reject);
  });
}
