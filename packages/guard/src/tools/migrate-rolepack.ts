import yaml from "js-yaml";
import type { Decision, Severity } from "../types/index.js";

interface LegacyRule {
  id: string;
  title?: string;
  category?: string;
  severity?: Severity;
  why?: string;
  suggestion?: string;
  confidence?: number;
  match?: {
    type?: string;
    pattern?: string;
    flags?: string;
  };
}

interface LegacyRolepack {
  version?: number;
  name?: string;
  description?: string;
  rules?: LegacyRule[];
}

function toAction(severity: Severity | undefined): Decision {
  if (severity === "high") return "block";
  if (severity === "med") return "require_approval";
  return "allow";
}

export function migrateRolepackJsonToPolicyMarkdown(raw: LegacyRolepack): string {
  const policyId = raw.name ? `tripwire.${raw.name}` : "tripwire.migrated";

  const frontmatter = yaml.dump(
    {
      id: policyId,
      version: typeof raw.version === "number" ? raw.version : 1,
      mode: "enforce",
      defaults: {
        action: "allow",
        severity: "low",
        confidence: 0.75
      },
      tags: raw.name ? [raw.name, "migrated"] : ["migrated"]
    },
    { lineWidth: 1000 }
  );

  const ruleBlocks = (raw.rules ?? []).map((rule) => {
    const content = {
      id: rule.id,
      title: rule.title,
      category: rule.category ?? "other",
      severity: rule.severity ?? "med",
      action: toAction(rule.severity),
      confidence: rule.confidence,
      why: rule.why ?? "Migrated from legacy rolepack",
      suggestion: rule.suggestion ?? "Review and tune this migrated rule",
      match: {
        text: {
          regex: rule.match?.pattern ?? ".*",
          flags: rule.match?.flags ?? "i"
        }
      }
    };

    return `\n\`\`\`rule\n${yaml.dump(content, { lineWidth: 1000 }).trimEnd()}\n\`\`\``;
  });

  const anomalyDefaults = [
    {
      id: "anomaly.burst.medium",
      metric: "burst",
      threshold: 4,
      windowMs: 20000,
      action: "require_approval",
      weight: 0.2,
      why: "Unexpected rapid tool call burst"
    },
    {
      id: "anomaly.frequency.high",
      metric: "frequency_zscore",
      threshold: 4,
      action: "block",
      weight: 0.35,
      why: "Tool call cadence is far outside baseline"
    }
  ].map((anomaly) => `\n\`\`\`anomaly\n${yaml.dump(anomaly, { lineWidth: 1000 }).trimEnd()}\n\`\`\``);

  return `---\n${frontmatter.trimEnd()}\n---\n\n# ${policyId}\n\n${raw.description ?? "Migrated TripWire policy"}\n${[...ruleBlocks, ...anomalyDefaults].join("\n")}`;
}
