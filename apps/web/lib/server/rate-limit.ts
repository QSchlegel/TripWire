import { env } from "@/lib/server/env";
import { prisma } from "@/lib/server/prisma";
import type { RateLimitHeaders } from "@/lib/server/api";

interface BucketResult {
  count: number;
  limit: number;
  resetAt: Date;
}

export interface RateLimitResult {
  allowed: boolean;
  minute: BucketResult;
  day: BucketResult;
  headers: RateLimitHeaders;
}

function minuteWindow(now: Date): { start: Date; end: Date; stamp: string } {
  const start = new Date(now);
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 60_000);
  const stamp = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(
    start.getUTCDate()
  ).padStart(2, "0")}T${String(start.getUTCHours()).padStart(2, "0")}:${String(start.getUTCMinutes()).padStart(2, "0")}`;
  return { start, end, stamp };
}

function dayWindow(now: Date): { start: Date; end: Date; stamp: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  const stamp = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(
    start.getUTCDate()
  ).padStart(2, "0")}`;
  return { start, end, stamp };
}

async function incrementBucket(
  key: string,
  start: Date,
  end: Date,
  limit: number
): Promise<BucketResult> {
  const row = await prisma.rateLimitCounter.upsert({
    where: { key },
    create: {
      key,
      windowStart: start,
      windowEnd: end,
      count: 1
    },
    update: {
      count: { increment: 1 },
      windowStart: start,
      windowEnd: end
    }
  });

  return {
    count: row.count,
    limit,
    resetAt: end
  };
}

export async function enforceRateLimit(identity: string): Promise<RateLimitResult> {
  const now = new Date();
  const minute = minuteWindow(now);
  const day = dayWindow(now);

  const [minuteResult, dayResult] = await Promise.all([
    incrementBucket(
      `minute:${identity}:${minute.stamp}`,
      minute.start,
      minute.end,
      env.rateLimitPerMinute
    ),
    incrementBucket(`day:${identity}:${day.stamp}`, day.start, day.end, env.rateLimitPerDay)
  ]);

  const allowed = minuteResult.count <= minuteResult.limit && dayResult.count <= dayResult.limit;

  return {
    allowed,
    minute: minuteResult,
    day: dayResult,
    headers: {
      "X-RateLimit-Limit-Minute": String(minuteResult.limit),
      "X-RateLimit-Limit-Day": String(dayResult.limit),
      "X-RateLimit-Remaining-Minute": String(Math.max(0, minuteResult.limit - minuteResult.count)),
      "X-RateLimit-Remaining-Day": String(Math.max(0, dayResult.limit - dayResult.count)),
      "X-RateLimit-Reset-Minute": String(Math.floor(minuteResult.resetAt.getTime() / 1000)),
      "X-RateLimit-Reset-Day": String(Math.floor(dayResult.resetAt.getTime() / 1000))
    }
  };
}
