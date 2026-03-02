from __future__ import annotations

from typing import Any

DECISION_ORDER = {"allow": 0, "require_approval": 1, "block": 2}


def _max_decision(a: str, b: str) -> str:
    return a if DECISION_ORDER[a] >= DECISION_ORDER[b] else b


def severity_to_decision(severity: str) -> str:
    if severity == "high":
        return "block"
    if severity == "med":
        return "require_approval"
    return "allow"


def decision_from_findings(findings: list[dict[str, Any]], fallback: str = "allow") -> str:
    decision = fallback
    for finding in findings:
        decision = _max_decision(decision, str(finding["action"]))
    return decision


def merge_decision_with_anomaly(policy_decision: str, anomaly_proposal: str) -> dict[str, Any]:
    if policy_decision == "block":
        return {"decision": "block", "escalated_by_anomaly": False}

    if anomaly_proposal == "allow":
        return {"decision": policy_decision, "escalated_by_anomaly": False}

    if anomaly_proposal == "require_approval":
        if policy_decision == "allow":
            return {"decision": "require_approval", "escalated_by_anomaly": True}
        return {"decision": policy_decision, "escalated_by_anomaly": False}

    if policy_decision == "allow":
        return {"decision": "require_approval", "escalated_by_anomaly": True}

    if policy_decision == "require_approval":
        return {"decision": "block", "escalated_by_anomaly": True}

    return {"decision": policy_decision, "escalated_by_anomaly": False}
