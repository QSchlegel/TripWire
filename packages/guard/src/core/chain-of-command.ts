import type {
  ChainOfCommandAuthorizationInput,
  ChainOfCommandPermitRecord,
  Decision,
  NormalizedToolEvent,
  StateStore
} from "../types/index.js";
import { hashString } from "../utils/hash.js";
import { stableStringify } from "../utils/serialize.js";

export const DEFAULT_CHAIN_OF_COMMAND_MAX_LEVELS = 3;
const CHAIN_PERMIT_KEY_PREFIX = "chain:permit";

interface PermitScope {
  actorId: string;
  sessionId: string;
}

export function chainOfCommandEnabled(enabled: boolean | undefined): boolean {
  return enabled === true;
}

export function chainOfCommandMaxLevels(raw: number | undefined): number {
  if (typeof raw !== "number" || Number.isNaN(raw)) return DEFAULT_CHAIN_OF_COMMAND_MAX_LEVELS;
  const normalized = Math.floor(raw);
  if (normalized < 1) return 1;
  return normalized;
}

export function isUnsupportedByPolicy(options: {
  fallbackAction: Decision;
  findingsCount: number;
  policyDecision: Decision;
}): boolean {
  return (
    options.fallbackAction === "block" &&
    options.findingsCount === 0 &&
    options.policyDecision === "block"
  );
}

export function unsupportedCallFingerprint(event: NormalizedToolEvent): string {
  const payload = {
    toolName: event.toolName.toLowerCase(),
    text: event.text.trim(),
    intent: event.intent.trim(),
    args: event.args,
    destination: {
      domain: event.destinationDomain ?? "",
      url: event.destinationUrl ?? ""
    },
    actorId: event.actorId,
    sessionId: event.sessionId
  };

  return hashString(stableStringify(payload));
}

export function chainPermitStoreKey(scope: PermitScope, fingerprint: string): string {
  return `${CHAIN_PERMIT_KEY_PREFIX}:${scope.actorId}:${scope.sessionId}:${fingerprint}`;
}

export function createPermitRecord(
  event: NormalizedToolEvent,
  fingerprint: string,
  input: ChainOfCommandAuthorizationInput
): ChainOfCommandPermitRecord {
  const createdAt = new Date().toISOString();
  const permitSeed = {
    fingerprint,
    createdAt,
    actorId: event.actorId,
    sessionId: event.sessionId,
    reviewerId: input.reviewerId
  };

  return {
    permitId: `permit:${hashString(stableStringify(permitSeed))}`,
    fingerprint,
    actorId: event.actorId,
    sessionId: event.sessionId,
    toolName: event.toolName,
    remainingUses: 1,
    createdAt,
    reviewerId: input.reviewerId,
    reason: input.reason,
    supervisorSignature: input.supervisorSignature,
    reviewTrail: input.reviewTrail.map((entry) => ({ ...entry }))
  };
}

export async function readPermit(
  store: StateStore,
  scope: PermitScope,
  fingerprint: string
): Promise<ChainOfCommandPermitRecord | undefined> {
  const key = chainPermitStoreKey(scope, fingerprint);
  return await store.get<ChainOfCommandPermitRecord>(key);
}

export async function writePermit(
  store: StateStore,
  permit: ChainOfCommandPermitRecord
): Promise<void> {
  const key = chainPermitStoreKey(
    {
      actorId: permit.actorId,
      sessionId: permit.sessionId
    },
    permit.fingerprint
  );
  await store.set(key, permit);
}

export async function consumePermit(
  store: StateStore,
  scope: PermitScope,
  fingerprint: string
): Promise<ChainOfCommandPermitRecord | undefined> {
  const key = chainPermitStoreKey(scope, fingerprint);
  const permit = await store.get<ChainOfCommandPermitRecord>(key);
  if (!permit || permit.remainingUses < 1) {
    return undefined;
  }

  const consumed: ChainOfCommandPermitRecord = {
    ...permit,
    remainingUses: permit.remainingUses - 1
  };

  await store.set(key, consumed);
  return consumed;
}
