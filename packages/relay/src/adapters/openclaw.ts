import type {
  RelayAdapterInput,
  RelayAdapterResult,
  RelayDelivery,
  RelayDeliveryAdapter
} from "../types.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:18789";
const DEFAULT_HOOK_PATH = "/hooks/agent";
const DEFAULT_WAIT = 0;
const DEFAULT_TIMEOUT_MS = 10_000;

const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 409, 410, 413, 415, 422]);
const RETRYABLE_STATUSES = new Set([408, 425, 429]);

interface ResolvedOpenClawAgentAdapterOptions {
  baseUrl: string;
  token: string;
  hookPath: string;
  wait: number;
  agentId?: string;
  sessionKey?: string;
  wakeMode?: string;
  model?: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  buildMessage: (input: RelayAdapterInput) => string;
}

interface OpenClawAgentHookPayload {
  message: string;
  agentId?: string;
  sessionKey?: string;
  wakeMode?: string;
  model?: string;
}

export interface OpenClawAgentAdapterOptions {
  baseUrl?: string;
  token: string;
  hookPath?: string;
  wait?: number;
  agentId?: string;
  sessionKey?: string;
  wakeMode?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  buildMessage?: (input: RelayAdapterInput) => string;
}

export function createOpenClawAgentAdapter(options: OpenClawAgentAdapterOptions): RelayDeliveryAdapter {
  const resolved = resolveOptions(options);

  return {
    async handle(input: RelayAdapterInput): Promise<RelayAdapterResult> {
      const url = buildHookUrl(resolved.baseUrl, resolved.hookPath, resolved.wait);
      const payload = buildHookPayload(input, resolved);
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => {
        controller.abort();
      }, resolved.timeoutMs);

      let response: Response;
      try {
        response = await resolved.fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-openclaw-token": resolved.token
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } catch (error) {
        clearTimeout(timeoutHandle);

        if (controller.signal.aborted || isAbortError(error)) {
          return {
            outcome: "nack",
            retryable: true,
            code: "openclaw-timeout",
            detail: "openclaw-timeout"
          };
        }

        return {
          outcome: "nack",
          retryable: true,
          code: "openclaw-network-error",
          detail: stringifyError(error)
        };
      }

      clearTimeout(timeoutHandle);

      if (response.ok) {
        return {
          outcome: "ack",
          detail: `openclaw-http-${response.status}`
        };
      }

      const code = `openclaw-http-${response.status}`;
      if (NON_RETRYABLE_STATUSES.has(response.status)) {
        return {
          outcome: "nack",
          retryable: false,
          code,
          detail: code
        };
      }

      if (RETRYABLE_STATUSES.has(response.status) || response.status >= 500) {
        return {
          outcome: "nack",
          retryable: true,
          code,
          detail: code
        };
      }

      return {
        outcome: "nack",
        retryable: true,
        code,
        detail: code
      };
    }
  };
}

function resolveOptions(options: OpenClawAgentAdapterOptions): ResolvedOpenClawAgentAdapterOptions {
  if (!options.token?.trim()) {
    throw new Error("openclaw token is required");
  }

  const wait = options.wait ?? DEFAULT_WAIT;
  if (!Number.isFinite(wait)) {
    throw new Error("openclaw wait must be a finite number");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("openclaw timeoutMs must be a positive number");
  }

  return {
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    token: options.token,
    hookPath: normalizeHookPath(options.hookPath ?? DEFAULT_HOOK_PATH),
    wait,
    agentId: options.agentId,
    sessionKey: options.sessionKey,
    wakeMode: options.wakeMode,
    model: options.model,
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs,
    buildMessage: options.buildMessage ?? defaultBuildMessage
  };
}

function buildHookPayload(
  input: RelayAdapterInput,
  options: ResolvedOpenClawAgentAdapterOptions
): OpenClawAgentHookPayload {
  const payload: OpenClawAgentHookPayload = {
    message: options.buildMessage(input)
  };

  if (options.agentId) {
    payload.agentId = options.agentId;
  }

  if (options.sessionKey) {
    payload.sessionKey = options.sessionKey;
  }

  if (options.wakeMode) {
    payload.wakeMode = options.wakeMode;
  }

  if (options.model) {
    payload.model = options.model;
  }

  return payload;
}

function defaultBuildMessage(input: RelayAdapterInput): string {
  const envelope = buildDefaultMessageEnvelope(input.delivery);
  return JSON.stringify(envelope);
}

function buildDefaultMessageEnvelope(delivery: RelayDelivery): Record<string, unknown> {
  return {
    source: "tripwire-relay",
    version: 1,
    requestId: delivery.requestId,
    botId: delivery.botId,
    event: delivery.event,
    payload: delivery.payload,
    meta: delivery.meta,
    receivedAt: delivery.receivedAt
  };
}

function buildHookUrl(baseUrl: string, hookPath: string, wait: number): string {
  const url = new URL(hookPath, ensureTrailingSlash(baseUrl));
  url.searchParams.set("wait", String(wait));
  return url.toString();
}

function normalizeHookPath(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "openclaw-network-error";
}
