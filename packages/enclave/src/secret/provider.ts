export interface SecretProviderGenerateInput {
  algorithm: "hmac-sha256";
  lengthBytes: number;
  tags?: string[];
}

export interface SecretProviderImportInput {
  algorithm: "hmac-sha256";
  raw: Uint8Array;
  tags?: string[];
}

export interface SecretProviderHandleRef {
  provider: string;
  keyId: string;
  algorithm: "hmac-sha256";
  createdAt: string;
  tags?: string[];
}

export interface SecretProvider {
  readonly providerName: string;
  generate(input: SecretProviderGenerateInput): Promise<SecretProviderHandleRef>;
  import(input: SecretProviderImportInput): Promise<SecretProviderHandleRef>;
  signHex(input: { ref: SecretProviderHandleRef; data: Uint8Array }): Promise<string>;
  verifyHex(input: { ref: SecretProviderHandleRef; data: Uint8Array; signatureHex: string }): Promise<boolean>;
  destroy(input: { ref: SecretProviderHandleRef }): Promise<void>;
}
