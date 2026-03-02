const DEFAULT_COOKIE_NAME = "tripwire_profile";
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
const DEFAULT_RATE_LIMIT_PER_DAY = 2000;

function readRequired(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function readOptional(key: string, fallback?: string): string | undefined {
  const value = process.env[key] ?? fallback;
  if (!value || value.trim().length === 0) return undefined;
  return value;
}

function readPositiveInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: readOptional("DATABASE_URL"),
  profileCookieName: process.env.TRIPWIRE_PROFILE_COOKIE_NAME ?? DEFAULT_COOKIE_NAME,
  profileCookieSecret: readRequired("TRIPWIRE_PROFILE_COOKIE_SECRET", "dev-profile-cookie-secret-change-me"),
  flagSalt: readRequired("TRIPWIRE_FLAG_SALT", "dev-flag-salt-change-me"),
  adminApiKey: readRequired("TRIPWIRE_ADMIN_API_KEY", "dev-admin-key-change-me"),
  hostedOpenAiApiKey: readOptional("OPENAI_API_KEY"),
  hostedOpenAiModel: process.env.TRIPWIRE_OPENAI_MODEL ?? "gpt-4.1-mini",
  rateLimitPerMinute: readPositiveInt("TRIPWIRE_RATE_LIMIT_PER_MINUTE", DEFAULT_RATE_LIMIT_PER_MINUTE),
  rateLimitPerDay: readPositiveInt("TRIPWIRE_RATE_LIMIT_PER_DAY", DEFAULT_RATE_LIMIT_PER_DAY)
};

export function isProduction(): boolean {
  return env.nodeEnv === "production";
}
