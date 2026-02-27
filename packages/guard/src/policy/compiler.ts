import yaml from "js-yaml";
import type {
  AnomalyMetric,
  CompiledPolicy,
  Decision,
  PolicyAnomalyRule,
  PolicyDefaults,
  PolicyMode,
  PolicyRule,
  RuleMatch,
  Severity
} from "../types/index.js";
import { PolicyCompileError } from "./errors.js";

const NON_DOWNGRADABLE_CATEGORIES = new Set(["secrets", "wallet", "irreversible"]);

interface ParsedBlock {
  type: "rule" | "anomaly";
  content: string;
  offset: number;
}

function locate(text: string, offset: number): { line: number; column: number } {
  const snippet = text.slice(0, offset);
  const lines = snippet.split(/\r?\n/);
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column };
}

function fail(message: string, code: string, text: string, offset: number): never {
  const pos = locate(text, offset);
  throw new PolicyCompileError(message, code, pos.line, pos.column);
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function extractFrontmatter(markdown: string): { frontmatter: string; body: string } {
  if (!markdown.startsWith("---\n")) {
    fail(
      "Policy must start with YAML frontmatter fenced by ---",
      "frontmatter_missing",
      markdown,
      0
    );
  }

  const closing = markdown.indexOf("\n---\n", 4);
  const trailing = markdown.indexOf("\n---", 4);
  const closeIdx = closing >= 0 ? closing : trailing;

  if (closeIdx < 0) {
    fail("Frontmatter is not closed with ---", "frontmatter_unclosed", markdown, 0);
  }

  const fm = markdown.slice(4, closeIdx);
  const body = markdown.slice(closeIdx + 5);

  return { frontmatter: fm, body };
}

function parseBlocks(body: string, original: string, bodyOffset: number): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const regex = /```(rule|anomaly)\s*\n([\s\S]*?)```/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(body))) {
    const type = match[1] as "rule" | "anomaly";
    const content = match[2] ?? "";
    const offset = bodyOffset + match.index;
    blocks.push({ type, content, offset });
  }

  if (blocks.length === 0) {
    fail("Policy must contain at least one ```rule``` block", "rule_missing", original, bodyOffset);
  }

  return blocks;
}

function asSeverity(value: unknown, markdown: string, offset: number): Severity {
  if (value === "low" || value === "med" || value === "high") return value;
  fail("Rule severity must be one of low|med|high", "rule_severity_invalid", markdown, offset);
}

function asAction(value: unknown, markdown: string, offset: number): Decision {
  if (value === "allow" || value === "require_approval" || value === "block") return value;
  fail(
    "Rule action must be one of allow|require_approval|block",
    "rule_action_invalid",
    markdown,
    offset
  );
}

function asMetric(value: unknown, markdown: string, offset: number): AnomalyMetric {
  if (
    value === "frequency_zscore" ||
    value === "burst" ||
    value === "novel_tool" ||
    value === "novel_domain" ||
    value === "novel_template" ||
    value === "arg_shape_drift"
  ) {
    return value;
  }

  fail(
    "Anomaly metric must be frequency_zscore|burst|novel_tool|novel_domain|novel_template|arg_shape_drift",
    "anomaly_metric_invalid",
    markdown,
    offset
  );
}

function validateRegex(value: Record<string, unknown>, markdown: string, offset: number): {
  regex: string;
  flags?: string;
} {
  const regex = value.regex;
  const flags = value.flags;

  if (typeof regex !== "string" || regex.length === 0) {
    fail("Regex matcher requires a non-empty regex field", "regex_missing", markdown, offset);
  }

  if (flags !== undefined && typeof flags !== "string") {
    fail("Regex flags must be a string", "regex_flags_invalid", markdown, offset);
  }

  try {
    // Ensure deterministic compile-time failures for invalid expressions.
    void new RegExp(regex, flags);
  } catch {
    fail(`Invalid regular expression: ${regex}`, "regex_invalid", markdown, offset);
  }

  return { regex, flags };
}

