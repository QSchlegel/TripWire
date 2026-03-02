import { env } from "@/lib/server/env";
import { hmacSha256 } from "@/lib/server/crypto";
import type { ChallengeMode, ChallengeTheme } from "@/lib/challenge/types";

export function dailyFlagVersion(at = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-${String(
    at.getUTCDate()
  ).padStart(2, "0")}`;
}

export function buildDailyFlag(theme: ChallengeTheme, mode: ChallengeMode, version = dailyFlagVersion()): string {
  const digest = hmacSha256(`${version}:${theme}:${mode}`, env.flagSalt).slice(0, 16).toUpperCase();
  return `TWCTF{${theme.toUpperCase()}_${mode.toUpperCase()}_${digest}}`;
}
