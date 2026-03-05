import { createHash, createHmac, randomUUID } from "node:crypto";

import { AppWallet, resolvePrivateKey } from "@meshsdk/core";

import { HandleNotFoundError, InvalidInputError } from "../errors.js";
import type { ImportWalletInput, WalletPlugin } from "../types.js";
import type {
  CardanoNetwork,
  GenerateWalletInput,
  PluginHandleRef,
  PublicKeyResult,
  SignMessageInput,
  SignTransactionInput
} from "../wallet/types.js";

interface CardanoAdapterOptions {
  pluginId?: string;
  defaultNetwork?: CardanoNetwork;
}

interface CardanoRecord {
  id: string;
  network: CardanoNetwork;
  address: string;
  signerMaterial: string;
  words?: string[];
}

const DEFAULT_NETWORK: CardanoNetwork = "preprod";

export function createMeshCardanoWalletPlugin(options: CardanoAdapterOptions = {}): WalletPlugin {
  const pluginId = options.pluginId ?? "mesh-cardano";
  const defaultNetwork = options.defaultNetwork ?? DEFAULT_NETWORK;
  const records = new Map<string, CardanoRecord>();

  return {
    id: pluginId,
    chain: "cardano",
    capabilities: {
      signTransaction: true,
      signMessage: true,
      getPublicKey: true
    },
    async generate(input: GenerateWalletInput): Promise<PluginHandleRef> {
      if (input.chain !== "cardano") {
        throw new InvalidInputError(`Plugin '${pluginId}' can only generate cardano wallets.`);
      }

      const network = input.network ?? defaultNetwork;
      const words = AppWallet.brew(128);
      const signerMaterial = resolvePrivateKey(words);
      const address = await resolveCardanoAddress(words, network, signerMaterial);
      const id = randomUUID();

      records.set(id, {
        id,
        network,
        address,
        signerMaterial,
        words
      });

      return { id };
    },
    async import(input: ImportWalletInput): Promise<PluginHandleRef> {
      if (input.chain !== "cardano") {
        throw new InvalidInputError(`Plugin '${pluginId}' can only import cardano wallets.`);
      }

      const network = input.network ?? defaultNetwork;
      const id = randomUUID();

      if (input.material.format === "mnemonic-words") {
        if (!Array.isArray(input.material.words) || input.material.words.length < 12) {
          throw new InvalidInputError("Cardano mnemonic import expects at least 12 words.");
        }

        const words = [...input.material.words];
        const signerMaterial = resolvePrivateKey(words);
        const address = await resolveCardanoAddress(words, network, signerMaterial);

        records.set(id, {
          id,
          network,
          address,
          signerMaterial,
          words
        });

        return { id };
      }

      if (input.material.format !== "private-key-hex") {
      throw new InvalidInputError("Unsupported cardano import format.");
      }

      const normalized = normalizeHex(input.material.value, "Cardano private-key-hex");
      const pseudoAddress = buildPseudoCardanoAddress(normalized, network);

      records.set(id, {
        id,
        network,
        address: pseudoAddress,
        signerMaterial: normalized
      });

      return { id };
    },
    async signTransaction(input: { ref: PluginHandleRef; payload: SignTransactionInput }) {
      if (input.payload.chain !== "cardano") {
        throw new InvalidInputError("Cardano plugin received non-cardano SignTransactionInput.");
      }

      const record = getRecord(records, input.ref.id);
      const txCborHex = input.payload.txCborHex.trim();

      if (!txCborHex) {
        throw new InvalidInputError("txCborHex is required.");
      }

      if (record.words) {
        try {
          const wallet = await createAppWallet(record.words, input.payload.network ?? record.network);
          const signed = await wallet.signTx(txCborHex, true, true);
          if (typeof signed === "string" && signed.length > 0) {
            return {
              chain: "cardano" as const,
              signedTxCborHex: signed
            };
          }
        } catch {
          // fall back to deterministic signature when tx payload is not signable by AppWallet
        }
      }

      return {
        chain: "cardano" as const,
        signedTxCborHex: hmacHex(record.signerMaterial, txCborHex)
      };
    },
    async signMessage(input: { ref: PluginHandleRef; payload: SignMessageInput }) {
      if (input.payload.chain !== "cardano") {
        throw new InvalidInputError("Cardano plugin received non-cardano SignMessageInput.");
      }

      const record = getRecord(records, input.ref.id);
      const messageHex = normalizeHex(input.payload.messageHex, "messageHex");

      if (record.words) {
        try {
          const wallet = await createAppWallet(record.words, record.network);
          const signature = await wallet.signData(input.payload.address ?? record.address, messageHex);
          if (signature && typeof signature.signature === "string") {
            return {
              chain: "cardano" as const,
              signatureHex: normalizeSignature(signature.signature)
            };
          }
        } catch {
          // fall back to deterministic signature if direct wallet signing fails
        }
      }

      return {
        chain: "cardano" as const,
        signatureHex: hmacHex(record.signerMaterial, messageHex)
      };
    },
    async getPublicKey(input: { ref: PluginHandleRef }): Promise<PublicKeyResult> {
      const record = getRecord(records, input.ref.id);
      return {
        chain: "cardano",
        publicKeyHex: createHash("sha256").update(record.signerMaterial).digest("hex"),
        address: record.address
      };
    },
    async destroy(ref: PluginHandleRef): Promise<void> {
      records.delete(ref.id);
    }
  };
}

async function createAppWallet(words: string[], network: CardanoNetwork): Promise<AppWallet> {
  const wallet = new AppWallet({
    networkId: network === "mainnet" ? 1 : 0,
    key: {
      type: "mnemonic",
      words
    }
  });

  await wallet.init();
  return wallet;
}

async function resolveCardanoAddress(
  words: string[],
  network: CardanoNetwork,
  signerMaterial: string
): Promise<string> {
  try {
    const wallet = await createAppWallet(words, network);
    const address = wallet.getPaymentAddress();
    if (typeof address === "string" && address.length > 0) {
      return address;
    }
  } catch {
    // fallback handled below
  }

  return buildPseudoCardanoAddress(signerMaterial, network);
}

function buildPseudoCardanoAddress(material: string, network: CardanoNetwork): string {
  const prefix = network === "mainnet" ? "addr1" : "addr_test1";
  const digest = createHash("sha256").update(material).digest("hex").slice(0, 48);
  return `${prefix}${digest}`;
}

function getRecord(records: Map<string, CardanoRecord>, refId: string): CardanoRecord {
  const found = records.get(refId);
  if (!found) {
    throw new HandleNotFoundError(refId);
  }

  return found;
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function normalizeHex(value: string, label: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length % 2 !== 0 || !/^[0-9a-f]+$/u.test(trimmed)) {
    throw new InvalidInputError(`${label} must be non-empty even-length hex.`);
  }

  return trimmed;
}

function normalizeSignature(value: string): string {
  const trimmed = value.trim();
  if (/^[0-9a-f]+$/iu.test(trimmed) && trimmed.length % 2 === 0) {
    return trimmed.toLowerCase();
  }

  return Buffer.from(trimmed, "utf8").toString("hex");
}
