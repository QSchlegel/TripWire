import type {
  AnomalyConfig,
  AnomalyMetric,
  AnomalyResult,
  AnomalyRuleTrigger,
  AnomalySignals,
  CompiledPolicy,
  Decision,
  FrequencyStats,
  NormalizedToolEvent,
  StateStore
} from "../types/index.js";
import { hashString } from "../utils/hash.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const defaultConfig: AnomalyConfig = {
  burstWindowMs: 20_000,
  burstMediumCount: 4,
  burstHighCount: 7,
  zScoreMedium: 2.5,
  zScoreHigh: 4,
  requireApprovalScore: 0.45,
  blockScore: 0.8
};

const decisionRank: Record<Decision, number> = {
  allow: 0,
  require_approval: 1,
  block: 2
};

function maxDecision(a: Decision, b: Decision): Decision {
  return decisionRank[a] >= decisionRank[b] ? a : b;
}

async function markNovel(
  store: StateStore,
  key: string,
  token: string,
  ttlMs: number
): Promise<{ novel: boolean; hadBaseline: boolean }> {
  const seen = (await store.get<string[]>(key)) ?? [];
  const hadBaseline = seen.length > 0;
  if (seen.includes(token)) {
    return { novel: false, hadBaseline };
  }

  const next = [...seen.slice(-255), token];
  await store.set(key, next, ttlMs);

  return { novel: true, hadBaseline };
}

function updateFrequency(stats: FrequencyStats | undefined, nowMs: number): {
  next: FrequencyStats;
  zScore: number;
} {
  if (!stats || stats.lastTs === 0) {
    return {
      next: {
        count: 0,
        meanDeltaMs: 0,
        m2: 0,
        lastTs: nowMs
      },
      zScore: 0
    };
  }

  const delta = Math.max(1, nowMs - stats.lastTs);
  let zScore = 0;

  if (stats.count >= 2) {
    const variance = stats.m2 / Math.max(1, stats.count - 1);
    const std = Math.sqrt(Math.max(1, variance));
    zScore = (stats.meanDeltaMs - delta) / std;
  }

  const count = stats.count + 1;
  const mean = stats.meanDeltaMs + (delta - stats.meanDeltaMs) / count;
  const m2 = stats.m2 + (delta - stats.meanDeltaMs) * (delta - mean);

  return {
    next: {
      count,
      meanDeltaMs: mean,
      m2,
      lastTs: nowMs
    },
    zScore
  };
}

function metricValue(metric: AnomalyMetric, signals: AnomalySignals): number {
  switch (metric) {
    case "frequency_zscore":
      return signals.frequencyZScore;
    case "burst":
      return signals.burstCount;
    case "novel_tool":
      return signals.novelTool ? 1 : 0;
    case "novel_domain":
      return signals.novelDomain ? 1 : 0;
    case "novel_template":
      return signals.novelTemplate ? 1 : 0;
    case "arg_shape_drift":
      return signals.argShapeDrift ? 1 : 0;
    default:
      return 0;
  }
}

function defaultThreshold(metric: AnomalyMetric): number {
  if (metric === "frequency_zscore") return 3;
  if (metric === "burst") return 5;
  return 1;
}

