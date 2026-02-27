import type { Decision, Finding, Severity } from "../types/index.js";

const decisionOrder: Record<Decision, number> = {
  allow: 0,
  require_approval: 1,
  block: 2
};

function maxDecision(a: Decision, b: Decision): Decision {
  return decisionOrder[a] >= decisionOrder[b] ? a : b;
}

export function severityToDecision(severity: Severity): Decision {
  if (severity === "high") return "block";
  if (severity === "med") return "require_approval";
  return "allow";
}

export function decisionFromFindings(findings: Finding[], fallback: Decision = "allow"): Decision {
  let decision = fallback;
  for (const finding of findings) {
    decision = maxDecision(decision, finding.action);
  }
  return decision;
}

export function mergeDecisionWithAnomaly(policyDecision: Decision, anomalyProposal: Decision): {
  decision: Decision;
  escalatedByAnomaly: boolean;
} {
  if (policyDecision === "block") {
    return { decision: "block", escalatedByAnomaly: false };
  }

  if (anomalyProposal === "allow") {
    return { decision: policyDecision, escalatedByAnomaly: false };
  }

  if (anomalyProposal === "require_approval") {
    if (policyDecision === "allow") {
      return { decision: "require_approval", escalatedByAnomaly: true };
    }
    return { decision: policyDecision, escalatedByAnomaly: false };
  }

  if (policyDecision === "allow") {
    return { decision: "require_approval", escalatedByAnomaly: true };
  }

  if (policyDecision === "require_approval") {
    return { decision: "block", escalatedByAnomaly: true };
  }

  return { decision: policyDecision, escalatedByAnomaly: false };
}
