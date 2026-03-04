import {
  InMemoryIdempotencyStore,
  InMemoryNonceStore
} from "./stores.js";
import { verifyRelaySignature } from "./security.js";
import type {
  IdempotencyStore,
  IdempotencyRecord,
  NonceStore,
  RelayAckInput,
  RelayDelivery,
  RelayDeliveryHandler,
  RelayEventEnvelope,
  RelayNackInput,
  RelayQueuedDelivery,
  RelayRuntime,
  RelayRuntimeConfig,
  RelayRuntimeCycleResult,
  RelayRuntimeEndpoints,
  RelayRuntimePollConfig,
  RelayRuntimeSecurityConfig,
  RetryConfig
} from "./types.js";

const DEFAULT_ENDPOINTS: RelayRuntimeEndpoints = {
  pull: "/api/relay/runtime/pull",
  ack: "/api/relay/runtime/ack",
  nack: "/api/relay/runtime/nack"
};

const DEFAULT_RETRY: RetryConfig = {
  baseMs: 500,
  factor: 2,
  maxMs: 30_000,
  jitter: 0.25
};

const DEFAULT_SECURITY: RelayRuntimeSecurityConfig = {
  maxSkewSeconds: 300,
  nonceTtlSeconds: 600,
  idempotencyTtlSeconds: 86_400
};

const DEFAULT_POLL: RelayRuntimePollConfig = {
  maxBatch: 20,
  waitMs: 2_500,
  idleMs: 250
};

interface ResolvedRuntimeConfig {
  relayUrl: string;
  botId: string;
  sharedSecret: string;
  endpoints: RelayRuntimeEndpoints;
  retry: RetryConfig;
  security: RelayRuntimeSecurityConfig;
  poll: RelayRuntimePollConfig;
  nonceStore: NonceStore;
  idempotencyStore: IdempotencyStore;
  fetchImpl: typeof fetch;
  logger?: RelayRuntimeConfig["logger"];
}

interface VerifyTransportResult {
  ok: true;
}

interface VerifyTransportFailure {
  ok: false;
  reason: string;
}

export function createRelayRuntime(config: RelayRuntimeConfig): RelayRuntime {
  const resolved = resolveRuntimeConfig(config);
  return new RelayRuntimeImpl(resolved);
}

export function computeBackoffMs(attempt: number, config: RetryConfig, random = Math.random): number {
  const safeAttempt = Math.max(0, attempt);
  const safeJitter = Math.max(0, Math.min(1, config.jitter));
  const base = Math.min(config.maxMs, config.baseMs * Math.pow(config.factor, safeAttempt));
  const jitterRange = base * safeJitter;
  const jitterOffset = (random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(base + jitterOffset));
}

class RelayRuntimeImpl implements RelayRuntime {
  private deliveryHandler: RelayDeliveryHandler | null = null;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(private readonly config: ResolvedRuntimeConfig) {}

  onDelivery(handler: RelayDeliveryHandler): void {
    this.deliveryHandler = handler;
  }

  async connect(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.loopPromise = this.pollLoop();
  }

  async disconnect(): Promise<void> {
    this.running = false;
    await this.loopPromise;
    this.loopPromise = null;
  }

  async runOnce(): Promise<RelayRuntimeCycleResult> {
    return this.executeCycle();
  }

  async acknowledgeDelivery(data: RelayQueuedDelivery, input: RelayAckInput = {}): Promise<void> {
    await this.postOutcome(this.config.endpoints.ack, {
      botId: data.botId,
      requestId: data.requestId,
      status: "ack",
      detail: input.detail
    });

    await this.markIdempotency(data.botId, data.requestId, {
      status: "acked",
      detail: input.detail,
      updatedAt: new Date().toISOString()
    });
  }

  async rejectDelivery(data: RelayQueuedDelivery, input: RelayNackInput = {}): Promise<void> {
    const retryable = input.retryable ?? false;
    await this.postOutcome(this.config.endpoints.nack, {
      botId: data.botId,
      requestId: data.requestId,
      status: "nack",
      retryable,
      detail: input.detail,
      code: input.code
    });

    const existing = await this.config.idempotencyStore.get(data.botId, data.requestId);
    if (existing?.status === "acked") {
      return;
    }

    await this.markIdempotency(data.botId, data.requestId, {
      status: "nacked",
      detail: input.detail,
      retryable,
      updatedAt: new Date().toISOString()
    });
  }