function parseMatch(raw: unknown, markdown: string, offset: number): RuleMatch {
  const input = asObject(raw);
  const match: RuleMatch = {};

  if (typeof input.tool === "string" || Array.isArray(input.tool)) {
    match.tool = input.tool as string | string[];
  }

  if (input.text) {
    if (typeof input.text === "string") {
      match.text = validateRegex({ regex: input.text }, markdown, offset);
    } else {
      match.text = validateRegex(asObject(input.text), markdown, offset);
    }
  }

  if (input.intent) {
    if (typeof input.intent === "string") {
      match.intent = validateRegex({ regex: input.intent }, markdown, offset);
    } else {
      match.intent = validateRegex(asObject(input.intent), markdown, offset);
    }
  }

  if (input.arg) {
    const arg = asObject(input.arg);

    if (typeof arg.path !== "string" || arg.path.length === 0) {
      fail("arg matcher requires a non-empty path", "arg_path_missing", markdown, offset);
    }

    const parsedArg: RuleMatch["arg"] = { path: arg.path };

    if (arg.eq !== undefined) parsedArg.eq = arg.eq;

    if (arg.regex !== undefined) {
      if (typeof arg.regex !== "string") {
        fail("arg.regex must be a string", "arg_regex_invalid", markdown, offset);
      }
      parsedArg.regex = arg.regex;
      if (arg.flags !== undefined) {
        if (typeof arg.flags !== "string") {
          fail("arg.flags must be a string", "arg_flags_invalid", markdown, offset);
        }
        parsedArg.flags = arg.flags;
      }

      try {
        void new RegExp(parsedArg.regex, parsedArg.flags);
      } catch {
        fail("arg.regex is not a valid regular expression", "arg_regex_compile_error", markdown, offset);
      }
    }

    match.arg = parsedArg;
  }

  if (input.destination) {
    const destination = asObject(input.destination);
    if (typeof destination.domain !== "string" && !Array.isArray(destination.domain)) {
      fail(
        "destination matcher requires domain as string or string[]",
        "destination_domain_invalid",
        markdown,
        offset
      );
    }

    match.destination = { domain: destination.domain as string | string[] };
  }

  if (!match.tool && !match.text && !match.intent && !match.arg && !match.destination) {
    fail("rule match must include at least one matcher", "rule_match_empty", markdown, offset);
  }

  return match;
}

function ensureNoUnsafeBroadAllow(rule: PolicyRule, markdown: string, offset: number): void {
  if (rule.action !== "allow") return;

  const textRegex = rule.match.text?.regex?.trim();
  const isBroad = textRegex === ".*" || textRegex === "^.*$" || textRegex === "[\\s\\S]*";
  if (!isBroad) return;

  const hasScope = Boolean(rule.match.tool || rule.match.arg || rule.match.destination || rule.match.intent);
  if (hasScope) return;

  fail(
    "Broad allow regex patterns require scoped constraints (tool/arg/destination/intent)",
    "broad_allow_unsafe",
    markdown,
    offset
  );
}

function parseRule(block: ParsedBlock, markdown: string): PolicyRule {
  let raw: unknown;
  try {
    raw = yaml.load(block.content);
  } catch {
    fail("Failed to parse rule block YAML", "rule_yaml_invalid", markdown, block.offset);
  }

  const input = asObject(raw);

  if (typeof input.id !== "string" || input.id.length === 0) {
    fail("Rule requires id", "rule_id_missing", markdown, block.offset);
  }

  if (typeof input.category !== "string" || input.category.length === 0) {
    fail("Rule requires category", "rule_category_missing", markdown, block.offset);
  }

  if (typeof input.why !== "string" || input.why.length === 0) {
    fail("Rule requires why", "rule_why_missing", markdown, block.offset);
  }

  if (typeof input.suggestion !== "string" || input.suggestion.length === 0) {
    fail("Rule requires suggestion", "rule_suggestion_missing", markdown, block.offset);
  }

  const severity = asSeverity(input.severity, markdown, block.offset);
  const action = asAction(input.action, markdown, block.offset);

  const rule: PolicyRule = {
    id: input.id,
    title: typeof input.title === "string" ? input.title : undefined,
    category: input.category,
    severity,
    action,
    confidence: typeof input.confidence === "number" ? input.confidence : undefined,
    why: input.why,
    suggestion: input.suggestion,
    match: parseMatch(input.match, markdown, block.offset)
  };

  if (NON_DOWNGRADABLE_CATEGORIES.has(rule.category) && rule.action === "allow") {
    fail(
      `Category ${rule.category} cannot be downgraded to allow action`,
      "category_non_downgradable",
      markdown,
      block.offset
    );
  }

  ensureNoUnsafeBroadAllow(rule, markdown, block.offset);

  return rule;
}

