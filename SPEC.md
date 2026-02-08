# Tripwire Spec (draft, MVP)

## 1) Input event (minimal)

Tripwire consumes **events** (JSON objects). Source can be agent runtime logs, tool-call logs, or message streams.

```json
{
  "ts": "2026-02-08T09:49:26.404Z",
  "source": "openclaw",
  "session": "agent:pm:main",
  "actor": {"type": "agent", "id": "CBHB-01"},
  "kind": "tool_call",
  "tool": "exec",
  "intent": "search repo for secrets",
  "text": "rg -n \"api_key\" -S .",
  "meta": {
    "risk": {"irreversible": false, "external": false, "cost": "low"}
  }
}
```

Required fields (MVP):
- `ts` (ISO string)
- `kind` (e.g. `message`, `tool_call`)
- `text` (natural language or command)

Optional fields:
- `tool`, `source`, `session`, `actor`, `meta`

## 2) Findings output

Tripwire outputs findings per event:

```json
{
  "event_id": "sha256:...",
  "severity": "low|med|high",
  "category": "secrets|irreversible|external_side_effect|high_cost|social_engineering",
  "title": "Possible secret exfiltration",
  "why": "Command searches for api_key and may print secrets to logs",
  "suggestion": "Search for key names only, redact output, or use a secret scanner that masks matches",
  "rule_id": "secrets.regex.api_key",
  "confidence": 0.8
}
```

## 3) Rules (rulepack)

MVP rule format (JSON):

```json
{
  "version": 1,
  "rules": [
    {
      "id": "secrets.regex.api_key",
      "severity": "high",
      "category": "secrets",
      "match": {"type": "regex", "pattern": "(api[_-]?key|secret|token|mnemonic)"},
      "why": "Text references credentials",
      "suggestion": "Avoid printing secrets; redact; use vault references"
    },
    {
      "id": "irreversible.rm",
      "severity": "high",
      "category": "irreversible",
      "match": {"type": "regex", "pattern": "\\brm\\b|\\bterraform apply\\b"},
      "why": "Potentially destructive action",
      "suggestion": "Use dry-run / trash / confirm targets"
    }
  ]
}
```

## 4) MVP command-line contract

- `tripwire eval --rules <rules.json> --in <events.jsonl> --out <findings.jsonl>`

## 5) Non-goals (MVP)
- LLM-based classification (later)
- Full dashboard (later)
- Auto-blocking actions (later)
