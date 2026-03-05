import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ChainMismatchError,
  HandleNotFoundError,
  PluginAlreadyRegisteredError,
  buildRelaySignatureBaseString,
  createEnclave,
  signRelayDeliveryWithHandle
} from "../src/index.js";
import { createMeshBitcoinWalletPlugin } from "../src/adapters/mesh-bitcoin.js";
import { createMeshCardanoWalletPlugin } from "../src/adapters/mesh-cardano.js";

describe("secret custody", () => {
  it("generates a handle and signs/verifies without exposing plaintext", async () => {
    const enclave = createEnclave();
    const handle = await enclave.generateSecret();

    expect(handle.id).toMatch(/^sec_/);
    expect(handle.kind).toBe("secret");

    const signatureHex = await enclave.signHmacHex({
      handleId: handle.id,
      data: "relay-body"
    });

    expect(signatureHex).toMatch(/^[0-9a-f]{64}$/);

    const verified = await enclave.verifyHmacHex({
      handleId: handle.id,
      data: "relay-body",
      signatureHex
    });

    expect(verified).toBe(true);
  });

  it("zeroizes mutable import buffers after import", async () => {
    const enclave = createEnclave();
    const raw = new Uint8Array([1, 2, 3, 4, 5, 6]);

    const handle = await enclave.importSecret({ raw });
    expect(handle.id).toMatch(/^sec_/);
    expect(Array.from(raw)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("invalidates destroyed handles", async () => {
    const enclave = createEnclave();
    const handle = await enclave.generateSecret();

    await enclave.destroyHandle({ handleId: handle.id });

    await expect(
      enclave.signHmacHex({
        handleId: handle.id,
        data: "dead"
      })
    ).rejects.toBeInstanceOf(HandleNotFoundError);
  });
});

describe("wallet plugin registry and chain guards", () => {
  it("rejects duplicate plugin IDs", () => {
    const enclave = createEnclave();
    enclave.registerWalletPlugin(createMeshCardanoWalletPlugin({ pluginId: "mesh-cardano" }));

    expect(() => {
      enclave.registerWalletPlugin(createMeshCardanoWalletPlugin({ pluginId: "mesh-cardano" }));
    }).toThrow(PluginAlreadyRegisteredError);
  });

  it("rejects chain mismatches between wallet handle and payload", async () => {
    const enclave = createEnclave();
    enclave.registerWalletPlugin(createMeshBitcoinWalletPlugin());

    const wallet = await enclave.generateWallet({
      chain: "bitcoin",
      network: "testnet"
    });

    await expect(
      enclave.signMessage({
        handleId: wallet.id,
        chain: "cardano",
        messageHex: "deadbeef"
      })
    ).rejects.toBeInstanceOf(ChainMismatchError);
  });
});

describe("relay helper", () => {
  it("matches canonical relay signature for the same base string", async () => {
    const enclave = createEnclave();
    const secret = await enclave.importSecret({
      raw: new Uint8Array(Buffer.from("relay-secret", "utf8"))
    });

    const rawBody = Buffer.from(JSON.stringify({ requestId: "rrq_123", event: "wallet.transfer" }), "utf8");

    const base = buildRelaySignatureBaseString({
      method: "POST",
      path: "/runtime/events",
      timestamp: "1700000000",
      nonce: "nonce-1",
      rawBody
    });

    const expected = createHmac("sha256", "relay-secret").update(base).digest("hex");
    const signed = await signRelayDeliveryWithHandle({
      enclave,
      handleId: secret.id,
      method: "POST",
      path: "/runtime/events",
      timestamp: "1700000000",
      nonce: "nonce-1",
      rawBody
    });

    expect(signed).toBe(expected);

    const bodyHash = createHash("sha256").update(rawBody).digest("hex");
    expect(base).toContain(`\n${bodyHash}`);
  });
});
