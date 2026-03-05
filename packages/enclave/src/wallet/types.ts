import type { ChainId } from "../types.js";

export type CardanoNetwork = "mainnet" | "preprod" | "preview";
export type BitcoinNetwork = "mainnet" | "testnet" | "regtest";

export type GenerateWalletInput =
  | {
      chain: "cardano";
      network?: CardanoNetwork;
      tags?: string[];
      pluginId?: string;
    }
  | {
      chain: "bitcoin";
      network?: BitcoinNetwork;
      tags?: string[];
      pluginId?: string;
    };

export type ImportWalletInput =
  | {
      chain: "cardano";
      network?: CardanoNetwork;
      pluginId?: string;
      tags?: string[];
      material:
        | {
            format: "mnemonic-words";
            words: string[];
          }
        | {
            format: "private-key-hex";
            value: string;
          };
    }
  | {
      chain: "bitcoin";
      network?: BitcoinNetwork;
      pluginId?: string;
      tags?: string[];
      material:
        | {
            format: "wif";
            value: string;
          }
        | {
            format: "private-key-hex";
            value: string;
          }
        | {
            format: "mnemonic-words";
            words: string[];
          };
    };

export type SignTransactionInput =
  | {
      handleId: string;
      chain: "cardano";
      txCborHex: string;
      network?: CardanoNetwork;
    }
  | {
      handleId: string;
      chain: "bitcoin";
      psbtBase64: string;
      network?: BitcoinNetwork;
      finalize?: boolean;
    };

export type SignMessageInput =
  | {
      handleId: string;
      chain: "cardano";
      messageHex: string;
      address?: string;
    }
  | {
      handleId: string;
      chain: "bitcoin";
      message: string;
      address?: string;
    };

export type GetPublicKeyInput =
  | {
      handleId: string;
      chain: "cardano";
    }
  | {
      handleId: string;
      chain: "bitcoin";
    };

export type SignedTransactionResult =
  | {
      chain: "cardano";
      signedTxCborHex: string;
    }
  | {
      chain: "bitcoin";
      signedPsbtBase64: string;
      txHex?: string;
    };

export type SignedMessageResult =
  | {
      chain: "cardano";
      signatureHex: string;
    }
  | {
      chain: "bitcoin";
      signatureHex: string;
    };

export type PublicKeyResult =
  | {
      chain: "cardano";
      publicKeyHex: string;
      address: string;
      stakeAddress?: string;
    }
  | {
      chain: "bitcoin";
      publicKeyHex: string;
      address: string;
    };

export interface WalletPluginCapabilities {
  signTransaction: true;
  signMessage: true;
  getPublicKey: true;
}

export interface PluginHandleRef {
  id: string;
  metadata?: Record<string, unknown>;
}

export interface WalletPluginDescriptor {
  id: string;
  chain: ChainId;
  capabilities: WalletPluginCapabilities;
}

export interface WalletPlugin {
  id: string;
  chain: ChainId;
  capabilities: WalletPluginCapabilities;
  generate(input: GenerateWalletInput): Promise<PluginHandleRef>;
  import(input: ImportWalletInput): Promise<PluginHandleRef>;
  signTransaction(input: { ref: PluginHandleRef; payload: SignTransactionInput }): Promise<SignedTransactionResult>;
  signMessage(input: { ref: PluginHandleRef; payload: SignMessageInput }): Promise<SignedMessageResult>;
  getPublicKey(input: { ref: PluginHandleRef; handleId: string }): Promise<PublicKeyResult>;
  destroy?(ref: PluginHandleRef): Promise<void>;
}
