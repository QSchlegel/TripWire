import { describe, expect, it } from "vitest";
import { buildDailyFlag, dailyFlagVersion } from "@/lib/challenge/flags";

describe("challenge flags", () => {
  it("builds deterministic per-day/per-theme/per-mode flags", () => {
    const version = "2026-02-28";
    const a = buildDailyFlag("devops", "vulnerable", version);
    const b = buildDailyFlag("devops", "vulnerable", version);
    const c = buildDailyFlag("wallet", "vulnerable", version);

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.startsWith("TWCTF{")).toBe(true);
  });

  it("formats daily flag version in UTC date format", () => {
    const at = new Date(Date.UTC(2026, 1, 28, 12, 30, 0));
    expect(dailyFlagVersion(at)).toBe("2026-02-28");
  });
});
