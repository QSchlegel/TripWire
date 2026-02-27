import type {
  CompiledPolicy,
  Decision,
  Finding,
  NormalizedToolEvent,
  RegexMatcher,
  RuleMatch
} from "../types/index.js";
import { getByPath } from "../utils/path.js";
import { severityToDecision } from "./decision.js";

function toRegex(input: RegexMatcher): RegExp {
  return new RegExp(input.regex, input.flags ?? "i");
}

function asArray(value?: string | string[]): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function resolveAction(severityAction: Decision | undefined, fallbackSeverity: Decision): Decision {
  return severityAction ?? fallbackSeverity;
}

function matchesText(text: string, matcher?: RegexMatcher): boolean {
  if (!matcher) return true;
  return toRegex(matcher).test(text);
}

function matchesIntent(intent: string, matcher?: RegexMatcher): boolean {
  if (!matcher) return true;
  return toRegex(matcher).test(intent);
}

function matchesTool(toolName: string, matcher?: string | string[]): boolean {
  if (!matcher) return true;
  const allowed = asArray(matcher).map((item) => item.toLowerCase());
  return allowed.includes(toolName.toLowerCase());
}

function matchesArg(args: unknown, matcher: RuleMatch["arg"]): boolean {
  if (!matcher) return true;

  const value = getByPath(args, matcher.path);

  if (matcher.eq !== undefined) {
    return value === matcher.eq;
  }

  if (matcher.regex) {
    const re = new RegExp(matcher.regex, matcher.flags ?? "i");
    return re.test(String(value ?? ""));
  }

  return value !== undefined;
}

function matchesDestination(domain: string | undefined, matcher: RuleMatch["destination"]): boolean {
  if (!matcher?.domain) return true;

  const expected = asArray(matcher.domain).map((item) => item.toLowerCase());
  if (!domain) return false;

  return expected.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`));
}

function matchedKeys(event: NormalizedToolEvent, match: RuleMatch): string[] {
  const keys: string[] = [];

  if (match.tool && matchesTool(event.toolName, match.tool)) keys.push("tool");
  if (match.text && matchesText(event.text, match.text)) keys.push("text");
  if (match.intent && matchesIntent(event.intent, match.intent)) keys.push("intent");
  if (match.arg && matchesArg(event.args, match.arg)) keys.push(`arg:${match.arg.path}`);
  if (match.destination && matchesDestination(event.destinationDomain, match.destination)) keys.push("destination");

  return keys;
}

export function evaluatePolicy(event: NormalizedToolEvent, policy: CompiledPolicy): Finding[] {
  const findings: Finding[] = [];

  for (const rule of policy.rules) {
    const match = rule.match;

    const criteriaPass =
      matchesTool(event.toolName, match.tool) &&
      matchesText(event.text, match.text) &&
      matchesIntent(event.intent, match.intent) &&
      matchesArg(event.args, match.arg) &&
      matchesDestination(event.destinationDomain, match.destination);

    if (!criteriaPass) continue;

    const fallbackDecision = severityToDecision(rule.severity);
    const findingAction = resolveAction(rule.action, fallbackDecision);

    findings.push({
      eventId: event.eventId,
      ruleId: rule.id,
      title: rule.title ?? rule.id,
      category: rule.category,
      severity: rule.severity,
      action: findingAction,
      confidence: rule.confidence ?? policy.defaults.confidence ?? 0.75,
      why: rule.why,
      suggestion: rule.suggestion,
      matchedOn: matchedKeys(event, match)
    });
  }

  return findings;
}
