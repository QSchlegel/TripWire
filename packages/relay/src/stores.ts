import type { IdempotencyRecord, IdempotencyStore, NonceStore, RateLimitHit, RateLimitStore } from "./types.js";

interface ExpiringEntry<T> {
  value: T;
  expiresAt: number;
}

export class InMemoryNonceStore implements NonceStore {
  private readonly values = new Map<string, number>();

  async consume(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    this.prune(now);

    const existing = this.values.get(key);
    if (existing && existing > now) {
      return false;
    }

    this.values.set(key, now + ttlSeconds * 1000);
    return true;
  }

  private prune(now: number): void {
    for (const [key, expiresAt] of this.values.entries()) {
      if (expiresAt <= now) {
        this.values.delete(key);
      }
    }
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly values = new Map<string, ExpiringEntry<IdempotencyRecord>>();

  async get(botId: string, requestId: string): Promise<IdempotencyRecord | undefined> {
    const now = Date.now();
    const key = compositeKey(botId, requestId);
    const existing = this.values.get(key);

    if (!existing) {
      return undefined;
    }

    if (existing.expiresAt <= now) {
      this.values.delete(key);
      return undefined;
    }

    return existing.value;
  }

  async set(botId: string, requestId: string, record: IdempotencyRecord, ttlSeconds: number): Promise<void> {
    const now = Date.now();
    this.prune(now);

    const key = compositeKey(botId, requestId);
    this.values.set(key, {
      value: record,
      expiresAt: now + ttlSeconds * 1000
    });
  }

  private prune(now: number): void {
    for (const [key, value] of this.values.entries()) {
      if (value.expiresAt <= now) {
        this.values.delete(key);
      }
    }
  }
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, RateLimitHit & { windowMs: number; windowStart: number }>();

  async increment(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || now >= existing.resetAt || existing.windowMs !== windowMs) {
      const resetAt = now + windowMs;
      const hit = {
        count: 1,
        resetAt,
        windowMs,
        windowStart: now
      };
      this.windows.set(key, hit);
      this.prune(now);
      return {
        count: hit.count,
        resetAt: hit.resetAt
      };
    }

    existing.count += 1;
    this.prune(now);
    return {
      count: existing.count,
      resetAt: existing.resetAt
    };
  }

  private prune(now: number): void {
    for (const [key, value] of this.windows.entries()) {
      if (value.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }
}

function compositeKey(botId: string, requestId: string): string {
  return `${botId}:${requestId}`;
}
