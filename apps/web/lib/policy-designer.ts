import { compilePolicy } from "@twire/guard";

export type DesignerDecision = "allow" | "require_approval" | "block";
export type DesignerSeverity = "low" | "med" | "high";
export type DesignerMode = "monitor" | "enforce";
export type DesignerMetric =
  | "frequency_zscore"
  | "burst"
  | "novel_tool"
  | "novel_domain"
  | "novel_template"
  | "arg_shape_drift";

export interface DesignerRule {
  id: string;
  title: string;
  category: string;
  severity: DesignerSeverity;
  action: DesignerDecision;
  confidence: string;
  why: string;
  suggestion: string;
  toolCsv: string;
  textRegex: string;
  textFlags: string;
}

export interface DesignerAnomaly {
  id: string;
  metric: DesignerMetric;
  threshold: string;
  windowMs: string;
  action: DesignerDecision;
  weight: string;
  why: string;
}

export interface DesignerState {
  id: string;
  version: string;
  mode: DesignerMode;
  tagsCsv: string;
  defaultAction: DesignerDecision;
  defaultSeverity: DesignerSeverity;
  defaultConfidence: string;
  rules: DesignerRule[];
  anomalies: DesignerAnomaly[];
}

export const DESIGNER_ACTIONS: DesignerDecision[] = ["allow", "require_approval", "block"];
export const DESIGNER_SEVERITIES: DesignerSeverity[] = ["low", "med", "high"];
export const DESIGNER_MODES: DesignerMode[] = ["enforce", "monitor"];
export const DESIGNER_METRICS: DesignerMetric[] = [
  "frequency_zscore",
  "burst",
  "novel_tool",
  "novel_domain",
  "novel_template",
  "arg_shape_drift"
];

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseNumber(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function policyTitleFromId(policyId: string): string {
  const leaf = policyId.split(".").filter(Boolean).pop() ?? "policy";
  return leaf
    .split(/[_-]+/)
    .filter(Boolean)
    .map((token) => token[0]?.toUpperCase() + token.slice(1))
    .join(" ");
}

export function createDefaultRule(id = "rule.new"): DesignerRule {
  return {
    id,
    title: "",
    category: "external_side_effect",
    severity: "med",
    action: "require_approval",
    confidence: "",
    why: "Explain why this rule exists.",
    suggestion: "Describe a safe alternative.",
    toolCsv: "exec",
    textRegex: ".+",
    textFlags: ""
  };
}

export function createDefaultAnomaly(id = "anomaly.new"): DesignerAnomaly {
  return {
    id,
    metric: "burst",
    threshold: "4",
    windowMs: "20000",
    action: "require_approval",
    weight: "0.25",
    why: "Burst activity may indicate runaway automation."
  };
}

export function createDefaultDesignerState(): DesignerState {
  return {
    id: "tripwire.custom",
    version: "1",
    mode: "enforce",
    tagsCsv: "simulator, custom",
    defaultAction: "block",
    defaultSeverity: "low",
    defaultConfidence: "0.8",
    rules: [createDefaultRule("rule.custom.1")],
    anomalies: [createDefaultAnomaly("anomaly.custom.1")]
  };
}

export function policyToDesignerState(policyText: string): DesignerState {
  const compiled = compilePolicy(policyText);

  return {
    id: compiled.id,
    version: String(compiled.version),
    mode: compiled.mode,
    tagsCsv: compiled.tags.join(", "),
    defaultAction: (compiled.defaults.action ?? "block") as DesignerDecision,
    defaultSeverity: (compiled.defaults.severity ?? "low") as DesignerSeverity,
    defaultConfidence:
      typeof compiled.defaults.confidence === "number" ? String(compiled.defaults.confidence) : "",
    rules: compiled.rules.map((rule) => ({
      id: rule.id,
      title: rule.title ?? "",
      category: rule.category,
      severity: rule.severity,
      action: (rule.action ?? "require_approval") as DesignerDecision,
      confidence: typeof rule.confidence === "number" ? String(rule.confidence) : "",
      why: rule.why,
      suggestion: rule.suggestion,
      toolCsv: Array.isArray(rule.match.tool)
        ? rule.match.tool.join(", ")
        : typeof rule.match.tool === "string"
          ? rule.match.tool
          : "",
      textRegex: rule.match.text?.regex ?? "",
      textFlags: rule.match.text?.flags ?? ""
    })),
    anomalies: compiled.anomalyRules.map((rule) => ({
      id: rule.id,
      metric: rule.metric,
      threshold: typeof rule.threshold === "number" ? String(rule.threshold) : "",
      windowMs: typeof rule.windowMs === "number" ? String(rule.windowMs) : "",
      action: rule.action as DesignerDecision,
      weight: typeof rule.weight === "number" ? String(rule.weight) : "",
      why: rule.why ?? ""
    }))
  };
}

function buildRuleBlock(rule: DesignerRule, index: number): string {
  const id = rule.id.trim() || `rule.custom.${index + 1}`;
  const title = rule.title.trim();
  const category = rule.category.trim() || "external_side_effect";
  const severity = rule.severity;
  const action = rule.action;
  const confidence = parseNumber(rule.confidence);
  const why = rule.why.trim() || "Explain why this rule exists.";
  const suggestion = rule.suggestion.trim() || "Describe a safe alternative.";
  const tools = parseCsv(rule.toolCsv);
  const regex = rule.textRegex.trim();
  const flags = rule.textFlags.trim();

  const scopedTools = tools.length > 0 ? tools : ["exec"];
  const scopedRegex = regex.length > 0 ? regex : ".+";

  const lines = [
    "```rule",
    `id: ${yamlString(id)}`,
    ...(title ? [`title: ${yamlString(title)}`] : []),
    `category: ${yamlString(category)}`,
    `severity: ${yamlString(severity)}`,
    `action: ${yamlString(action)}`,
    ...(confidence !== undefined ? [`confidence: ${confidence}`] : []),
    `why: ${yamlString(why)}`,
    `suggestion: ${yamlString(suggestion)}`,
    "match:",
    "  tool:",
    ...scopedTools.map((tool) => `    - ${yamlString(tool)}`),
    "  text:",
    `    regex: ${yamlString(scopedRegex)}`,
    ...(flags ? [`    flags: ${yamlString(flags)}`] : []),
    "```"
  ];

  return lines.join("\n");
}

function buildAnomalyBlock(rule: DesignerAnomaly, index: number): string {
  const id = rule.id.trim() || `anomaly.custom.${index + 1}`;
  const metric = rule.metric;
  const threshold = parseNumber(rule.threshold);
  const windowMs = parseNumber(rule.windowMs);
  const action = rule.action;
  const weight = parseNumber(rule.weight);
  const why = rule.why.trim();

  const lines = [
    "```anomaly",
    `id: ${yamlString(id)}`,
    `metric: ${yamlString(metric)}`,
    ...(threshold !== undefined ? [`threshold: ${threshold}`] : []),
    ...(windowMs !== undefined ? [`windowMs: ${windowMs}`] : []),
    `action: ${yamlString(action)}`,
    ...(weight !== undefined ? [`weight: ${weight}`] : []),
    ...(why ? [`why: ${yamlString(why)}`] : []),
    "```"
  ];

  return lines.join("\n");
}

export function designerStateToPolicy(state: DesignerState): string {
  const policyId = state.id.trim() || "tripwire.custom";
  const version = Math.max(1, Math.trunc(parseNumber(state.version) ?? 1));
  const mode = state.mode;
  const tags = parseCsv(state.tagsCsv);
  const defaultConfidence = parseNumber(state.defaultConfidence);
  const title = policyTitleFromId(policyId);

  const frontmatterLines: string[] = [
    "---",
    `id: ${yamlString(policyId)}`,
    `version: ${version}`,
    `mode: ${yamlString(mode)}`,
    "defaults:",
    `  action: ${yamlString(state.defaultAction)}`,
    `  severity: ${yamlString(state.defaultSeverity)}`
  ];

  if (defaultConfidence !== undefined) {
    frontmatterLines.push(`  confidence: ${defaultConfidence}`);
  }

  if (tags.length === 0) {
    frontmatterLines.push("tags: []");
  } else {
    frontmatterLines.push("tags:");
    frontmatterLines.push(...tags.map((tag) => `  - ${yamlString(tag)}`));
  }

  frontmatterLines.push("---");

  const rules = (state.rules.length > 0 ? state.rules : [createDefaultRule("rule.custom.1")]).map(
    buildRuleBlock
  );
  const anomalies = state.anomalies.map(buildAnomalyBlock);

  return [...frontmatterLines, "", `# ${title} Policy`, "", ...rules, ...anomalies].join("\n\n");
}
