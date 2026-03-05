import type { SecretProvider } from "./secret/provider.js";
import type {
  GenerateWalletInput,
  GetPublicKeyInput,
  ImportWalletInput,
  PublicKeyResult,
  SignedMessageResult,
  SignedTransactionResult,
  SignMessageInput,
  SignTransactionInput,
  WalletPlugin,
  WalletPluginDescriptor
} from "./wallet/types.js";

export type ChainId = "cardano" | "bitcoin" | string;

export interface SecretHandle {
  id: string;
  kind: "secret";
  algorithm: "hmac-sha256";
  provider: string;
  createdAt: string;
  tags?: string[];
}

export interface WalletHandle {
  id: string;
  kind: "wallet";
  chain: ChainId;
  pluginId: string;
  createdAt: string;
  tags?: string[];
}

export interface GenerateSecretInput {
  lengthBytes?: number;
  tags?: string[];
}

export interface ImportSecretInput {
  raw: Uint8Array;
  tags?: string[];
}

export type DataEncoding = "utf8" | "hex" | "base64";

export interface SignHmacInput {
  handleId: string;
  data: string | Uint8Array | ArrayBuffer;
  encoding?: DataEncoding;
}

export interface VerifyHmacInput extends SignHmacInput {
  signatureHex: string;
}

export interface DestroyHandleInput {
  handleId: string;
}

export interface EnclaveConfig {
  secretProvider?: SecretProvider;
  walletPlugins?: WalletPlugin[];
}

export interface Enclave {
  generateSecret(input?: GenerateSecretInput): Promise<SecretHandle>;
  importSecret(input: ImportSecretInput): Promise<SecretHandle>;
  signHmacHex(input: SignHmacInput): Promise<string>;
  verifyHmacHex(input: VerifyHmacInput): Promise<boolean>;
  destroyHandle(input: DestroyHandleInput): Promise<void>;

  registerWalletPlugin(plugin: WalletPlugin): void;
  listWalletPlugins(): WalletPluginDescriptor[];

  generateWallet(input: GenerateWalletInput): Promise<WalletHandle>;
  importWallet(input: ImportWalletInput): Promise<WalletHandle>;
  signTransaction(input: SignTransactionInput): Promise<SignedTransactionResult>;
  signMessage(input: SignMessageInput): Promise<SignedMessageResult>;
  getPublicKey(input: GetPublicKeyInput): Promise<PublicKeyResult>;
}

export type {
  BitcoinNetwork,
  CardanoNetwork,
  GenerateWalletInput,
  GetPublicKeyInput,
  ImportWalletInput,
  PluginHandleRef,
  PublicKeyResult,
  SignedMessageResult,
  SignedTransactionResult,
  SignMessageInput,
  SignTransactionInput,
  WalletPlugin,
  WalletPluginCapabilities,
  WalletPluginDescriptor
} from "./wallet/types.js";
