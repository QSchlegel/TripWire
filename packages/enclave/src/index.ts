export { createEnclave } from "./enclave.js";
export {
  buildRelaySignatureBaseString,
  sha256Hex,
  signRelayDeliveryWithHandle,
  type BuildRelaySignatureBaseStringInput,
  type SignRelayWithHandleInput
} from "./relay.js";
export { InMemoryWebCryptoSecretProvider } from "./secret/in-memory-webcrypto.js";
export type {
  SecretProvider,
  SecretProviderGenerateInput,
  SecretProviderHandleRef,
  SecretProviderImportInput
} from "./secret/provider.js";
export {
  ChainMismatchError,
  EnclaveError,
  HandleNotFoundError,
  HandleTypeMismatchError,
  InvalidInputError,
  OperationNotSupportedError,
  PluginAlreadyRegisteredError,
  PluginNotFoundError,
  ProviderError
} from "./errors.js";
export type {
  BitcoinNetwork,
  CardanoNetwork,
  ChainId,
  DataEncoding,
  DestroyHandleInput,
  Enclave,
  EnclaveConfig,
  GenerateSecretInput,
  GenerateWalletInput,
  GetPublicKeyInput,
  ImportSecretInput,
  ImportWalletInput,
  PluginHandleRef,
  PublicKeyResult,
  SecretHandle,
  SignedMessageResult,
  SignedTransactionResult,
  SignHmacInput,
  SignMessageInput,
  SignTransactionInput,
  VerifyHmacInput,
  WalletHandle,
  WalletPlugin,
  WalletPluginCapabilities,
  WalletPluginDescriptor
} from "./types.js";