  private async pollLoop(): Promise<void> {
    let attempt = 0;

    while (this.running) {
      try {
        await this.executeCycle();
        attempt = 0;
        if (this.running) {
          await sleep(this.config.poll.idleMs);
        }
      } catch (error) {
        this.log("error", "relay-runtime-cycle-failed", { attempt }, error);
        const delay = computeBackoffMs(attempt, this.config.retry);
        attempt += 1;
        if (this.running) {
          await sleep(delay);
        }
      }
    }
  }

  private async executeCycle(): Promise<RelayRuntimeCycleResult> {
    const deliveries = await this.pullDeliveries();
    let processed = 0;

    for (const delivery of deliveries) {
      await this.processDelivery(delivery);
      processed += 1;
    }

    return {
      pulled: deliveries.length,
      processed
    };
  }

  private async pullDeliveries(): Promise<RelayQueuedDelivery[]> {
    const response = await this.config.fetchImpl(resolveUrl(this.config.relayUrl, this.config.endpoints.pull), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        botId: this.config.botId,
        maxBatch: this.config.poll.maxBatch,
        waitMs: this.config.poll.waitMs
      })
    });

    if (!response.ok) {
      throw new Error(`pull-failed:${response.status}`);
    }

    const payload = (await response.json()) as { deliveries?: unknown };
    if (!Array.isArray(payload.deliveries)) {
      throw new Error("pull-invalid-response");
    }

    return payload.deliveries.map(parseQueuedDelivery);
  }

  private async processDelivery(data: RelayQueuedDelivery): Promise<void> {
    if (data.botId !== this.config.botId) {
      await this.rejectDelivery(data, {
        retryable: false,
        code: "bot-id-mismatch",
        detail: `delivery botId ${data.botId} does not match runtime botId ${this.config.botId}`
      });
      return;
    }

    const verified = await this.verifyTransport(data);
    if (!verified.ok) {
      await this.rejectDelivery(data, {
        retryable: false,
        code: verified.reason,
        detail: verified.reason
      });
      return;
    }

    const existing = await this.config.idempotencyStore.get(data.botId, data.requestId);
    if (existing?.status === "acked") {
      await this.acknowledgeDelivery(data, {
        detail: "duplicate-already-acked"
      });
      return;
    }

    if (existing?.status === "processing") {
      await this.rejectDelivery(data, {
        retryable: true,
        code: "duplicate-in-flight",
        detail: "duplicate-in-flight"
      });
      return;
    }

    await this.markIdempotency(data.botId, data.requestId, {
      status: "processing",
      updatedAt: new Date().toISOString()
    });

    const parsedEnvelope = parseEnvelope(data.rawBody, data.requestId);
    if (!parsedEnvelope.ok) {
      await this.rejectDelivery(data, {
        retryable: false,
        code: parsedEnvelope.reason,
        detail: parsedEnvelope.reason
      });
      return;
    }

    const delivery = new RelayDeliveryImpl(this, data, parsedEnvelope.envelope);

    if (!this.deliveryHandler) {
      await delivery.nack({
        retryable: true,
        code: "no-handler",
        detail: "No delivery handler has been registered via runtime.onDelivery()."
      });
      return;
    }

    try {
      await this.deliveryHandler(delivery);
      if (!delivery.hasResponded()) {
        await delivery.ack({ detail: "processed" });
      }
    } catch (error) {
      if (!delivery.hasResponded()) {
        await delivery.nack({
          retryable: true,
          code: "handler-error",
          detail: stringifyError(error)
        });
      }
    }
  }

  private async verifyTransport(data: RelayQueuedDelivery): Promise<VerifyTransportResult | VerifyTransportFailure> {
    const rawBody = Buffer.from(data.rawBody, "utf8");
    const signatureCheck = verifyRelaySignature({
      method: data.method,
      path: data.path,
      rawBody,
      botId: data.botId,
      timestamp: data.timestamp,
      nonce: data.nonce,
      signature: data.signature,
      secret: this.config.sharedSecret,
      maxSkewSeconds: this.config.security.maxSkewSeconds
    });

    if (!signatureCheck.ok) {
      return { ok: false, reason: signatureCheck.reason };
    }

    const nonceKey = `${data.botId}:${data.timestamp}:${data.nonce}`;
    const isFreshNonce = await this.config.nonceStore.consume(nonceKey, this.config.security.nonceTtlSeconds);
    if (!isFreshNonce) {
      return { ok: false, reason: "nonce-replay" };
    }

    return { ok: true };
  }

  private async markIdempotency(botId: string, requestId: string, record: IdempotencyRecord): Promise<void> {
    await this.config.idempotencyStore.set(
      botId,
      requestId,
      record,
      this.config.security.idempotencyTtlSeconds
    );
  }

  private async postOutcome(path: string, payload: Record<string, unknown>): Promise<void> {
    const response = await this.config.fetchImpl(resolveUrl(this.config.relayUrl, path), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`outcome-failed:${path}:${response.status}`);
    }
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    context?: Record<string, unknown>,
    error?: unknown
  ): void {
    this.config.logger?.({
      level,
      message,
      botId: this.config.botId,
      context,
      error
    });
  }
}

