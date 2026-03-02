import type {
  ChallengeGoalType,
  ChallengeMode as DbChallengeMode,
  ChallengeTheme as DbChallengeTheme,
  DecisionStatus,
  ModerationStatus,
  Prisma
} from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { randomHandleSuffix, sha256 } from "@/lib/server/crypto";
import type { ChallengeInputType, ChallengeMode, ChallengeTheme, DecisionTraceEntry } from "@/lib/challenge/types";

function sanitizeHandle(input: string): string {
  const clean = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  if (clean.length < 3) {
    return `agent-${randomHandleSuffix()}`;
  }

  return clean;
}

async function ensureUniqueHandle(preferred: string): Promise<string> {
  const base = sanitizeHandle(preferred);
  const existing = await prisma.profile.findUnique({ where: { handle: base } });
  if (!existing) return base;

  for (let i = 0; i < 5; i += 1) {
    const candidate = `${base}-${randomHandleSuffix()}`;
    const found = await prisma.profile.findUnique({ where: { handle: candidate } });
    if (!found) return candidate;
  }

  return `${base}-${Date.now().toString(36)}`;
}

export async function createProfile(inputHandle?: string): Promise<{ id: string; handle: string }> {
  const preferred = inputHandle?.trim() || `agent-${randomHandleSuffix()}`;
  const handle = await ensureUniqueHandle(preferred);
  const profile = await prisma.profile.create({
    data: {
      handle
    }
  });

  return {
    id: profile.id,
    handle: profile.handle
  };
}

export async function updateProfileSeen(profileId: string): Promise<void> {
  await prisma.profile.update({
    where: { id: profileId },
    data: {
      lastSeenAt: new Date()
    }
  });
}

export async function createChallengeSession(input: {
  profileId: string;
  theme: ChallengeTheme;
  mode: ChallengeMode;
  inputType: ChallengeInputType;
  dailyFlagVersion: string;
}) {
  return prisma.challengeSession.create({
    data: {
      profileId: input.profileId,
      theme: input.theme as DbChallengeTheme,
      mode: input.mode as DbChallengeMode,
      inputType: input.inputType,
      dailyFlagVersion: input.dailyFlagVersion
    }
  });
}

export async function getChallengeSession(profileId: string, sessionId: string) {
  return prisma.challengeSession.findFirst({
    where: {
      id: sessionId,
      profileId
    },
    include: {
      outcomes: {
        orderBy: {
          solvedAt: "asc"
        }
      },
      attempts: {
        orderBy: {
          createdAt: "desc"
        },
        take: 20
      },
      profile: true
    }
  });
}

export interface RecordAttemptInput {
  sessionId: string;
  profileId: string;
  source: "chat" | "tool";
  requestId: string;
  payload: unknown;
  moderationStatus: "clean" | "blocked";
  moderationReason?: string;
  decisionStatus: DecisionStatus;
  decisionTrace?: DecisionTraceEntry[];
  executionStatus?: string;
  challengeMeta?: Record<string, unknown>;
}

function redactPayload(payload: unknown): Prisma.InputJsonValue {
  if (payload === null || payload === undefined) {
    return {};
  }

  if (typeof payload !== "object") {
    if (typeof payload === "string") return payload.slice(0, 1000);
    if (typeof payload === "number" || typeof payload === "boolean") return payload;
    return String(payload);
  }

  const secretKeys = ["apiKey", "authorization", "token", "password", "secret", "privateKey"];
  const source = payload as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (secretKeys.some((secretKey) => key.toLowerCase().includes(secretKey.toLowerCase()))) {
      redacted[key] = "[REDACTED]";
      continue;
    }

    if (typeof value === "string") {
      redacted[key] = value.slice(0, 2000);
      continue;
    }

    if (Array.isArray(value)) {
      redacted[key] = value.slice(0, 20).map((entry) =>
        typeof entry === "string" ? entry.slice(0, 500) : typeof entry === "object" ? "[OBJECT]" : entry
      );
      continue;
    }

    redacted[key] = value;
  }

  return redacted as Prisma.InputJsonValue;
}

export async function recordChallengeAttempt(input: RecordAttemptInput) {
  const jsonPayload =
    input.payload && typeof input.payload === "object"
      ? (input.payload as Record<string, unknown>)
      : { value: input.payload };

  const payloadString = JSON.stringify(jsonPayload);

  return prisma.challengeAttempt.create({
    data: {
      sessionId: input.sessionId,
      profileId: input.profileId,
      source: input.source,
      requestId: input.requestId,
      redactedPayload: redactPayload(jsonPayload),
      rawPayloadHash: sha256(payloadString),
      moderationStatus: input.moderationStatus as ModerationStatus,
      moderationReason: input.moderationReason,
      decisionStatus: input.decisionStatus,
      decisionTrace: input.decisionTrace
        ? (input.decisionTrace as unknown as Prisma.InputJsonValue)
        : undefined,
      executionStatus: input.executionStatus,
      challengeMeta: input.challengeMeta
        ? (input.challengeMeta as unknown as Prisma.InputJsonValue)
        : undefined
    }
  });
}

function themeScopeKey(theme: ChallengeTheme, mode: ChallengeMode, profileId: string): string {
  return `theme:${theme}:${mode}:${profileId}`;
}

function globalScopeKey(profileId: string): string {
  return `global:${profileId}`;
}

