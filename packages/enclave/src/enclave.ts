import { randomUUID } from "node:crypto";

import {
  ChainMismatchError,
  HandleNotFoundError,
  InvalidInputError,
  PluginNotFoundError,
  ProviderError
} from "./errors.js";
import { InMemoryWebCryptoSecretProvider } from "./secret/in-memory-webcrypto.js";
import type { SecretProviderHandleRef } from "./secret/provider.js";
import type {
  DataEncoding,
  DestroyHandleInput,
  Enclave,
  EnclaveConfig,
  GenerateSecretInput,
  ImportSecretInput,
  SecretHandle,
  SignHmacInput,
  VerifyHmacInput,
  WalletHandle
} from "./types.js";
import { WalletPluginRegistry } from "./wallet/registry.js";
import type {
  GenerateWalletInput,
  GetPublicKeyInput,
  ImportWalletInput,
  PluginHandleRef,
  PublicKeyResult,
  SignedMessageResult,
  SignedTransactionResult,
  SignMessageInput,
  SignTransactionInput,
  WalletPlugin
} from "./wallet/types.js";

interface SecretRecord {
  handle: SecretHandle;
  ref: SecretProviderHandleRef;
}

interface WalletRecord {
  handle: WalletHandle;
  ref: PluginHandleRef;
}

class EnclaveImpl implements Enclave {
  private readonly secretRecords = new Map<string, SecretRecord>();
  private readonly walletRecords = new Map<string, WalletRecord>();
  private readonly walletRegistry = new WalletPluginRegistry();

  constructor(private readonly config: Required<Pick<EnclaveConfig, "secretProvider">>) {}

  async generateSecret(input: GenerateSecretInput = {}): Promise<SecretHandle> {
    const lengthBytes = input.lengthBytes ?? 32;
    if (!Number.isInteger(lengthBytes) || lengthBytes <= 0) {
      throw new InvalidInputError("lengthBytes must be a positive integer.");
    }

    const ref = await this.config.secretProvider.generate({
      algorithm: "hmac-sha256",
      lengthBytes,
      tags: copyTags(input.tags)
    });

    const handle: SecretHandle = {
      id: buildHandleId("sec"),
      kind: "secret",
      algorithm: "hmac-sha256",
      provider: ref.provider,
      createdAt: ref.createdAt,
      tags: copyTags(input.tags)
    };

    this.secretRecords.set(handle.id, {
      handle,
      ref
    });

    return copySecretHandle(handle);
  }

  async importSecret(input: ImportSecretInput): Promise<SecretHandle> {
    if (!input.raw || input.raw.byteLength === 0) {
      throw new InvalidInputError("raw must be a non-empty Uint8Array.");
    }

    const copiedRaw = new Uint8Array(input.raw.byteLength);
    copiedRaw.set(input.raw);

    try {
      const ref = await this.config.secretProvider.import({
        algorithm: "hmac-sha256",
        raw: copiedRaw,
        tags: copyTags(input.tags)
      });

      const handle: SecretHandle = {
        id: buildHandleId("sec"),
        kind: "secret",
        algorithm: "hmac-sha256",
        provider: ref.provider,
        createdAt: ref.createdAt,
        tags: copyTags(input.tags)
      };

      this.secretRecords.set(handle.id, {
        handle,
        ref
      });

      return copySecretHandle(handle);
    } finally {
      copiedRaw.fill(0);
      bestEffortZeroize(input.raw);
    }
  }

  async signHmacHex(input: SignHmacInput): Promise<string> {
    const record = this.secretRecords.get(input.handleId);
    if (!record) {
      throw new HandleNotFoundError(input.handleId);
    }

    try {
      const data = toBytes(input.data, input.encoding);
      return await this.config.secretProvider.signHex({
        ref: record.ref,
        data
      });
    } catch (error) {
      throw normalizeProviderError("Failed to sign with secret handle.", error);
    }
  }

  async verifyHmacHex(input: VerifyHmacInput): Promise<boolean> {
    const record = this.secretRecords.get(input.handleId);
    if (!record) {
      throw new HandleNotFoundError(input.handleId);
    }

    try {
      const data = toBytes(input.data, input.encoding);
      return await this.config.secretProvider.verifyHex({
        ref: record.ref,
        data,
        signatureHex: input.signatureHex
      });
    } catch (error) {
      throw normalizeProviderError("Failed to verify with secret handle.", error);
    }
  }

  async destroyHandle(input: DestroyHandleInput): Promise<void> {
    const secretRecord = this.secretRecords.get(input.handleId);
    if (secretRecord) {
      await this.config.secretProvider.destroy({ ref: secretRecord.ref });
      this.secretRecords.delete(input.handleId);
      return;
    }

    const walletRecord = this.walletRecords.get(input.handleId);
    if (walletRecord) {
      const plugin = this.walletRegistry.getById(walletRecord.handle.pluginId);
      if (plugin?.destroy) {
        await plugin.destroy(walletRecord.ref);
      }
      this.walletRecords.delete(input.handleId);
      return;
    }

    throw new HandleNotFoundError(input.handleId);
  }

  registerWalletPlugin(plugin: WalletPlugin): void {
    this.walletRegistry.register(plugin);
  }

  listWalletPlugins() {
    return this.walletRegistry.list();
  }

