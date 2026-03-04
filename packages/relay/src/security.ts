import crypto from "node:crypto";
import type {
  BuildSignatureBaseStringInput,
  SignRelayDeliveryInput,
  VerifyRelaySignatureInput,
  VerifyRelaySignatureResult
} from "./types.js";

const DEFAULT_MAX_SKEW_SECONDS = 300;

export function sha256Hex(rawBody: Buffer): string {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

export function buildSignatureBaseString(input: BuildSignatureBaseStringInput): string {
  const bodyHash = sha256Hex(input.rawBody);
  return `${input.method.toUpperCase()}\n${input.path}\n${input.timestamp}\n${input.nonce}\n${bodyHash}`;
}

export function signRelayDelivery(input: SignRelayDeliveryInput): string {
  const baseString = buildSignatureBaseString(input);
  return crypto.createHmac("sha256", input.secret).update(baseString).digest("hex");
}

export function verifyRelaySignature(input: VerifyRelaySignatureInput): VerifyRelaySignatureResult {
  const {
    method,
    path,
    rawBody,
    timestamp,
    nonce,
    signature,
    secret,
    nowEpochSeconds = Math.floor(Date.now() / 1000),
    maxSkewSeconds = DEFAULT_MAX_SKEW_SECONDS
  } = input;

  if (!nonce.trim() || !signature.trim() || !input.botId.trim()) {
    return { ok: false, reason: "missing-auth-headers" };
  }

  const parsedTimestamp = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsedTimestamp)) {
    return { ok: false, reason: "invalid-timestamp" };
  }

  if (Math.abs(nowEpochSeconds - parsedTimestamp) > maxSkewSeconds) {
    return { ok: false, reason: "timestamp-skew" };
  }

  const expected = signRelayDelivery({
    method,
    path,
    timestamp,
    nonce,
    rawBody,
    secret
  });

  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return { ok: false, reason: "signature-mismatch" };
  }

  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { ok: false, reason: "signature-mismatch" };
  }

  return { ok: true };
}