function parseAnomaly(block: ParsedBlock, markdown: string): PolicyAnomalyRule {
  let raw: unknown;
  try {
    raw = yaml.load(block.content);
  } catch {
    fail("Failed to parse anomaly block YAML", "anomaly_yaml_invalid", markdown, block.offset);
  }

  const input = asObject(raw);

  if (typeof input.id !== "string" || input.id.length === 0) {
    fail("Anomaly rule requires id", "anomaly_id_missing", markdown, block.offset);
  }

  const metric = asMetric(input.metric, markdown, block.offset);
  const action = asAction(input.action, markdown, block.offset);

  if (NON_DOWNGRADABLE_CATEGORIES.has(String(input.category ?? "")) && action === "allow") {
    fail("Non-downgradable categories cannot use allow action", "anomaly_action_invalid", markdown, block.offset);
  }

  const anomalyRule: PolicyAnomalyRule = {
    id: input.id,
    metric,
    threshold: typeof input.threshold === "number" ? input.threshold : undefined,
    windowMs: typeof input.windowMs === "number" ? input.windowMs : undefined,
    action,
    weight: typeof input.weight === "number" ? input.weight : undefined,
    why: typeof input.why === "string" ? input.why : undefined
  };

  return anomalyRule;
}

function parseMode(value: unknown): PolicyMode {
  if (value === "monitor" || value === "enforce") return value;
  return "enforce";
}

function parseDefaults(value: unknown, markdown: string): PolicyDefaults {
  const defaultsInput = asObject(value);
  const defaults: PolicyDefaults = {};

  if (defaultsInput.severity !== undefined) {
    defaults.severity = asSeverity(defaultsInput.severity, markdown, 0);
  }

  if (defaultsInput.action !== undefined) {
    defaults.action = asAction(defaultsInput.action, markdown, 0);
  }

  if (defaultsInput.confidence !== undefined) {
    if (typeof defaultsInput.confidence !== "number") {
      fail("defaults.confidence must be a number", "defaults_confidence_invalid", markdown, 0);
    }
    defaults.confidence = defaultsInput.confidence;
  }

  return defaults;
}

export function compilePolicy(markdown: string): CompiledPolicy {
  const { frontmatter, body } = extractFrontmatter(markdown);

  let parsedFm: unknown;
  try {
    parsedFm = yaml.load(frontmatter);
  } catch {
    fail("Frontmatter YAML is invalid", "frontmatter_yaml_invalid", markdown, 0);
  }

  const fm = asObject(parsedFm);

  if (typeof fm.id !== "string" || fm.id.length === 0) {
    fail("Frontmatter requires id", "frontmatter_id_missing", markdown, 0);
  }

  if (typeof fm.version !== "number") {
    fail("Frontmatter requires numeric version", "frontmatter_version_missing", markdown, 0);
  }

  const bodyOffset = markdown.indexOf(body);
  const blocks = parseBlocks(body, markdown, bodyOffset);

  const rules: PolicyRule[] = [];
  const anomalyRules: PolicyAnomalyRule[] = [];

  for (const block of blocks) {
    if (block.type === "rule") {
      rules.push(parseRule(block, markdown));
    } else {
      anomalyRules.push(parseAnomaly(block, markdown));
    }
  }

  return {
    id: fm.id,
    version: fm.version,
    mode: parseMode(fm.mode),
    tags: Array.isArray(fm.tags) ? fm.tags.map((tag) => String(tag)) : [],
    defaults: parseDefaults(fm.defaults, markdown),
    rules,
    anomalyRules
  };
}

function isUrl(input: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(input);
}

async function tryReadLocalFile(path: string): Promise<string | undefined> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier);") as (
      specifier: string
    ) => Promise<{ readFile: (localPath: string, encoding: string) => Promise<string> }>;
    const fs = await dynamicImport("node:fs/promises");
    return await fs.readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

export async function loadPolicy(pathOrUrl: string): Promise<CompiledPolicy> {
  let markdown: string;

  if (isUrl(pathOrUrl)) {
    const response = await fetch(pathOrUrl);
    if (!response.ok) {
      throw new Error(`Failed to load policy from ${pathOrUrl}: ${response.status}`);
    }
    markdown = await response.text();
  } else {
    const local = await tryReadLocalFile(pathOrUrl);
    if (local !== undefined) {
      markdown = local;
    } else {
      const response = await fetch(pathOrUrl);
      if (!response.ok) {
        throw new Error(`Failed to load policy from ${pathOrUrl}: ${response.status}`);
      }
      markdown = await response.text();
    }
  }

  const compiled = compilePolicy(markdown);
  compiled.source = pathOrUrl;
  return compiled;
}
