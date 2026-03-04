import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeBackoffMs, createRelayRuntime, signRelayDelivery } from "../../src/index.js";
import {
  createSignedQueuedDelivery,
  type MockRelayServer,
  startMockRelayServer
} from "./helpers.js";

const BOT_ID = "smoke_bot_contract";
const SECRET = "contract-secret";

describe("relay contract smoke", () => {
  let relay: MockRelayServer;

  beforeEach(async () => {
    relay = await startMockRelayServer();
  });

  afterEach(async () => {
    await relay.close();
  });

  it("pulls deliveries and ACKs after verification", async () => {
    relay.enqueue(
      createSignedQueuedDelivery({
        botId: BOT_ID,
        secret: SECRET,
        requestId: "rrq_contract_ack_1",
        event: "wallet.transfer.detected",
        payload: { amount: "1.25" }
      })
    );

    const runtime = createRelayRuntime({
      relayUrl: relay.baseUrl,
      botId: BOT_ID,
      sharedSecret: SECRET
    });

    let handled = 0;
    runtime.onDelivery(async (delivery) => {
      await delivery.verify();
      handled += 1;
      await delivery.ack({ detail: "processed" });
    });

    const cycle = await runtime.runOnce();

    expect(cycle.pulled).toBe(1);
    expect(cycle.processed).toBe(1);
    expect(handled).toBe(1);
    expect(relay.state.acks).toHaveLength(1);
    expect(relay.state.nacks).toHaveLength(0);
  });

  it("dead-letters signature mismatches with a permanent NACK", async () => {
    const bad = createSignedQueuedDelivery({
      botId: BOT_ID,
      secret: SECRET,
      requestId: "rrq_contract_sig_1",
      event: "wallet.transfer.detected",
      payload: { amount: "2.0" }
    });
    bad.signature = "00badbad";
    relay.enqueue(bad);

    const runtime = createRelayRuntime({
      relayUrl: relay.baseUrl,
      botId: BOT_ID,
      sharedSecret: SECRET
    });

    let handled = 0;
    runtime.onDelivery(async () => {
      handled += 1;
    });

    await runtime.runOnce();

    expect(handled).toBe(0);
    expect(relay.state.acks).toHaveLength(0);
    expect(relay.state.nacks).toHaveLength(1);
    expect(relay.state.nacks[0]?.retryable).toBe(false);
    expect(relay.state.nacks[0]?.code).toBe("signature-mismatch");
  });

  it("rejects duplicate nonces within the replay window", async () => {
    const fixedTimestamp = String(Math.floor(Date.now() / 1000));
    const fixedNonce = "nonce-replay";

    relay.enqueue(
      createSignedQueuedDelivery({
        botId: BOT_ID,
        secret: SECRET,
        requestId: "rrq_contract_nonce_1",
        event: "smoke.one",
        payload: { idx: 1 },
        timestamp: fixedTimestamp,
        nonce: fixedNonce
      })
    );

    relay.enqueue(
      createSignedQueuedDelivery({
        botId: BOT_ID,
        secret: SECRET,
        requestId: "rrq_contract_nonce_2",
        event: "smoke.two",
        payload: { idx: 2 },
        timestamp: fixedTimestamp,
        nonce: fixedNonce
      })
    );

    const runtime = createRelayRuntime({
      relayUrl: relay.baseUrl,
      botId: BOT_ID,
      sharedSecret: SECRET
    });

    let handled = 0;
    runtime.onDelivery(async (delivery) => {
      handled += 1;
      await delivery.ack({ detail: "processed" });
    });

    const cycle = await runtime.runOnce();

    expect(cycle.pulled).toBe(2);
    expect(handled).toBe(1);
    expect(relay.state.acks).toHaveLength(1);
    expect(relay.state.nacks).toHaveLength(1);
    expect(relay.state.nacks[0]?.code).toBe("nonce-replay");
    expect(relay.state.nacks[0]?.retryable).toBe(false);
  });

  it("deduplicates request IDs and ACKs duplicates without side effects", async () => {
    relay.enqueue(
      createSignedQueuedDelivery({
        botId: BOT_ID,
        secret: SECRET,
        requestId: "rrq_contract_dup",
        event: "event.unique",
        payload: { seq: 1 },
        nonce: "dup-nonce-1"
      })
    );

    relay.enqueue(
      createSignedQueuedDelivery({
        botId: BOT_ID,
        secret: SECRET,
        requestId: "rrq_contract_dup",
        event: "event.unique",
        payload: { seq: 1 },
        nonce: "dup-nonce-2",
        timestamp: String(Math.floor(Date.now() / 1000) + 1)
      })
    );

    const runtime = createRelayRuntime({
      relayUrl: relay.baseUrl,
      botId: BOT_ID,
      sharedSecret: SECRET
    });

    let handled = 0;
    runtime.onDelivery(async (delivery) => {
      handled += 1;
      await delivery.ack({ detail: "processed" });
    });

    await runtime.runOnce();

    expect(handled).toBe(1);
    expect(relay.state.acks).toHaveLength(2);
    expect(relay.state.nacks).toHaveLength(0);
    expect(relay.state.acks[1]?.detail).toBe("duplicate-already-acked");
  });

  it("sends retryable NACKs for transient handler failures", async () => {
    relay.enqueue(
      createSignedQueuedDelivery({
        botId: BOT_ID,
        secret: SECRET,
        requestId: "rrq_contract_retryable",
        event: "event.fail.retry",
        payload: { retryable: true }
      })
    );

    const runtime = createRelayRuntime({
      relayUrl: relay.baseUrl,
      botId: BOT_ID,
      sharedSecret: SECRET
    });

    runtime.onDelivery(async () => {
      throw new Error("temporary downstream failure");
    });

    await runtime.runOnce();

    expect(relay.state.acks).toHaveLength(0);
    expect(relay.state.nacks).toHaveLength(1);
    expect(relay.state.nacks[0]?.retryable).toBe(true);
    expect(relay.state.nacks[0]?.code).toBe("handler-error");
  });

  it("dead-letters permanently invalid delivery payloads", async () => {
    const invalid = createSignedQueuedDelivery({
      botId: BOT_ID,
      secret: SECRET,
      requestId: "rrq_contract_invalid_payload",
      event: "event.valid",
      payload: { valid: true }
    });

    invalid.rawBody = JSON.stringify({ requestId: invalid.requestId, payload: { missingEvent: true } });
    invalid.signature = signRelayDelivery({
      method: invalid.method,
      path: invalid.path,
      timestamp: invalid.timestamp,
      nonce: invalid.nonce,
      rawBody: Buffer.from(invalid.rawBody, "utf8"),
      secret: SECRET
    });

    relay.enqueue(invalid);

    const runtime = createRelayRuntime({
      relayUrl: relay.baseUrl,
      botId: BOT_ID,
      sharedSecret: SECRET
    });

    let handled = 0;
    runtime.onDelivery(async () => {
      handled += 1;
    });

    await runtime.runOnce();

    expect(handled).toBe(0);
    expect(relay.state.acks).toHaveLength(0);
    expect(relay.state.nacks).toHaveLength(1);
    expect(relay.state.nacks[0]?.retryable).toBe(false);
    expect(relay.state.nacks[0]?.code).toBe("invalid-envelope");
  });

  it("computes bounded retry backoff with jitter", () => {
    const retry = {
      baseMs: 500,
      factor: 2,
      maxMs: 30_000,
      jitter: 0.25
    };

    const low = computeBackoffMs(3, retry, () => 0);
    const high = computeBackoffMs(3, retry, () => 1);

    expect(low).toBe(3_000);
    expect(high).toBe(5_000);
  });
});
