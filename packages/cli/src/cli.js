#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRulepack, evalEvent } from '@tripwire/core';

function usage(code = 0) {
  console.log(`tripwire eval --rules rules.json --in events.jsonl [--out findings.jsonl]`);
  process.exit(code);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function* readJsonl(p) {
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    yield JSON.parse(line);
  }
}

const args = process.argv.slice(2);
if (args.length === 0) usage(1);

const cmd = args[0];
if (cmd !== 'eval') usage(1);

let rulesPath, inPath, outPath;
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === '--rules') rulesPath = args[++i];
  else if (a === '--in') inPath = args[++i];
  else if (a === '--out') outPath = args[++i];
  else if (a === '-h' || a === '--help') usage(0);
}

if (!rulesPath || !inPath) usage(1);

const rp = loadRulepack(readJson(rulesPath));
const out = [];
for (const evt of readJsonl(inPath)) {
  out.push(...evalEvent(evt, rp));
}

if (outPath) {
  fs.writeFileSync(outPath, out.map(x => JSON.stringify(x)).join('\n') + (out.length ? '\n' : ''), 'utf8');
} else {
  for (const f of out) console.log(JSON.stringify(f));
}
