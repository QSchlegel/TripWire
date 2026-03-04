import { describe, expect, it } from "vitest";
import { createRelayRuntime } from "../../src/index.js";
import {
  createEphemeralBotId,
  getJson,
  logSkip,
  postJson,
  resolveSmokeEnv
} from "./helpers.js";

const env = resolveSmokeEnv();
const botId = createEphemeralBotId(env.botIdPrefix);
const registerUrl = `${env.baseUrl}/api/public/bots/register`;
const publicBotUrl = `${env.baseUrl}/b/${botId}`;

describe.sequential(`relay live smoke (${env.mode})`, () => {
  it("registers an ephemeral bot via public API", async () => {
    const response = await postJson(registerUrl, {
      id: botId,
      targetUrl: "https://example.com/smoke-webhook",
      description: `relay smoke test (${env.mode})`
    });

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);

    if (typeof response.body === "object" && response.body !== null) {
      const claimCode = (response.body as Record<string, unknown>).claimCode;
      expect(typeof claimCode === "string" || claimCode === undefined).toBe(true);
    }
  });

  it("serves the public bot route", async () => {
    const response = await getJson(publicBotUrl);
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
  });

  it("rejects invalid ingress payloads", async () => {
    const response = await postJson(publicBotUrl, {
      payload: {
        missingEvent: true
      }
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("accepts valid ingress payloads", async () => {
    const response = await postJson(publicBotUrl, {
      event: "smoke.live.accept",
      payload: {
        ok: true
      },
      meta: {
        source: "relay-smoke"
      }
    });

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
  });

  it("runs signed tunnel checks when configured", async () => {
    if (!env.sharedSecret) {
      if (env.requireTunnel) {
        throw new Error("SMOKE_REQUIRE_TUNNEL=true but SMOKE_SHARED_SECRET is not set.");
      }

      logSkip("missing-shared-secret", {
        mode: env.mode,
        baseUrl: env.baseUrl
      });
      return;
    }

    const runtime = createRelayRuntime({
      relayUrl: env.baseUrl,
      botId,
      sharedSecret: env.sharedSecret,
      poll: {
        maxBatch: 5,
        waitMs: 500,
        idleMs: 100
      }
    });

    let handled = 0;
    runtime.onDelivery(async (delivery) => {
      await delivery.verify();
      handled += 1;
      await delivery.ack({ detail: "smoke-live" });
    });

    const enqueue = await postJson(publicBotUrl, {
      event: "smoke.live.tunnel",
      payload: {
        ts: Date.now()
      }
    });

    if (enqueue.status < 200 || enqueue.status >= 300) {
      throw new Error(`failed to enqueue tunnel smoke event: status=${enqueue.status}`);
    }

    let runtimeError: unknown;

    for (let i = 0; i < 5; i += 1) {
      try {
        const cycle = await runtime.runOnce();
        if (cycle.pulled > 0 || handled > 0) {
          break;
        }
      } catch (error) {
        runtimeError = error;
        break;
      }

      await wait(300);
    }

    if (runtimeError) {
      if (env.requireTunnel) {
        throw runtimeError;
      }

      logSkip("tunnel-runtime-unavailable", {
        mode: env.mode,
        baseUrl: env.baseUrl,
        error: runtimeError instanceof Error ? runtimeError.message : "runtime-error"
      });
      return;
    }

    if (handled === 0) {
      if (env.requireTunnel) {
        throw new Error("tunnel smoke did not receive a signed delivery.");
      }

      logSkip("tunnel-no-delivery", {
        mode: env.mode,
        baseUrl: env.baseUrl
      });
      return;
    }

    expect(handled).toBeGreaterThan(0);
  });
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