class RelayDeliveryImpl implements RelayDelivery {
  private responded = false;

  readonly requestId: string;
  readonly botId: string;
  readonly event: string;
  readonly payload: Record<string, unknown>;
  readonly meta: Record<string, unknown>;
  readonly receivedAt?: string;
  readonly rawBody: string;

  constructor(
    private readonly runtime: RelayRuntimeImpl,
    private readonly data: RelayQueuedDelivery,
    envelope: RelayEventEnvelope
  ) {
    this.requestId = data.requestId;
    this.botId = data.botId;
    this.event = envelope.event;
    this.payload = envelope.payload;
    this.meta = envelope.meta ?? {};
    this.receivedAt = envelope.receivedAt;
    this.rawBody = data.rawBody;
  }

  async verify(): Promise<void> {
    return Promise.resolve();
  }

  async ack(input: RelayAckInput = {}): Promise<void> {
    if (this.responded) {
      return;
    }

    await this.runtime.acknowledgeDelivery(this.data, input);
    this.responded = true;
  }

  async nack(input: RelayNackInput = {}): Promise<void> {
    if (this.responded) {
      return;
    }

    await this.runtime.rejectDelivery(this.data, input);
    this.responded = true;
  }

  hasResponded(): boolean {
    return this.responded;
  }
}

function resolveRuntimeConfig(config: RelayRuntimeConfig): ResolvedRuntimeConfig {
  if (!config.relayUrl?.trim()) {
    throw new Error("relayUrl is required");
  }

  if (!config.botId?.trim()) {
    throw new Error("botId is required");
  }

  if (!config.sharedSecret?.trim()) {
    throw new Error("sharedSecret is required");
  }

  return {
    relayUrl: config.relayUrl,
    botId: config.botId,
    sharedSecret: config.sharedSecret,
    endpoints: {
      ...DEFAULT_ENDPOINTS,
      ...config.endpoints
    },
    retry: {
      ...DEFAULT_RETRY,
      ...config.retry
    },
    security: {
      ...DEFAULT_SECURITY,
      ...config.security
    },
    poll: {
      ...DEFAULT_POLL,
      ...config.poll
    },
    nonceStore: config.nonceStore ?? new InMemoryNonceStore(),
    idempotencyStore: config.idempotencyStore ?? new InMemoryIdempotencyStore(),
    fetchImpl: config.fetchImpl ?? fetch,
    logger: config.logger
  };
}

function resolveUrl(baseUrl: string, path: string): string {
  return new URL(path, ensureTrailingSlash(baseUrl)).toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function parseQueuedDelivery(input: unknown): RelayQueuedDelivery {
  if (!isRecord(input)) {
    throw new Error("invalid-delivery-shape");
  }

  const fields = ["requestId", "botId", "method", "path", "timestamp", "nonce", "signature", "rawBody"] as const;
  for (const field of fields) {
    if (typeof input[field] !== "string") {
      throw new Error(`invalid-delivery-field:${field}`);
    }
  }

  const requestId = input.requestId as string;
  const botId = input.botId as string;
  const method = input.method as string;
  const path = input.path as string;
  const timestamp = input.timestamp as string;
  const nonce = input.nonce as string;
  const signature = input.signature as string;
  const rawBody = input.rawBody as string;

  return {
    requestId,
    botId,
    method,
    path,
    timestamp,
    nonce,
    signature,
    rawBody
  };
}

function parseEnvelope(rawBody: string, fallbackRequestId: string):
  | { ok: true; envelope: RelayEventEnvelope }
  | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }

  if (!isRecord(parsed)) {
    return { ok: false, reason: "invalid-envelope" };
  }

  const event = parsed.event;
  const payload = parsed.payload;
  if (typeof event !== "string" || event.trim().length === 0 || !isRecord(payload)) {
    return { ok: false, reason: "invalid-envelope" };
  }

  const requestId = typeof parsed.requestId === "string" ? parsed.requestId : fallbackRequestId;
  const meta = isRecord(parsed.meta) ? parsed.meta : undefined;
  const receivedAt = typeof parsed.receivedAt === "string" ? parsed.receivedAt : undefined;

  return {
    ok: true,
    envelope: {
      requestId,
      event,
      payload,
      meta,
      receivedAt
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "runtime-error";
}