export async function scoreAnomaly(
  event: NormalizedToolEvent,
  policy: CompiledPolicy,
  store: StateStore,
  configPatch: Partial<AnomalyConfig> = {}
): Promise<AnomalyResult> {
  const config = { ...defaultConfig, ...configPatch };
  const scope = `${event.actorId}:${event.sessionId}`;
  const reasons: string[] = [];
  const signals: AnomalySignals = {
    frequencyZScore: 0,
    burstCount: 0,
    novelTool: false,
    novelDomain: false,
    novelTemplate: false,
    argShapeDrift: false
  };

  let score = 0;

  const freqKey = `freq:${scope}:${event.toolName}`;
  const freqStats = await store.get<FrequencyStats>(freqKey);
  const freq = updateFrequency(freqStats, event.epochMs);
  signals.frequencyZScore = freq.zScore;
  await store.set(freqKey, freq.next, 90 * DAY_MS);

  if (signals.frequencyZScore >= config.zScoreHigh) {
    score += 0.35;
    reasons.push(`frequency z-score ${signals.frequencyZScore.toFixed(2)} exceeded high threshold`);
  } else if (signals.frequencyZScore >= config.zScoreMedium) {
    score += 0.2;
    reasons.push(`frequency z-score ${signals.frequencyZScore.toFixed(2)} exceeded medium threshold`);
  }

  const burstKey = `burst:${scope}`;
  const burstWindow = (await store.get<number[]>(burstKey)) ?? [];
  const minAllowed = event.epochMs - config.burstWindowMs;
  const pruned = burstWindow.filter((ts) => ts >= minAllowed);
  pruned.push(event.epochMs);
  signals.burstCount = pruned.length;
  await store.set(burstKey, pruned, config.burstWindowMs * 2);

  if (signals.burstCount >= config.burstHighCount) {
    score += 0.35;
    reasons.push(`burst count ${signals.burstCount} exceeded high threshold`);
  } else if (signals.burstCount >= config.burstMediumCount) {
    score += 0.2;
    reasons.push(`burst count ${signals.burstCount} exceeded medium threshold`);
  }

  const toolNovelty = await markNovel(
    store,
    `seen:tool:${scope}`,
    hashString(event.toolName.toLowerCase()),
    90 * DAY_MS
  );
  signals.novelTool = toolNovelty.novel && toolNovelty.hadBaseline;
  if (signals.novelTool) {
    score += 0.1;
    reasons.push("first-seen tool for this actor/session baseline");
  }

  if (event.destinationDomain) {
    const domainNovelty = await markNovel(
      store,
      `seen:domain:${scope}`,
      hashString(event.destinationDomain),
      90 * DAY_MS
    );
    signals.novelDomain = domainNovelty.novel && domainNovelty.hadBaseline;
    if (signals.novelDomain) {
      score += 0.1;
      reasons.push("first-seen destination domain");
    }
  }

  const templateNovelty = await markNovel(
    store,
    `seen:template:${scope}`,
    hashString(event.actionTemplate),
    60 * DAY_MS
  );
  signals.novelTemplate = templateNovelty.novel && templateNovelty.hadBaseline;
  if (signals.novelTemplate) {
    score += 0.08;
    reasons.push("new action template observed");
  }

  const shapeNovelty = await markNovel(
    store,
    `seen:arg-shape:${scope}:${event.toolName}`,
    hashString(event.argShapeSignature),
    60 * DAY_MS
  );
  signals.argShapeDrift = shapeNovelty.novel && shapeNovelty.hadBaseline;
  if (signals.argShapeDrift) {
    score += 0.15;
    reasons.push("argument shape drift from known baseline");
  }

  const triggeredRules: AnomalyRuleTrigger[] = [];
  let policySuggestedAction: Decision = "allow";

  for (const rule of policy.anomalyRules) {
    const observed = metricValue(rule.metric, signals);
    const threshold = rule.threshold ?? defaultThreshold(rule.metric);

    if (observed < threshold) continue;

    triggeredRules.push({
      id: rule.id,
      metric: rule.metric,
      observed,
      threshold,
      action: rule.action
    });

    const weight = rule.weight ?? (rule.action === "block" ? 0.35 : 0.2);
    score += weight;
    policySuggestedAction = maxDecision(policySuggestedAction, rule.action);

    if (rule.why) reasons.push(rule.why);
  }

  const boundedScore = Math.min(1, score);

  let scoreDecision: Decision = "allow";
  if (boundedScore >= config.blockScore) {
    scoreDecision = "block";
  } else if (boundedScore >= config.requireApprovalScore) {
    scoreDecision = "require_approval";
  }

  return {
    score: boundedScore,
    proposedAction: maxDecision(scoreDecision, policySuggestedAction),
    signals,
    reasons,
    triggeredRules
  };
}

export function getDefaultAnomalyConfig(): AnomalyConfig {
  return { ...defaultConfig };
}
