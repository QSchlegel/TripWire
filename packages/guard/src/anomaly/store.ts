import type { StateStore } from "../types/index.js";

interface StoredValue {
  value: unknown;
  expiresAt?: number;
}

export class InMemoryStore implements StateStore {
  private readonly map = new Map<string, StoredValue>();

  public async get<T>(key: string): Promise<T | undefined> {
    const record = this.map.get(key);
    if (!record) return undefined;

    if (record.expiresAt && Date.now() > record.expiresAt) {
      this.map.delete(key);
      return undefined;
    }

    return record.value as T;
  }

  public async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;
    this.map.set(key, { value, expiresAt });
  }
}
