import { defineConfig } from "vitest/config";

const timeout = Number.parseInt(process.env.SMOKE_TIMEOUT_MS ?? "15000", 10);

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/smoke/**/*.test.ts"],
    testTimeout: Number.isFinite(timeout) ? timeout : 15_000,
    hookTimeout: Number.isFinite(timeout) ? timeout : 15_000,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true
      }
    }
  }
});