  async generateWallet(input: GenerateWalletInput): Promise<WalletHandle> {
    const plugin = this.resolveWalletPlugin(input.chain, input.pluginId);
    const ref = await plugin.generate(input);

    const handle: WalletHandle = {
      id: buildHandleId("wal"),
      kind: "wallet",
      chain: plugin.chain,
      pluginId: plugin.id,
      createdAt: new Date().toISOString(),
      tags: copyTags(input.tags)
    };

    this.walletRecords.set(handle.id, {
      handle,
      ref
    });

    return copyWalletHandle(handle);
  }

  async importWallet(input: ImportWalletInput): Promise<WalletHandle> {
    const plugin = this.resolveWalletPlugin(input.chain, input.pluginId);
    const ref = await plugin.import(input);

    const handle: WalletHandle = {
      id: buildHandleId("wal"),
      kind: "wallet",
      chain: plugin.chain,
      pluginId: plugin.id,
      createdAt: new Date().toISOString(),
      tags: copyTags(input.tags)
    };

    this.walletRecords.set(handle.id, {
      handle,
      ref
    });

    return copyWalletHandle(handle);
  }

  async signTransaction(input: SignTransactionInput): Promise<SignedTransactionResult> {
    const record = this.getWalletRecord(input.handleId);
    assertChainMatch(record, input.chain);

    const plugin = this.getRequiredPlugin(record.handle.pluginId);
    return plugin.signTransaction({
      ref: record.ref,
      payload: input
    });
  }

  async signMessage(input: SignMessageInput): Promise<SignedMessageResult> {
    const record = this.getWalletRecord(input.handleId);
    assertChainMatch(record, input.chain);

    const plugin = this.getRequiredPlugin(record.handle.pluginId);
    return plugin.signMessage({
      ref: record.ref,
      payload: input
    });
  }

  async getPublicKey(input: GetPublicKeyInput): Promise<PublicKeyResult> {
    const record = this.getWalletRecord(input.handleId);
    assertChainMatch(record, input.chain);

    const plugin = this.getRequiredPlugin(record.handle.pluginId);
    return plugin.getPublicKey({
      ref: record.ref,
      handleId: input.handleId
    });
  }

  private resolveWalletPlugin(chain: string, pluginId?: string): WalletPlugin {
    if (pluginId?.trim()) {
      const plugin = this.walletRegistry.getById(pluginId);
      if (!plugin) {
        throw new PluginNotFoundError({ pluginId });
      }

      if (plugin.chain !== chain) {
        throw new ChainMismatchError(pluginId, plugin.chain, chain);
      }

      return plugin;
    }

    const first = this.walletRegistry.getByChain(chain)[0];
    if (!first) {
      throw new PluginNotFoundError({ chain });
    }

    return first;
  }

  private getWalletRecord(handleId: string): WalletRecord {
    const record = this.walletRecords.get(handleId);
    if (!record) {
      throw new HandleNotFoundError(handleId);
    }

    return record;
  }

  private getRequiredPlugin(pluginId: string): WalletPlugin {
    const plugin = this.walletRegistry.getById(pluginId);
    if (!plugin) {
      throw new PluginNotFoundError({ pluginId });
    }

    return plugin;
  }
}

function assertChainMatch(record: WalletRecord, requestedChain: string): void {
  if (record.handle.chain !== requestedChain) {
    throw new ChainMismatchError(record.handle.id, record.handle.chain, requestedChain);
  }
}

function toBytes(data: string | Uint8Array | ArrayBuffer, encoding: DataEncoding = "utf8"): Uint8Array {
  if (typeof data === "string") {
    if (encoding === "utf8") {
      return new TextEncoder().encode(data);
    }

    if (encoding === "hex") {
      return hexToBytes(data);
    }

    if (encoding === "base64") {
      return Uint8Array.from(Buffer.from(data, "base64"));
    }

    throw new InvalidInputError(`Unsupported encoding '${encoding}'.`);
  }

  if (data instanceof Uint8Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  throw new InvalidInputError("data must be string, Uint8Array, or ArrayBuffer.");
}

function hexToBytes(value: string): Uint8Array {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]*$/u.test(normalized) || normalized.length % 2 !== 0) {
    throw new InvalidInputError("Hex string must contain an even number of [0-9a-f] characters.");
  }

  const out = new Uint8Array(normalized.length / 2);
  for (let idx = 0; idx < normalized.length; idx += 2) {
    out[idx / 2] = Number.parseInt(normalized.slice(idx, idx + 2), 16);
  }

  return out;
}

function bestEffortZeroize(value: Uint8Array): void {
  try {
    value.fill(0);
  } catch {
    // best effort only
  }
}

function copyTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) {
    return undefined;
  }

  return [...tags];
}

function buildHandleId(prefix: "sec" | "wal"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function normalizeProviderError(message: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  if (error instanceof Error) {
    return new ProviderError(`${message} ${error.message}`.trim(), error);
  }

  return new ProviderError(message, error);
}

function copySecretHandle(value: SecretHandle): SecretHandle {
  return {
    ...value,
    tags: copyTags(value.tags)
  };
}

function copyWalletHandle(value: WalletHandle): WalletHandle {
  return {
    ...value,
    tags: copyTags(value.tags)
  };
}

export function createEnclave(config: EnclaveConfig = {}): Enclave {
  const enclave = new EnclaveImpl({
    secretProvider: config.secretProvider ?? new InMemoryWebCryptoSecretProvider()
  });

  if (config.walletPlugins) {
    for (const plugin of config.walletPlugins) {
      enclave.registerWalletPlugin(plugin);
    }
  }

  return enclave;
}
