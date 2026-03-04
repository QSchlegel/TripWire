import { describe, expect, it } from "vitest";
import {
  InMemoryRateLimitStore,
  buildSignatureBaseString,
  prescreenWebhookRequest,
  signRelayDelivery,
  verifyRelaySignature
} from "../src/index.js";

describe("signature verification", () => {
  const secret = "test-secret";
  const method = "POST";
  const path = "/runtime/events";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "nonce-test";
  const rawBody = Buffer.from(JSON.stringify({ requestId: "rrq_1", event: "smoke", payload: { ok: true } }));

  it("builds canonical base string", () => {
    const base = buildSignatureBaseString({ method, path, timestamp, nonce, rawBody });
    expect(base).toContain("POST\n/runtime/events\n");
  });

  it("accepts valid signature", () => {
    const signature = signRelayDelivery({ method, path, timestamp, nonce, rawBody, secret });

    const result = verifyRelaySignature({
      method,
      path,
      rawBody,
      botId: "bot_1",
      timestamp,
      nonce,
      signature,
      secret
    });

    expect(result.ok).toBe(true);
  });

  it("rejects mismatched signature", () => {
    const result = verifyRelaySignature({
      method,
      path,
      rawBody,
      botId: "bot_1",
      timestamp,
      nonce,
      signature: "deadbeef",
      secret
    });

    expect(result).toEqual({ ok: false, reason: "signature-mismatch" });
  });

  it("rejects old timestamp", () => {
    const skewedTimestamp = "1";
    const signature = signRelayDelivery({ method, path, timestamp: skewedTimestamp, nonce, rawBody, secret });

    const result = verifyRelaySignature({
      method,
      path,
      rawBody,
      botId: "bot_1",
      timestamp: skewedTimestamp,
      nonce,
      signature,
      secret,
      nowEpochSeconds: 10_000,
      maxSkewSeconds: 100
    });

    expect(result).toEqual({ ok: false, reason: "timestamp-skew" });
  });
});

describe("webhook prescreen", () => {
  it("accepts valid payload", async () => {
    const payload = {
      event: "wallet.transfer",
      payload: {
        amount: "1.5"
      }
    };

    const result = await prescreenWebhookRequest({
      method: "POST",
      botId: "wallet_0xabc",
      rawBody: Buffer.from(JSON.stringify(payload), "utf8"),
      contentType: "application/json",
      clientIp: "203.0.113.5"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accepted.event).toBe(payload.event);
      expect(result.accepted.payload).toEqual(payload.payload);
    }
  });

  it("rejects invalid bot id", async () => {
    const result = await prescreenWebhookRequest({
      method: "POST",
      botId: "not valid",
      rawBody: "{}",
      contentType: "application/json"
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid-bot-id", status: 400 });
  });

  it("rejects oversized payload", async () => {
    const result = await prescreenWebhookRequest({
      method: "POST",
      botId: "bot_123",
      rawBody: Buffer.alloc(32),
      contentType: "application/json",
      config: {
        maxBodyBytes: 8
      }
    });

    expect(result).toMatchObject({ ok: false, reason: "payload-too-large", status: 413 });
  });

  it("enforces rate limits", async () => {
    const store = new InMemoryRateLimitStore();
    const input = {
      method: "POST",
      botId: "bot_123",
      rawBody: Buffer.from(JSON.stringify({ event: "ok", payload: { ok: true } }), "utf8"),
      contentType: "application/json",
      clientIp: "198.51.100.9",
      rateLimitStore: store,
      config: {
        rateLimitPerMinute: 1
      }
    } as const;

    const first = await prescreenWebhookRequest(input);
    const second = await prescreenWebhookRequest(input);

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: "rate-limit", status: 429 });
  });
});
