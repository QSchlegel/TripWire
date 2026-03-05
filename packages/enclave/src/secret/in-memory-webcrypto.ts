import { randomUUID, webcrypto } from "node:crypto";

import { HandleNotFoundError, InvalidInputError } from "../errors.js";
import type {
  SecretProvider,
  SecretProviderGenerateInput,
  SecretProviderHandleRef,
  SecretProviderImportInput
} from "./provider.js";

interface StoredSecret {
  key: CryptoKey;
  algorithm: "hmac-sha256";
  createdAt: string;
  tags?: string[];
}

const subtle = globalThis.crypto?.subtle ?? webcrypto.subtle;

export class InMemoryWebCryptoSecretProvider implements SecretProvider {
  readonly providerName: string;
  private readonly keys = new Map<string, StoredSecret>();

  constructor(providerName = "memory-webcrypto") {
    this.providerName = providerName;
  }

  async generate(input: SecretProviderGenerateInput): Promise<SecretProviderHandleRef> {
    if (input.algorithm !== "hmac-sha256") {
      throw new InvalidInputError(`Unsupported algorithm '${input.algorithm}'.`);
    }

    if (!Number.isInteger(input.lengthBytes) || input.lengthBytes <= 0) {
      throw new InvalidInputError("Secret lengthBytes must be a positive integer.");
    }

    const key = await subtle.generateKey(
      {
        name: "HMAC",
        hash: "SHA-256",
        length: input.lengthBytes * 8
      },
      false,
      ["sign", "verify"]
    );

    if (!(key instanceof CryptoKey)) {
      throw new InvalidInputError("Unexpected generated key shape from WebCrypto.");
    }

    const keyId = randomUUID();
    const createdAt = new Date().toISOString();
    this.keys.set(keyId, {
      key,
      algorithm: input.algorithm,
      createdAt,
      tags: copyTags(input.tags)
    });

    return {
      provider: this.providerName,
      keyId,
      algorithm: input.algorithm,
      createdAt,
      tags: copyTags(input.tags)
    };
  }

  async import(input: SecretProviderImportInput): Promise<SecretProviderHandleRef> {
    if (input.algorithm !== "hmac-sha256") {
      throw new InvalidInputError(`Unsupported algorithm '${input.algorithm}'.`);
    }

    if (input.raw.byteLength === 0) {
      throw new InvalidInputError("Cannot import an empty secret.");
    }

    const copiedRaw = copyBytes(input.raw);
    const copiedRawBuffer = toArrayBuffer(copiedRaw);
    const key = await subtle.importKey(
      "raw",
      copiedRawBuffer,
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["sign", "verify"]
    );

    if (!(key instanceof CryptoKey)) {
      throw new InvalidInputError("Unexpected imported key shape from WebCrypto.");
    }

    const keyId = randomUUID();
    const createdAt = new Date().toISOString();
    this.keys.set(keyId, {
      key,
      algorithm: input.algorithm,
      createdAt,
      tags: copyTags(input.tags)
    });

    return {
      provider: this.providerName,
      keyId,
      algorithm: input.algorithm,
      createdAt,
      tags: copyTags(input.tags)
    };
  }

  async signHex(input: { ref: SecretProviderHandleRef; data: Uint8Array }): Promise<string> {
    const stored = this.keys.get(input.ref.keyId);
    if (!stored) {
      throw new HandleNotFoundError(input.ref.keyId);
    }

    const signature = await subtle.sign("HMAC", stored.key, toArrayBuffer(input.data));
    return bytesToHex(new Uint8Array(signature));
  }

  async verifyHex(input: { ref: SecretProviderHandleRef; data: Uint8Array; signatureHex: string }): Promise<boolean> {
    const stored = this.keys.get(input.ref.keyId);
    if (!stored) {
      throw new HandleNotFoundError(input.ref.keyId);
    }

    const signature = hexToBytes(input.signatureHex);
    return subtle.verify("HMAC", stored.key, toArrayBuffer(signature), toArrayBuffer(input.data));
  }

  async destroy(input: { ref: SecretProviderHandleRef }): Promise<void> {
    this.keys.delete(input.ref.keyId);
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const value of bytes) {
    out += value.toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]*$/u.test(normalized) || normalized.length % 2 !== 0) {
    throw new InvalidInputError("signatureHex must be valid even-length hex.");
  }

  const out = new Uint8Array(normalized.length / 2);
  for (let idx = 0; idx < normalized.length; idx += 2) {
    out[idx / 2] = Number.parseInt(normalized.slice(idx, idx + 2), 16);
  }

  return out;
}

function copyBytes(value: Uint8Array): Uint8Array {
  const out = new Uint8Array(value.byteLength);
  out.set(value);
  return out;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function copyTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) {
    return undefined;
  }

  return [...tags];
}
