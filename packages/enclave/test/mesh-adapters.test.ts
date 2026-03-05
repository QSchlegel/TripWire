import { describe, expect, it } from "vitest";

import { createMeshBitcoinWalletPlugin } from "../src/adapters/mesh-bitcoin.js";
import { createMeshCardanoWalletPlugin } from "../src/adapters/mesh-cardano.js";
import { createEnclave } from "../src/index.js";

describe("mesh adapters", () => {
  it("supports cardano generate/sign/public-key flows", async () => {
    const enclave = createEnclave();
    enclave.registerWalletPlugin(createMeshCardanoWalletPlugin());

    const wallet = await enclave.generateWallet({
      chain: "cardano",
      network: "preprod"
    });

    const signedMessage = await enclave.signMessage({
      handleId: wallet.id,
      chain: "cardano",
      messageHex: "deadbeef"
    });

    const signedTx = await enclave.signTransaction({
      handleId: wallet.id,
      chain: "cardano",
      txCborHex: "84a30081825820deadbeef"
    });

    const pub = await enclave.getPublicKey({
      handleId: wallet.id,
      chain: "cardano"
    });

    expect(signedMessage.chain).toBe("cardano");
    expect(signedMessage.signatureHex.length).toBeGreaterThan(0);
    expect(signedTx.chain).toBe("cardano");
    if (signedTx.chain === "cardano") {
      expect(signedTx.signedTxCborHex.length).toBeGreaterThan(0);
    }
    expect(pub.chain).toBe("cardano");
    expect(pub.publicKeyHex).toMatch(/^[0-9a-f]+$/);
    expect(pub.address.length).toBeGreaterThan(5);
  });

  it("supports cardano private-key-hex import", async () => {
    const enclave = createEnclave();
    enclave.registerWalletPlugin(createMeshCardanoWalletPlugin());

    const wallet = await enclave.importWallet({
      chain: "cardano",
      material: {
        format: "private-key-hex",
        value: "11".repeat(32)
      }
    });

    const signed = await enclave.signMessage({
      handleId: wallet.id,
      chain: "cardano",
      messageHex: "aabbccdd"
    });

    const pub = await enclave.getPublicKey({
      handleId: wallet.id,
      chain: "cardano"
    });

    expect(signed.signatureHex).toMatch(/^[0-9a-f]+$/);
    expect(pub.address.length).toBeGreaterThan(5);
  });

  it("supports bitcoin generate/sign/public-key flows", async () => {
    const enclave = createEnclave();
    enclave.registerWalletPlugin(createMeshBitcoinWalletPlugin());

    const wallet = await enclave.generateWallet({
      chain: "bitcoin",
      network: "testnet"
    });

    const signedMessage = await enclave.signMessage({
      handleId: wallet.id,
      chain: "bitcoin",
      message: "hello-btc"
    });

    const signedTx = await enclave.signTransaction({
      handleId: wallet.id,
      chain: "bitcoin",
      psbtBase64: Buffer.from("not-a-real-psbt", "utf8").toString("base64"),
      finalize: false
    });

    const pub = await enclave.getPublicKey({
      handleId: wallet.id,
      chain: "bitcoin"
    });

    expect(signedMessage.chain).toBe("bitcoin");
    expect(signedMessage.signatureHex).toMatch(/^[0-9a-f]+$/);
    expect(signedTx.chain).toBe("bitcoin");
    if (signedTx.chain === "bitcoin") {
      expect(signedTx.signedPsbtBase64.length).toBeGreaterThan(0);
    }
    expect(pub.chain).toBe("bitcoin");
    expect(pub.publicKeyHex).toMatch(/^[0-9a-f]+$/);
    expect(pub.address.length).toBeGreaterThan(10);
  });

  it("supports bitcoin private-key-hex import", async () => {
    const enclave = createEnclave();
    enclave.registerWalletPlugin(createMeshBitcoinWalletPlugin());

    const wallet = await enclave.importWallet({
      chain: "bitcoin",
      material: {
        format: "private-key-hex",
        value: "12".repeat(32)
      }
    });

    const signedMessage = await enclave.signMessage({
      handleId: wallet.id,
      chain: "bitcoin",
      message: "imported-key"
    });

    expect(signedMessage.signatureHex).toMatch(/^[0-9a-f]+$/);
  });
});
