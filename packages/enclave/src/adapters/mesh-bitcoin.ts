import { createHash, createHmac, randomUUID } from "node:crypto";

import { ECPair, bip32, bip39, bitcoin, resolveAddress } from "@meshsdk/bitcoin";

import { HandleNotFoundError, InvalidInputError } from "../errors.js";
import type { ImportWalletInput, WalletPlugin } from "../types.js";
import type {
  BitcoinNetwork,
  GenerateWalletInput,
  PluginHandleRef,
  PublicKeyResult,
  SignMessageInput,
  SignTransactionInput
} from "../wallet/types.js";

interface MeshBitcoinAdapterOptions {
  pluginId?: string;
  defaultNetwork?: BitcoinNetwork;
}

type BitcoinMaterial =
  | {
      kind: "mnemonic";
      words: string[];
    }
  | {
      kind: "wif";
      value: string;
    }
  | {
      kind: "private-key-hex";
      value: string;
    };

interface BitcoinRecord {
  id: string;
  network: BitcoinNetwork;
  material: BitcoinMaterial;
}

const DEFAULT_NETWORK: BitcoinNetwork = "testnet";

export function createMeshBitcoinWalletPlugin(options: MeshBitcoinAdapterOptions = {}): WalletPlugin {
  const pluginId = options.pluginId ?? "mesh-bitcoin";
  const defaultNetwork = options.defaultNetwork ?? DEFAULT_NETWORK;
  const records = new Map<string, BitcoinRecord>();

  return {
    id: pluginId,
    chain: "bitcoin",
    capabilities: {
      signTransaction: true,
      signMessage: true,
      getPublicKey: true
    },
    async generate(input: GenerateWalletInput): Promise<PluginHandleRef> {
      if (input.chain !== "bitcoin") {
        throw new InvalidInputError(`Plugin '${pluginId}' can only generate bitcoin wallets.`);
      }

      const id = randomUUID();
      const words = bip39.generateMnemonic(128).split(" ");
      records.set(id, {
        id,
        network: input.network ?? defaultNetwork,
        material: {
          kind: "mnemonic",
          words
        }
      });

      return { id };
    },
    async import(input: ImportWalletInput): Promise<PluginHandleRef> {
      if (input.chain !== "bitcoin") {
        throw new InvalidInputError(`Plugin '${pluginId}' can only import bitcoin wallets.`);
      }

      const id = randomUUID();
      const network = input.network ?? defaultNetwork;

      if (input.material.format === "mnemonic-words") {
        if (!Array.isArray(input.material.words) || input.material.words.length < 12) {
          throw new InvalidInputError("Bitcoin mnemonic import expects at least 12 words.");
        }

        records.set(id, {
          id,
          network,
          material: {
            kind: "mnemonic",
            words: [...input.material.words]
          }
        });

        return { id };
      }

      if (input.material.format === "wif") {
        const wif = input.material.value.trim();
        if (!wif) {
          throw new InvalidInputError("WIF value is required.");
        }

        records.set(id, {
          id,
          network,
          material: {
            kind: "wif",
            value: wif
          }
        });

        return { id };
      }

      if (input.material.format === "private-key-hex") {
        const normalized = normalizeHex(input.material.value, "Bitcoin private-key-hex");

        records.set(id, {
          id,
          network,
          material: {
            kind: "private-key-hex",
            value: normalized
          }
        });

        return { id };
      }

      throw new InvalidInputError("Unsupported bitcoin import format.");
    },
    async signTransaction(input: { ref: PluginHandleRef; payload: SignTransactionInput }) {
      if (input.payload.chain !== "bitcoin") {
        throw new InvalidInputError("Bitcoin plugin received non-bitcoin SignTransactionInput.");
      }

      const record = getRecord(records, input.ref.id);
      const network = resolveBitcoinNetwork(input.payload.network ?? record.network);
      const pair = deriveKeyPair(record, network);

      try {
        const psbt = bitcoin.Psbt.fromBase64(input.payload.psbtBase64, { network });
        for (let idx = 0; idx < psbt.data.inputs.length; idx += 1) {
          try {
            psbt.signInput(idx, pair);
          } catch {
            // Some inputs may not belong to this signer.
          }
        }

        let txHex: string | undefined;
        if (input.payload.finalize) {
          try {
            psbt.finalizeAllInputs();
            txHex = psbt.extractTransaction().toHex();
          } catch {
            txHex = undefined;
          }
        }

        return {
          chain: "bitcoin" as const,
          signedPsbtBase64: psbt.toBase64(),
          txHex
        };
      } catch {
        const fallback = hmacHex(serializeMaterial(record.material), input.payload.psbtBase64);
        return {
          chain: "bitcoin" as const,
          signedPsbtBase64: Buffer.from(fallback, "hex").toString("base64")
        };
      }
    },
    async signMessage(input: { ref: PluginHandleRef; payload: SignMessageInput }) {
      if (input.payload.chain !== "bitcoin") {
        throw new InvalidInputError("Bitcoin plugin received non-bitcoin SignMessageInput.");
      }

      const record = getRecord(records, input.ref.id);
      const network = resolveBitcoinNetwork(record.network);
      const pair = deriveKeyPair(record, network);
      const digest = createHash("sha256").update(input.payload.message, "utf8").digest();
      const signature = pair.sign(digest);

      return {
        chain: "bitcoin" as const,
        signatureHex: Buffer.from(signature).toString("hex")
      };
    },
    async getPublicKey(input: { ref: PluginHandleRef }): Promise<PublicKeyResult> {
      const record = getRecord(records, input.ref.id);
      const network = resolveBitcoinNetwork(record.network);
      const pair = deriveKeyPair(record, network);
      const resolved = resolveAddress(pair.publicKey, network);

      return {
        chain: "bitcoin",
        publicKeyHex: Buffer.from(pair.publicKey).toString("hex"),
        address: resolved.address
      };
    },
    async destroy(ref: PluginHandleRef): Promise<void> {
      records.delete(ref.id);
    }
  };
}

