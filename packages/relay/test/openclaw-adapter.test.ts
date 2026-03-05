import { describe, expect, it } from "vitest";
import { createOpenClawAgentAdapter } from "../src/adapters/openclaw.js";
import type { RelayDelivery } from "../src/types.js";

describe("openclaw adapter", () => {
  it("sends x-openclaw-token, appends wait=0, and serializes default structured message", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const adapter = createOpenClawAgentAdapter({
      baseUrl: "http://127.0.0.1:18789",
      token: "secret-token",
      fetchImpl: async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init;
        return new Response(JSON.stringify({ status: "accepted" }), {
          status: 202,
          headers: {
            "content-type": "application/json"
          }
        });
      }
    });

    const result = await adapter.handle({ delivery: createDelivery() });

    expect(result).toEqual({ outcome: "ack", detail: "openclaw-http-202" });
    expect(capturedUrl).toBe("http://127.0.0.1:18789/hooks/agent?wait=0");

    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("x-openclaw-token")).toBe("secret-token");
    expect(headers.get("content-type")).toBe("application/json");

    const body = JSON.parse(String(capturedInit?.body)) as { message: string };
    const envelope = JSON.parse(body.message) as Record<string, unknown>;

    expect(envelope).toMatchObject({
      source: "tripwire-relay",
      version: 1,
      requestId: "rrq_openclaw_1",
      botId: "bot_openclaw_1",
      event: "event.openclaw.test",
      payload: {
        amount: "1.25"
      },
      meta: {
        source: "relay"
      },
      receivedAt: "2026-03-05T10:00:00.000Z"
    });
  });

  it("ACKs on HTTP 200", async () => {
    const adapter = createOpenClawAgentAdapter({
      token: "secret-token",
      fetchImpl: async () => new Response("ok", { status: 200 })
    });

    const result = await adapter.handle({ delivery: createDelivery() });

    expect(result).toEqual({ outcome: "ack", detail: "openclaw-http-200" });
  });

  it("maps HTTP 500 to retryable NACK", async () => {
    const adapter = createOpenClawAgentAdapter({
      token: "secret-token",
      fetchImpl: async () => new Response("fail", { status: 500 })
    });

    const result = await adapter.handle({ delivery: createDelivery() });

    expect(result).toEqual({
      outcome: "nack",
      retryable: true,
      code: "openclaw-http-500",
      detail: "openclaw-http-500"
    });
  });

  it("maps HTTP 401 to non-retryable NACK", async () => {
    const adapter = createOpenClawAgentAdapter({
      token: "secret-token",
      fetchImpl: async () => new Response("unauthorized", { status: 401 })
    });

    const result = await adapter.handle({ delivery: createDelivery() });

    expect(result).toEqual({
      outcome: "nack",
      retryable: false,
      code: "openclaw-http-401",
      detail: "openclaw-http-401"
    });
  });

  it("maps HTTP 422 to non-retryable NACK", async () => {
    const adapter = createOpenClawAgentAdapter({
      token: "secret-token",
      fetchImpl: async () => new Response("unprocessable", { status: 422 })
    });

    const result = await adapter.handle({ delivery: createDelivery() });

    expect(result).toEqual({
      outcome: "nack",
      retryable: false,
      code: "openclaw-http-422",
      detail: "openclaw-http-422"
    });
  });

  it("maps network errors to retryable NACK", async () => {
    const adapter = createOpenClawAgentAdapter({
      token: "secret-token",
      fetchImpl: async () => {
        throw new Error("socket hang up");
      }
    });

    const result = await adapter.handle({ delivery: createDelivery() });

    expect(result).toEqual({
      outcome: "nack",
      retryable: true,
      code: "openclaw-network-error",
      detail: "socket hang up"
    });
  });

  it("maps timeout errors to retryable NACK", async () => {
    const adapter = createOpenClawAgentAdapter({
      token: "secret-token",
      timeoutMs: 5,
      fetchImpl: async (_url, init) =>
        await new Promise<Response>((_, reject) => {
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal)) {
            reject(new Error("missing abort signal"));
            return;
          }

          signal.addEventListener("abort", () => {
            const abortError = new Error("aborted");
            abortError.name = "AbortError";
            reject(abortError);
          });
        })
    });

    const result = await adapter.handle({ delivery: createDelivery() });

    expect(result).toEqual({
      outcome: "nack",
      retryable: true,
      code: "openclaw-timeout",
      detail: "openclaw-timeout"
    });
  });
});

function createDelivery(overrides: Partial<RelayDelivery> = {}): RelayDelivery {
  return {
    requestId: "rrq_openclaw_1",
    botId: "bot_openclaw_1",
    event: "event.openclaw.test",
    payload: {
      amount: "1.25"
    },
    meta: {
      source: "relay"
    },
    receivedAt: "2026-03-05T10:00:00.000Z",
    rawBody: JSON.stringify({
      requestId: "rrq_openclaw_1",
      event: "event.openclaw.test",
      payload: { amount: "1.25" }
    }),
    async verify() {
      return Promise.resolve();
    },
    async ack() {
      return Promise.resolve();
    },
    async nack() {
      return Promise.resolve();
    },
    hasResponded() {
      return false;
    },
    ...overrides
  };
}
