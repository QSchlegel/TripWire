export interface RetryConfig {
  baseMs: number;
  factor: number;
  maxMs: number;
  jitter: number;
}

export interface RelayRuntimeEndpoints {
  pull: string;
  ack: string;
  nack: string;
}

export interface RelayRuntimeSecurityConfig {
  maxSkewSeconds: number;
  nonceTtlSeconds: number;
  idempotencyTtlSeconds: number;
}

export interface RelayRuntimePollConfig {
  maxBatch: number;
  waitMs: number;
  idleMs: number;
}

export interface RelayRuntimeConfig {
  relayUrl: string;
  botId: string;
  sharedSecret: string;
  endpoints?: Partial<RelayRuntimeEndpoints>;
  retry?: Partial<RetryConfig>;
  security?: Partial<RelayRuntimeSecurityConfig>;
  poll?: Partial<RelayRuntimePollConfig>;
  nonceStore?: NonceStore;
  idempotencyStore?: IdempotencyStore;
  fetchImpl?: typeof fetch;
  logger?: (event: RelayRuntimeLogEvent) => void;
}

export interface RelayRuntimeCycleResult {
  pulled: number;
  processed: number;
}

export type RelayRuntimeLogEvent =
  | {
      level: "debug" | "info";
      message: string;
      botId: string;
      context?: Record<string, unknown>;
    }
  | {
      level: "warn" | "error";
      message: string;
      botId: string;
      context?: Record<string, unknown>;
      error?: unknown;
    };

export interface RelayQueuedDelivery {
  requestId: string;
  botId: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  signature: string;
  rawBody: string;
}

export interface RelayEventEnvelope {
  requestId: string;
  event: string;
  payload: Record<string, unknown>;
  meta?: Record<string, unknown>;
  receivedAt?: string;
}

export interface RelayAckInput {
  detail?: string;
}

export interface RelayNackInput {
  retryable?: boolean;
  detail?: string;
  code?: string;
}

export interface RelayDelivery {
  readonly requestId: string;
  readonly botId: string;
  readonly event: string;
  readonly payload: Record<string, unknown>;
  readonly meta: Record<string, unknown>;
  readonly receivedAt?: string;
  readonly rawBody: string;
  verify(): Promise<void>;
  ack(input?: RelayAckInput): Promise<void>;
  nack(input?: RelayNackInput): Promise<void>;
  hasResponded(): boolean;
}

export interface RelayRuntime {
  onDelivery(handler: RelayDeliveryHandler): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  runOnce(): Promise<RelayRuntimeCycleResult>;
}

export type RelayDeliveryHandler = (delivery: RelayDelivery) => Promise<void>;

export interface VerifyRelaySignatureInput {
  method: string;
  path: string;
  rawBody: Buffer;
  botId: string;
  timestamp: string;
  nonce: string;
  signature: string;
  secret: string;
  nowEpochSeconds?: number;
  maxSkewSeconds?: number;
}

export type VerifyRelaySignatureResult = { ok: true } | { ok: false; reason: string };

export interface BuildSignatureBaseStringInput {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: Buffer;
}

export interface SignRelayDeliveryInput extends BuildSignatureBaseStringInput {
  secret: string;
}

export interface NonceStore {
  consume(key: string, ttlSeconds: number): Promise<boolean>;
}

export type IdempotencyStatus = "processing" | "acked" | "nacked";

export interface IdempotencyRecord {
  status: IdempotencyStatus;
  detail?: string;
  retryable?: boolean;
  updatedAt: string;
}

export interface IdempotencyStore {
  get(botId: string, requestId: string): Promise<IdempotencyRecord | undefined>;
  set(botId: string, requestId: string, record: IdempotencyRecord, ttlSeconds: number): Promise<void>;
}

export interface RateLimitHit {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<RateLimitHit>;
}

export interface WebhookPrescreenConfig {
  maxBodyBytes: number;
  botIdPattern: RegExp;
  allowIps: string[];
  denyIps: string[];
  rateLimitPerMinute: number;
  rateLimitWindowMs: number;
  requireJsonContentType: boolean;
}

export interface PrescreenWebhookRequestInput {
  method: string;
  botId: string;
  rawBody: Buffer | string;
  contentType?: string | null;
  clientIp?: string | null;
  now?: Date;
  config?: Partial<WebhookPrescreenConfig>;
  rateLimitStore?: RateLimitStore;
}

export interface PrescreenAcceptedEvent {
  botId: string;
  event: string;
  payload: Record<string, unknown>;
  timestamp?: string | number;
  meta?: Record<string, unknown>;
  receivedAt: string;
  bodyBytes: number;
  rawBody: string;
}

export type PrescreenRejectReason =
  | "method-not-allowed"
  | "invalid-bot-id"
  | "denied-ip"
  | "ip-not-allowlisted"
  | "rate-limit"
  | "unsupported-content-type"
  | "payload-too-large"
  | "invalid-json"
  | "invalid-schema";

export type PrescreenWebhookResult =
  | {
      ok: true;
      status: 202;
      accepted: PrescreenAcceptedEvent;
    }
  | {
      ok: false;
      status: 400 | 403 | 405 | 413 | 415 | 422 | 429;
      reason: PrescreenRejectReason;
      detail: string;
    };

export interface NextWebhookAcceptedInput {
  request: Request;
  accepted: PrescreenAcceptedEvent;
}

export type NextWebhookAcceptedResponse =
  | Response
  | {
      status?: number;
      headers?: Record<string, string>;
      body?: unknown;
    }
  | void;

export interface CreateNextWebhookHandlerOptions {
  paramName?: string;
  config?: Partial<WebhookPrescreenConfig>;
  rateLimitStore?: RateLimitStore;
  onAccepted(input: NextWebhookAcceptedInput): Promise<NextWebhookAcceptedResponse>;
}
