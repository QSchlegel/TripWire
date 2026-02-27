#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { createGuard } from "../core/guard.js";
import { InMemoryStore } from "../anomaly/store.js";
import { compilePolicy } from "../policy/compiler.js";
import type { CompiledPolicy, GuardDecisionResult, ToolCallContext } from "../types/index.js";
import { migrateRolepackJsonToPolicyMarkdown } from "../tools/migrate-rolepack.js";

interface EvalRecord {
  index: number;
  result: GuardDecisionResult;
}

function usage(exitCode = 0): never {
  const text = [
    "TripWire CLI",
    "",
    "Commands:",
    "  tripwire policy compile --in policy.policy.md --out policy.json",
    "  tripwire policy migrate --in rolepack.json --out policy.policy.md",
    "  tripwire eval --policy policy.policy.md --in events.jsonl [--out results.jsonl]",
    "  tripwire replay --policy policy.policy.md --in events.jsonl --report report.json"
  ].join("\n");

  process.stdout.write(`${text}\n`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
      continue;
    }

    out[key] = next;
    i += 1;
  }

  return out;
}

async function loadCompiledPolicy(path: string): Promise<CompiledPolicy> {
  const raw = await readFile(path, "utf8");

  if (path.endsWith(".json")) {
    return JSON.parse(raw) as CompiledPolicy;
  }

  return compilePolicy(raw);
}

async function readJsonl(path: string): Promise<unknown[]> {
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function asContext(input: unknown): ToolCallContext {
  const row = (input ?? {}) as Record<string, unknown>;
  const metadata = typeof row.meta === "object" ? (row.meta as Record<string, unknown>) : undefined;

  return {
    ts: typeof row.ts === "string" ? row.ts : undefined,
    sessionId: typeof row.session === "string" ? row.session : undefined,
    actorId:
      row.actor && typeof row.actor === "object" && typeof (row.actor as Record<string, unknown>).id === "string"
        ? String((row.actor as Record<string, unknown>).id)
        : undefined,
    actorType:
      row.actor && typeof row.actor === "object" && typeof (row.actor as Record<string, unknown>).type === "string"
        ? String((row.actor as Record<string, unknown>).type)
        : undefined,
    toolName:
      typeof row.toolName === "string"
        ? row.toolName
        : typeof row.tool === "string"
          ? row.tool
          : "unknown",
    text: typeof row.text === "string" ? row.text : undefined,
    intent: typeof row.intent === "string" ? row.intent : undefined,
    args: row.args,
    destination:
      row.destination && typeof row.destination === "object"
        ? {
            domain:
              typeof (row.destination as Record<string, unknown>).domain === "string"
                ? String((row.destination as Record<string, unknown>).domain)
                : undefined,
            url:
              typeof (row.destination as Record<string, unknown>).url === "string"
                ? String((row.destination as Record<string, unknown>).url)
                : undefined
          }
        : undefined,
    metadata
  };
}

async function evaluateEvents(policy: CompiledPolicy, events: unknown[]): Promise<EvalRecord[]> {
  const guard = createGuard({
    policy,
    store: new InMemoryStore()
  });

  const results: EvalRecord[] = [];

  for (let i = 0; i < events.length; i += 1) {
    const context = asContext(events[i]);
    const result = await guard.beforeToolCall(context);
    results.push({ index: i, result });
  }

  return results;
}

function makeReplayReport(policy: CompiledPolicy, evaluations: EvalRecord[]) {
  const totals = {
    events: evaluations.length,
    allow: 0,
    require_approval: 0,
    block: 0
  };

  const findingsByCategory: Record<string, number> = {};
  const topRules: Record<string, number> = {};
  const anomalyScores: number[] = [];

  for (const entry of evaluations) {
    totals[entry.result.decision] += 1;
    anomalyScores.push(entry.result.anomaly.score);

    for (const finding of entry.result.findings) {
      findingsByCategory[finding.category] = (findingsByCategory[finding.category] ?? 0) + 1;
      topRules[finding.ruleId] = (topRules[finding.ruleId] ?? 0) + 1;
    }
  }

  const topRuleEntries = Object.entries(topRules)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ruleId, hits]) => ({ ruleId, hits }));

  const averageScore =
    anomalyScores.length === 0 ? 0 : anomalyScores.reduce((sum, value) => sum + value, 0) / anomalyScores.length;

  return {
    policyId: policy.id,
    totals,
    findingsByCategory,
    topRules: topRuleEntries,
    anomaly: {
      averageScore: Number(averageScore.toFixed(4)),
      maxScore: Number(Math.max(0, ...anomalyScores).toFixed(4)),
      escalatedDecisions: evaluations.filter((entry) => entry.result.escalatedByAnomaly).length
    }
  };
}

async function main(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);
  if (!command || command === "-h" || command === "--help") usage(0);

  if (command === "policy") {
    const args = parseArgs(rest);

    if (subcommand === "compile") {
      if (!args.in || !args.out) usage(1);
      const markdown = await readFile(args.in, "utf8");
      const compiled = compilePolicy(markdown);
      await writeFile(args.out, `${JSON.stringify(compiled, null, 2)}\n`, "utf8");
      return;
    }

    if (subcommand === "migrate") {
      if (!args.in || !args.out) usage(1);
      const raw = JSON.parse(await readFile(args.in, "utf8")) as Record<string, unknown>;
      const markdown = migrateRolepackJsonToPolicyMarkdown(raw);
      await writeFile(args.out, `${markdown.trimEnd()}\n`, "utf8");
      return;
    }

    usage(1);
  }

  if (command === "eval") {
    const args = parseArgs([subcommand, ...rest].filter(Boolean));
    if (!args.policy || !args.in) usage(1);

    const policy = await loadCompiledPolicy(args.policy);
    const events = await readJsonl(args.in);
    const results = await evaluateEvents(policy, events);

    const output = results.map((entry) => JSON.stringify(entry)).join("\n");

    if (args.out) {
      await writeFile(args.out, `${output}${output ? "\n" : ""}`, "utf8");
      return;
    }

    process.stdout.write(`${output}${output ? "\n" : ""}`);
    return;
  }

  if (command === "replay") {
    const args = parseArgs([subcommand, ...rest].filter(Boolean));
    if (!args.policy || !args.in) usage(1);

    const policy = await loadCompiledPolicy(args.policy);
    const events = await readJsonl(args.in);
    const results = await evaluateEvents(policy, events);
    const report = makeReplayReport(policy, results);

    if (!args.report) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    await writeFile(args.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return;
  }

  usage(1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
