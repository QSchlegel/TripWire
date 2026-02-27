import type { StateStore } from "../../types/index.js";

interface PostgresStoreOptions {
  connectionString: string;
  table?: string;
}

interface PGClientLike {
  query: (sql: string, args?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

export class PostgresStore implements StateStore {
  private readonly table: string;
  private readonly clientPromise: Promise<PGClientLike>;

  public constructor(options: PostgresStoreOptions) {
    this.table = options.table ?? "tripwire_state";
    this.clientPromise = this.buildClient(options.connectionString);
  }

  private async buildClient(connectionString: string): Promise<PGClientLike> {
    const { Client } = await import("pg");
    const client = new Client({ connectionString });
    await client.connect();

    await client.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (\n` +
        "k TEXT PRIMARY KEY,\n" +
        "v JSONB NOT NULL,\n" +
        "expires_at TIMESTAMPTZ NULL\n" +
        ")"
    );

    return client;
  }

  public async get<T>(key: string): Promise<T | undefined> {
    const client = await this.clientPromise;
    const nowIso = new Date().toISOString();
    const result = await client.query(
      `SELECT v FROM ${this.table} WHERE k = $1 AND (expires_at IS NULL OR expires_at > $2::timestamptz)`,
      [key, nowIso]
    );

    if (result.rows.length === 0) return undefined;
    return result.rows[0].v as T;
  }

  public async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const client = await this.clientPromise;
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null;

    await client.query(
      `INSERT INTO ${this.table} (k, v, expires_at) VALUES ($1, $2::jsonb, $3::timestamptz)\n` +
        "ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, expires_at = EXCLUDED.expires_at",
      [key, JSON.stringify(value), expiresAt]
    );
  }
}
