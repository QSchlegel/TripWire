import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import type { ChallengeMode, ChallengeTheme } from "@/lib/challenge/types";

export interface HardeningPatch {
  promptAppend: string[];
  addBlockedTextRegexes: string[];
}

interface ScopedPatch {
  theme?: ChallengeTheme;
  mode?: ChallengeMode;
  promptAppend?: string;
  addBlockedTextRegexes?: string[];
}

function parseScopedPatch(value: Prisma.JsonValue | null | undefined): ScopedPatch[] {
  if (!value) return [];

  const rows = Array.isArray(value) ? value : [value];
  const parsed: ScopedPatch[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const obj = row as Record<string, unknown>;

    parsed.push({
      theme: typeof obj.theme === "string" ? (obj.theme as ChallengeTheme) : undefined,
      mode: typeof obj.mode === "string" ? (obj.mode as ChallengeMode) : undefined,
      promptAppend: typeof obj.promptAppend === "string" ? obj.promptAppend : undefined,
      addBlockedTextRegexes: Array.isArray(obj.addBlockedTextRegexes)
        ? obj.addBlockedTextRegexes.filter((item): item is string => typeof item === "string")
        : undefined
    });
  }

  return parsed;
}

function patchAppliesToScope(
  patch: ScopedPatch,
  theme: ChallengeTheme,
  mode: ChallengeMode
): boolean {
  const themeMatches = !patch.theme || patch.theme === theme;
  const modeMatches = !patch.mode || patch.mode === mode;
  return themeMatches && modeMatches;
}

export async function getActiveHardeningPatch(
  theme: ChallengeTheme,
  mode: ChallengeMode
): Promise<HardeningPatch> {
  const activeDeployment = await prisma.rlDeployment.findFirst({
    where: { isActive: true },
    include: { candidate: true },
    orderBy: { activatedAt: "desc" }
  });

  if (!activeDeployment) {
    return {
      promptAppend: [],
      addBlockedTextRegexes: []
    };
  }

  const promptRows = parseScopedPatch(activeDeployment.candidate.promptDiff);
  const policyRows = parseScopedPatch(activeDeployment.candidate.policyDiff);

  const promptAppend = promptRows
    .filter((row) => patchAppliesToScope(row, theme, mode))
    .map((row) => row.promptAppend)
    .filter((value): value is string => typeof value === "string");

  const addBlockedTextRegexes = policyRows
    .filter((row) => patchAppliesToScope(row, theme, mode))
    .flatMap((row) => row.addBlockedTextRegexes ?? []);

  return {
    promptAppend,
    addBlockedTextRegexes: Array.from(new Set(addBlockedTextRegexes))
  };
}
