import crypto from 'node:crypto';

export function hashEvent(evt) {
  const s = JSON.stringify(evt);
  const h = crypto.createHash('sha256').update(s).digest('hex');
  return `sha256:${h}`;
}

export function loadRulepack(obj) {
  if (!obj || obj.version !== 1 || !Array.isArray(obj.rules)) {
    throw new Error('Invalid rulepack (expected {version:1,rules:[...]})');
  }
  return obj;
}

export function evalEvent(evt, rulepack) {
  const findings = [];
  const text = String(evt?.text ?? '');
  for (const rule of rulepack.rules) {
    const m = rule.match;
    if (!m) continue;
    if (m.type === 'regex') {
      const re = new RegExp(m.pattern, m.flags ?? 'i');
      if (re.test(text)) {
        findings.push({
          event_id: hashEvent(evt),
          severity: rule.severity ?? 'med',
          category: rule.category ?? 'other',
          title: rule.title ?? rule.id,
          why: rule.why ?? 'Matched rule',
          suggestion: rule.suggestion ?? '',
          rule_id: rule.id,
          confidence: rule.confidence ?? 0.7,
        });
      }
    }
  }
  return findings;
}