async function upsertLeaderboardEntry(input: {
  profileId: string;
  theme: ChallengeTheme;
  mode: ChallengeMode;
  solvedAt: Date;
  solveMs: number;
  goalType: "flag_exfiltration" | "blocked_action_bypass";
}) {
  const themeKey = themeScopeKey(input.theme, input.mode, input.profileId);
  const globalKey = globalScopeKey(input.profileId);

  const existingTheme = await prisma.leaderboardEntry.findUnique({ where: { scopeKey: themeKey } });
  if (!existingTheme || input.solvedAt < existingTheme.solvedAt) {
    await prisma.leaderboardEntry.upsert({
      where: { scopeKey: themeKey },
      create: {
        scope: "THEME_MODE",
        scopeKey: themeKey,
        profileId: input.profileId,
        theme: input.theme as DbChallengeTheme,
        mode: input.mode as DbChallengeMode,
        solvedAt: input.solvedAt,
        solveMs: input.solveMs,
        goalType: input.goalType as ChallengeGoalType
      },
      update: {
        solvedAt: input.solvedAt,
        solveMs: input.solveMs,
        goalType: input.goalType as ChallengeGoalType
      }
    });
  }

  const existingGlobal = await prisma.leaderboardEntry.findUnique({ where: { scopeKey: globalKey } });
  if (!existingGlobal || input.solvedAt < existingGlobal.solvedAt) {
    await prisma.leaderboardEntry.upsert({
      where: { scopeKey: globalKey },
      create: {
        scope: "GLOBAL",
        scopeKey: globalKey,
        profileId: input.profileId,
        solvedAt: input.solvedAt,
        solveMs: input.solveMs,
        goalType: input.goalType as ChallengeGoalType
      },
      update: {
        solvedAt: input.solvedAt,
        solveMs: input.solveMs,
        goalType: input.goalType as ChallengeGoalType,
        theme: null,
        mode: null
      }
    });
  }
}

export async function maybeCreateChallengeOutcome(input: {
  sessionId: string;
  profileId: string;
  theme: ChallengeTheme;
  mode: ChallengeMode;
  goalType?: "flag_exfiltration" | "blocked_action_bypass";
  verificationData?: Record<string, unknown>;
}) {
  if (!input.goalType) return undefined;

  const session = await prisma.challengeSession.findUnique({
    where: { id: input.sessionId },
    include: { outcomes: true }
  });

  if (!session || session.profileId !== input.profileId) return undefined;
  if (session.outcomes.length > 0) {
    return session.outcomes[0];
  }

  const solvedAt = new Date();
  const solveMs = Math.max(0, solvedAt.getTime() - session.startedAt.getTime());

  const outcome = await prisma.challengeOutcome.create({
    data: {
      sessionId: input.sessionId,
      profileId: input.profileId,
      theme: input.theme as DbChallengeTheme,
      mode: input.mode as DbChallengeMode,
      goalType: input.goalType as ChallengeGoalType,
      solvedAt,
      solveMs,
      verificationData: (input.verificationData ?? {}) as Prisma.InputJsonValue
    }
  });

  await prisma.challengeSession.update({
    where: { id: input.sessionId },
    data: {
      status: "solved",
      endedAt: solvedAt
    }
  });

  await upsertLeaderboardEntry({
    profileId: input.profileId,
    theme: input.theme,
    mode: input.mode,
    solvedAt,
    solveMs,
    goalType: input.goalType
  });

  return outcome;
}

export async function listThemeLeaderboard(theme: ChallengeTheme, mode: ChallengeMode, page = 1, pageSize = 25) {
  const safePage = Math.max(1, page);
  const safeSize = Math.max(1, Math.min(100, pageSize));

  const [rows, total] = await Promise.all([
    prisma.leaderboardEntry.findMany({
      where: {
        scope: "THEME_MODE",
        theme: theme as DbChallengeTheme,
        mode: mode as DbChallengeMode
      },
      include: { profile: true },
      orderBy: [{ solvedAt: "asc" }, { solveMs: "asc" }],
      skip: (safePage - 1) * safeSize,
      take: safeSize
    }),
    prisma.leaderboardEntry.count({
      where: {
        scope: "THEME_MODE",
        theme: theme as DbChallengeTheme,
        mode: mode as DbChallengeMode
      }
    })
  ]);

  return {
    page: safePage,
    pageSize: safeSize,
    total,
    rows: rows.map((row, index) => ({
      rank: (safePage - 1) * safeSize + index + 1,
      handle: row.profile.handle,
      theme: row.theme,
      mode: row.mode,
      solvedAt: row.solvedAt.toISOString(),
      solveMs: row.solveMs,
      goalType: row.goalType
    }))
  };
}

export async function listGlobalLeaderboard(page = 1, pageSize = 25) {
  const safePage = Math.max(1, page);
  const safeSize = Math.max(1, Math.min(100, pageSize));

  const [rows, total] = await Promise.all([
    prisma.leaderboardEntry.findMany({
      where: {
        scope: "GLOBAL"
      },
      include: { profile: true },
      orderBy: [{ solvedAt: "asc" }, { solveMs: "asc" }],
      skip: (safePage - 1) * safeSize,
      take: safeSize
    }),
    prisma.leaderboardEntry.count({ where: { scope: "GLOBAL" } })
  ]);

  return {
    page: safePage,
    pageSize: safeSize,
    total,
    rows: rows.map((row, index) => ({
      rank: (safePage - 1) * safeSize + index + 1,
      handle: row.profile.handle,
      solvedAt: row.solvedAt.toISOString(),
      solveMs: row.solveMs,
      goalType: row.goalType
    }))
  };
}
