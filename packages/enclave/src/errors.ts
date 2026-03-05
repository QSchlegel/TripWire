export type EnclaveErrorCode =
  | "handle-not-found"
  | "invalid-input"
  | "handle-type-mismatch"
  | "plugin-already-registered"
  | "plugin-not-found"
  | "chain-mismatch"
  | "provider-error"
  | "operation-not-supported";

export class EnclaveError extends Error {
  readonly code: EnclaveErrorCode;
  readonly details?: unknown;

  constructor(code: EnclaveErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class HandleNotFoundError extends EnclaveError {
  constructor(handleId: string) {
    super("handle-not-found", `No handle found for id '${handleId}'.`);
  }
}

export class InvalidInputError extends EnclaveError {
  constructor(message: string, details?: unknown) {
    super("invalid-input", message, details);
  }
}

export class HandleTypeMismatchError extends EnclaveError {
  constructor(handleId: string, expected: "secret" | "wallet") {
    super("handle-type-mismatch", `Handle '${handleId}' is not a ${expected} handle.`);
  }
}

export class PluginAlreadyRegisteredError extends EnclaveError {
  constructor(pluginId: string) {
    super("plugin-already-registered", `Wallet plugin '${pluginId}' is already registered.`);
  }
}

export class PluginNotFoundError extends EnclaveError {
  constructor(input: { pluginId?: string; chain?: string }) {
    if (input.pluginId) {
      super("plugin-not-found", `Wallet plugin '${input.pluginId}' is not registered.`);
      return;
    }

    super("plugin-not-found", `No wallet plugin is registered for chain '${input.chain ?? "unknown"}'.`);
  }
}

export class ChainMismatchError extends EnclaveError {
  constructor(handleId: string, expected: string, received: string) {
    super(
      "chain-mismatch",
      `Handle '${handleId}' is for chain '${expected}' and cannot be used as '${received}'.`
    );
  }
}

export class ProviderError extends EnclaveError {
  constructor(message: string, details?: unknown) {
    super("provider-error", message, details);
  }
}

export class OperationNotSupportedError extends EnclaveError {
  constructor(message: string) {
    super("operation-not-supported", message);
  }
}