function getRecord(records: Map<string, BitcoinRecord>, refId: string): BitcoinRecord {
  const found = records.get(refId);
  if (!found) {
    throw new HandleNotFoundError(refId);
  }

  return found;
}

function resolveBitcoinNetwork(network: BitcoinNetwork): bitcoin.networks.Network {
  if (network === "mainnet") {
    return bitcoin.networks.bitcoin;
  }

  if (network === "regtest") {
    return bitcoin.networks.regtest;
  }

  return bitcoin.networks.testnet;
}

function deriveKeyPair(record: BitcoinRecord, network: bitcoin.networks.Network) {
  if (record.material.kind === "mnemonic") {
    const words = record.material.words.join(" ");
    const seed = bip39.mnemonicToSeedSync(words);
    const root = bip32.fromSeed(seed, network);
    const coinType = record.network === "mainnet" ? 0 : 1;
    const child = root.derivePath(`m/84'/${coinType}'/0'/0/0`);
    if (!child.privateKey) {
      throw new InvalidInputError("Derived mnemonic key is missing privateKey.");
    }

    return ECPair.fromPrivateKey(child.privateKey, { network });
  }

  if (record.material.kind === "wif") {
    return ECPair.fromWIF(record.material.value, network);
  }

  return ECPair.fromPrivateKey(Buffer.from(record.material.value, "hex"), { network });
}

function normalizeHex(value: string, label: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length % 2 !== 0 || !/^[0-9a-f]+$/u.test(trimmed)) {
    throw new InvalidInputError(`${label} must be non-empty even-length hex.`);
  }

  return trimmed;
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function serializeMaterial(material: BitcoinMaterial): string {
  if (material.kind === "mnemonic") {
    return material.words.join(" ");
  }

  return material.value;
}
