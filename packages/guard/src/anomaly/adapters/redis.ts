import type { StateStore } from "../../types/index.js";

interface RedisHttpStoreOptions {
  baseUrl: string;
  token?: string;
  prefix?: string;
}

interface RedisGetResponse {
  result?: string;
}

export class RedisHttpStore implements StateStore {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly prefix: string;

  public constructor(options: RedisHttpStoreOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.prefix = options.prefix ?? "tripwire";
  }

  private key(key: string): string {
    return `${this.prefix}:${key}`;
  }

  private headers(): HeadersInit {
    const headers: HeadersInit = {
      "content-type": "application/json"
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  public async get<T>(key: string): Promise<T | undefined> {
    const full = encodeURIComponent(this.key(key));
    const res = await fetch(`${this.baseUrl}/get/${full}`, {
      method: "GET",
      headers: this.headers()
    });

    if (!res.ok) {
      throw new Error(`RedisHttpStore GET failed with status ${res.status}`);
    }

    const payload = (await res.json()) as RedisGetResponse;
    if (!payload.result) return undefined;
    return JSON.parse(payload.result) as T;
  }

  public async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const full = encodeURIComponent(this.key(key));
    const encoded = encodeURIComponent(JSON.stringify(value));
    const url = ttlMs
      ? `${this.baseUrl}/set/${full}/${encoded}?px=${Math.max(1, Math.floor(ttlMs))}`
      : `${this.baseUrl}/set/${full}/${encoded}`;

    const res = await fetch(url, {
      method: "GET",
      headers: this.headers()
    });

    if (!res.ok) {
      throw new Error(`RedisHttpStore SET failed with status ${res.status}`);
    }
  }
}
