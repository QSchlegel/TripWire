import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRelayRuntimeWithAdapter } from "../src/index.js";
import type { RelayAdapterResult, RelayDeliveryAdapter } from "../src/types.js";
import {
  createSignedQueuedDelivery,
  type MockRelayServer,
  startMockRelayServer
} from "./smoke/helpers.js";

const BOT_ID = "adapter_bot";
const SECRET = "adapter-secret";

describe("relay runtime adapter wrapper", () => {
  let relay: MockRelayServer;

  beforeEach(async () => {
    relay = await startMockRelayServer();
  });

  afterEach(async () => {
    await relay.close();
  });

  it("ACKs relay when adapter returns ack", async () => {
    relay.enqueue(
      createSignedQueuedDelivery({
        botId: BOT_ID,
        secret: SECRET,
        requestId: "rrq_adapter_ack",
        event: "event.adapter.ack",
        payload: { ok: true }
      })
    );

    let handled = 0;
    const adapter: RelayDeliveryAdapter = {
      async handle({ delivery }) {
        handled += 1;
        expect(delivery.event).toBe("event.adapter.ack");
        return {
          outcome: "ack",
          detail: "adapter-accepted"
        };
      }
    };

    const runtime = createRelayRuntimeWithAdapter(
      {
        relayUrl: relay.baseUrl,
        botId: BOT_ID,
        sharedSecret: SECRET
      },
      adapter
    );

    const cycle = await runtime.runOnce();

    expect(cycle).toEqual({ pulled: 1, processed: 1 });
    expect(handled).toBe(1);
    expect(relay.state.acks).toHaveLength(1);
    expect(relay.state.acks[0]?.detail).toBe("adapter-accepted");
    expect(relay.state.nacks).toHaveLength(0);
  });

  it("NACKs relay with non-retryable status when adapter returns retryable=false", async () => {
    relay.enqueue(
      createSignedQueuedDelivery({
        botId: BOT_ID,
        secret: SECRET,
        requestId: "rrq_adapter_nack_perm",
        event: "event.adapter.nack.perm",
        payload: { ok: true }
      })
    );

    const adapter: RelayDeliveryAdapter = {
      async handle() {
        return {
          outcome: "nack",
          retryable: false,
          code: "permanent-error",
          detail: "permanent-error"
        };
      }
    };

    const runtime = createRelayRuntimeWithAdapter(
      {
        relayUrl: relay.baseUrl,
        botId: BOT_ID,
        sharedSecret: SECRET
      },
      adapter
    );

    await runtime.runOnce();

    expect(relay.state.acks).toHaveLength(0);
    expect(relay.state.nacks).toHaveLength(1);
    expect(relay.state.nacks[0]).toMatchObject({
      retryable: false,
      code: "permanent-error",
      detail: "permanent-error"
    });
  });

  it("NACKs relay with retryable status when adapter returns retryable=true", async () => {
    relay.enqueue(
      createSignedQueuedDelivery({
        botId: BOT_ID,
        secret: SECRET,
        requestId: "rrq_adapter_nack_retry",
        event: "event.adapter.nack.retry",
        payload: { ok: true }
      })
    );

    const adapter: RelayDeliveryAdapter = {
      async handle() {
        return {
          outcome: "nack",
          retryable: true,
          code: "transient-error",
          detail: "transient-error"
        };
      }
    };

    const runtime = createRelayRuntimeWithAdapter(
      {
        relayUrl: relay.baseUrl,
        botId: BOT_ID,
        sharedSecret: SECRET
      },
      adapter
    );

    await runtime.runOnce();

    expect(relay.state.acks).toHaveLength(0);
    expect(relay.state.nacks).toHaveLength(1);
    expect(relay.state.nacks[0]).toMatchObject({
      retryable: true,
      code: "transient-error",
      detail: "transient-error"
    });
  });

  it("sends retryable adapter-error NACK when adapter throws", async () => {
    relay.enqueue(
      createSignedQueuedDelivery({
        botId: BOT_ID,
        secret: SECRET,
        requestId: "rrq_adapter_throw",
        event: "event.adapter.throw",
        payload: { ok: true }
      })
    );

    const adapter: RelayDeliveryAdapter = {
      async handle() {
        throw new Error("adapter exploded");
      }
    };

    const runtime = createRelayRuntimeWithAdapter(
      {
        relayUrl: relay.baseUrl,
        botId: BOT_ID,
        sharedSecret: SECRET
      },
      adapter
    );

    await runtime.runOnce();

    expect(relay.state.acks).toHaveLength(0);
    expect(relay.state.nacks).toHaveLength(1);
    expect(relay.state.nacks[0]).toMatchObject({
      retryable: true,
      code: "adapter-error",
      detail: "adapter exploded"
    });
  });

  it("sends retryable adapter-invalid-result NACK when adapter result is malformed", async () => {
    relay.enqueue(
      createSignedQueuedDelivery({
        botId: BOT_ID,
        secret: SECRET,
        requestId: "rrq_adapter_invalid",
        event: "event.adapter.invalid",
        payload: { ok: true }
      })
    );

    const adapter: RelayDeliveryAdapter = {
      async handle() {
        return {
          outcome: "unknown"
        } as unknown as RelayAdapterResult;
      }
    };

    const runtime = createRelayRuntimeWithAdapter(
      {
        relayUrl: relay.baseUrl,
        botId: BOT_ID,
        sharedSecret: SECRET
      },
      adapter
    );

    await runtime.runOnce();

    expect(relay.state.acks).toHaveLength(0);
    expect(relay.state.nacks).toHaveLength(1);
    expect(relay.state.nacks[0]).toMatchObject({
      retryable: true,
      code: "adapter-invalid-result",
      detail: "adapter-invalid-result"
    });
  });
});
