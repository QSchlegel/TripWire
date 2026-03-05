import { createHash } from "node:crypto";

import type { Enclave } from "./types.js";

export interface BuildRelaySignatureBaseStringInput {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: Uint8Array | ArrayBuffer | string;
}

export interface SignRelayWithHandleInput extends BuildRelaySignatureBaseStringInput {
  enclave: Pick<Enclave, "signHmacHex">;
  handleId: string;
}

export function sha256Hex(rawBody: Uint8Array): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function buildRelaySignatureBaseString(input: BuildRelaySignatureBaseStringInput): string {
  const rawBody = toBytes(input.rawBody);
  const bodyHash = sha256Hex(rawBody);
  return `${input.method.toUpperCase()}\n${input.path}\n${input.timestamp}\n${input.nonce}\n${bodyHash}`;
}

export async function signRelayDeliveryWithHandle(input: SignRelayWithHandleInput): Promise<string> {
  const baseString = buildRelaySignatureBaseString(input);
  return input.enclave.signHmacHex({
    handleId: input.handleId,
    data: baseString,
    encoding: "utf8"
  });
}

function toBytes(input: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof input === "string") {
    return new TextEncoder().encode(input);
  }

  if (input instanceof Uint8Array) {
    return input;
  }

  return new Uint8Array(input);
}
