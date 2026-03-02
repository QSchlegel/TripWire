from __future__ import annotations

import datetime as dt
import inspect
import time
from typing import Any, Callable

from .anomaly import InMemoryStore, get_default_anomaly_config, score_anomaly
from .chain_of_command import (
    chain_of_command_enabled,
    chain_of_command_max_levels,
    consume_permit,
    create_permit_record,
    is_unsupported_by_policy,
    unsupported_call_fingerprint,
    write_permit,
)
from .decision import decision_from_findings, merge_decision_with_anomaly
from .errors import GuardApprovalDeniedError, GuardApprovalRequiredError, GuardBlockedError
from .evaluate import evaluate_policy
from .normalize import normalize_tool_call
from .utils import read_key


def _fallback_action(policy_default: Any) -> str:
    if policy_default in ("allow", "require_approval", "block"):
        return str(policy_default)
    return "allow"


def _decision_from_review_response(response: dict[str, Any]) -> str | None:
    decision = read_key(response, "decision", "decision")
    if decision in ("yes", "no", "escalate"):
        return str(decision)
    return None


def _initial_supervisor_id(context: dict[str, Any]) -> str:
    metadata = context.get("metadata")
    if not isinstance(metadata, dict):
        return "supervisor-level-1"

    value = read_key(metadata, "chain_of_command_supervisor_id", "chainOfCommandSupervisorId")
    if not isinstance(value, str) or value.strip() == "":
        return "supervisor-level-1"
    return value.strip()


def _denied_chain_result(result: dict[str, Any], review_trail: list[dict[str, Any]]) -> dict[str, Any]:
    out = dict(result)
    chain = dict(out.get("chain_of_command", {}))
    chain["status"] = "denied"
    chain["review_trail"] = [dict(entry) for entry in review_trail]
    out["chain_of_command"] = chain
    return out


def _assert_terminal_evidence(response: dict[str, Any]) -> dict[str, Any] | None:
    reviewer_id = read_key(response, "reviewer_id", "reviewerId")
    reason = read_key(response, "reason", "reason")

    reviewer_id_str = reviewer_id.strip() if isinstance(reviewer_id, str) else ""
    reason_str = reason.strip() if isinstance(reason, str) else ""

    if reviewer_id_str == "" or reason_str == "":
        return None

    return {
        "reviewer_id": reviewer_id_str,
        "reason": reason_str,
        "supervisor_signature": read_key(response, "supervisor_signature", "supervisorSignature"),
    }


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def _normalize_chain_config(config: dict[str, Any]) -> dict[str, Any]:
    chain_config = config.get("chain_of_command")
    if isinstance(chain_config, dict):
        return chain_config

    chain_config = config.get("chainOfCommand")
    if isinstance(chain_config, dict):
        return chain_config

    return {}


def _normalize_anomaly_config(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get("anomaly")
    if not isinstance(raw, dict):
        return {}

    out = dict(raw)
    aliases = {
        "burstWindowMs": "burst_window_ms",
        "burstMediumCount": "burst_medium_count",
        "burstHighCount": "burst_high_count",
        "zScoreMedium": "zscore_medium",
        "zScoreHigh": "zscore_high",
        "requireApprovalScore": "require_approval_score",
        "blockScore": "block_score",
    }

    for camel, snake in aliases.items():
        if camel in out and snake not in out:
            out[snake] = out[camel]

    return out


class GuardEngine:
    def __init__(self, config: dict[str, Any]) -> None:
        if not isinstance(config, dict):
            raise TypeError("Guard config must be a dictionary")

        policy = config.get("policy")
        if not isinstance(policy, dict):
            raise TypeError("Guard config requires a policy dictionary")

        self.policy = policy
        self.store = config.get("store") if config.get("store") is not None else InMemoryStore()
        self.anomaly_config = {
            **get_default_anomaly_config(),
            **_normalize_anomaly_config(config),
        }

        chain_config = _normalize_chain_config(config)
        enabled_value = read_key(chain_config, "enabled", "enabled")
        max_levels_value = read_key(chain_config, "max_escalation_levels", "maxEscalationLevels")

        self.chain_enabled = chain_of_command_enabled(bool(enabled_value) if enabled_value is not None else None)
        self.max_escalation_levels = chain_of_command_max_levels(max_levels_value)

        on_audit = config.get("on_audit") if config.get("on_audit") is not None else config.get("onAudit")
        self.on_audit = on_audit if callable(on_audit) else None

    async def before_tool_call(self, context: dict[str, Any]) -> dict[str, Any]:
        started = time.perf_counter()
        event = normalize_tool_call(context)
        findings = evaluate_policy(event, self.policy)

        defaults = self.policy.get("defaults") if isinstance(self.policy.get("defaults"), dict) else {}
        default_action = _fallback_action(defaults.get("action"))
        policy_decision = decision_from_findings(findings, default_action)

        unsupported_by_policy = is_unsupported_by_policy(
            {
                "fallback_action": default_action,
                "findings_count": len(findings),
                "policy_decision": policy_decision,
            }
        )

        fingerprint = unsupported_call_fingerprint(event) if unsupported_by_policy else None
        effective_policy_decision = policy_decision
        chain_of_command: dict[str, Any] = {"status": "not_applicable", "review_trail": []}

        if self.chain_enabled and unsupported_by_policy and isinstance(fingerprint, str):
            permit = await consume_permit(
                self.store,
                {"actor_id": event["actor_id"], "session_id": event["session_id"]},
                fingerprint,
            )

            if permit:
                effective_policy_decision = "allow"
                chain_of_command = {
                    "status": "approved_once",
                    "fingerprint": fingerprint,
                    "permit_id": permit.get("permit_id"),
                    "review_trail": [dict(entry) for entry in permit.get("review_trail", [])],
                }
            else:
                chain_of_command = {
                    "status": "eligible",
                    "fingerprint": fingerprint,
                    "review_trail": [],
                }

        anomaly = await score_anomaly(event, self.policy, self.store, self.anomaly_config)

        merged = merge_decision_with_anomaly(effective_policy_decision, str(anomaly["proposed_action"]))
        decision = merged["decision"]
        escalated_by_anomaly = bool(merged["escalated_by_anomaly"])

        if chain_of_command.get("status") == "approved_once" and anomaly.get("proposed_action") == "block":
            decision = "block"
            escalated_by_anomaly = True

        policy_mode = self.policy.get("mode")
        if policy_mode == "monitor":
            decision = "allow"

        latency_ms = round((time.perf_counter() - started) * 1000, 3)

        result = {
            "decision": decision,
            "policy_decision": policy_decision,
            "findings": findings,
            "anomaly": anomaly,
            "event_id": event["event_id"],
            "policy_id": self.policy.get("id"),
            "latency_ms": latency_ms,
            "escalated_by_anomaly": escalated_by_anomaly,
            "unsupported_by_policy": unsupported_by_policy,
            "chain_of_command": chain_of_command,
        }

        if self.on_audit:
            try:
                await _maybe_await(self.on_audit({"event": event, "result": result}))
            except Exception:
                pass

        return result

    async def authorize_unsupported_call(self, context: dict[str, Any], input_value: dict[str, Any]) -> dict[str, Any]:
        if not self.chain_enabled:
            raise ValueError("Chain of command is disabled for this guard instance")

        reviewer_id_raw = read_key(input_value, "reviewer_id", "reviewerId")
        reason_raw = read_key(input_value, "reason", "reason")

        reviewer_id = reviewer_id_raw.strip() if isinstance(reviewer_id_raw, str) else ""
        reason = reason_raw.strip() if isinstance(reason_raw, str) else ""

        if reviewer_id == "" or reason == "":
            raise ValueError("Chain of command approval requires reviewer_id and reason")

        review_trail = read_key(input_value, "review_trail", "reviewTrail")
        if not isinstance(review_trail, list) or len(review_trail) == 0:
            raise ValueError("Chain of command approval requires a non-empty review_trail")

        event = normalize_tool_call(context)
        findings = evaluate_policy(event, self.policy)

        defaults = self.policy.get("defaults") if isinstance(self.policy.get("defaults"), dict) else {}
        default_action = _fallback_action(defaults.get("action"))
        policy_decision = decision_from_findings(findings, default_action)

        unsupported_by_policy = is_unsupported_by_policy(
            {
                "fallback_action": default_action,
                "findings_count": len(findings),
                "policy_decision": policy_decision,
            }
        )

        if not unsupported_by_policy:
            raise ValueError("Chain of command approval is only available for unsupported-by-policy calls")

        fingerprint = unsupported_call_fingerprint(event)
        permit = create_permit_record(
            event,
            fingerprint,
            {
                "reviewer_id": reviewer_id,
                "reason": reason,
                "supervisor_signature": read_key(input_value, "supervisor_signature", "supervisorSignature"),
                "review_trail": [dict(entry) for entry in review_trail if isinstance(entry, dict)],
            },
        )

        await write_permit(self.store, permit)
        return permit

    def wrap_tool(
        self,
        tool_name: str,
        tool_fn: Callable[[Any, dict[str, Any]], Any],
        opts: dict[str, Any] | None = None,
    ) -> Callable[[Any], Any]:
        options = opts or {}

        async def wrapped(input_value: Any):
            build_context = options.get("build_context") or options.get("buildContext")
            context_patch = await _maybe_await(build_context(input_value)) if callable(build_context) else {}
            if not isinstance(context_patch, dict):
                context_patch = {}

            context = {
                **context_patch,
                "tool_name": tool_name,
                "args": context_patch["args"] if "args" in context_patch else input_value,
            }

            result = await self.before_tool_call(context)

            review_cb = options.get("on_chain_of_command_review") or options.get("onChainOfCommandReview")

            if (
                result.get("decision") == "block"
                and result.get("chain_of_command", {}).get("status") == "eligible"
                and callable(review_cb)
            ):
                review_trail: list[dict[str, Any]] = []
                supervisor_id = _initial_supervisor_id(context)

                for level in range(1, self.max_escalation_levels + 1):
                    response_value = await _maybe_await(
                        review_cb(
                            {
                                "level": level,
                                "max_levels": self.max_escalation_levels,
                                "supervisor_id": supervisor_id,
                                "input": input_value,
                                "result": result,
                                "fingerprint": result.get("chain_of_command", {}).get("fingerprint", ""),
                                "review_trail": [dict(entry) for entry in review_trail],
                            }
                        )
                    )

                    response = response_value if isinstance(response_value, dict) else {}
                    decision = _decision_from_review_response(response)
                    if decision is None:
                        result = _denied_chain_result(result, review_trail)
                        break

                    entry = {
                        "level": level,
                        "supervisor_id": supervisor_id,
                        "decision": decision,
                        "reviewer_id": read_key(response, "reviewer_id", "reviewerId"),
                        "reason": read_key(response, "reason", "reason"),
                        "supervisor_signature": read_key(response, "supervisor_signature", "supervisorSignature"),
                        "next_supervisor_id": read_key(response, "next_supervisor_id", "nextSupervisorId"),
                        "ts": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
                    }
                    review_trail.append(entry)

                    if decision == "escalate":
                        next_supervisor_id = read_key(response, "next_supervisor_id", "nextSupervisorId")
                        next_id = next_supervisor_id.strip() if isinstance(next_supervisor_id, str) else ""
                        if next_id == "":
                            result = _denied_chain_result(result, review_trail)
                            break

                        supervisor_id = next_id
                        if level == self.max_escalation_levels:
                            result = _denied_chain_result(result, review_trail)
                        continue

                    evidence = _assert_terminal_evidence(response)
                    if evidence is None:
                        result = _denied_chain_result(result, review_trail)
                        break

                    if decision == "no":
                        result = _denied_chain_result(result, review_trail)
                        break

                    await self.authorize_unsupported_call(
                        context,
                        {
                            "reviewer_id": evidence["reviewer_id"],
                            "reason": evidence["reason"],
                            "supervisor_signature": evidence.get("supervisor_signature"),
                            "review_trail": review_trail,
                        },
                    )

                    result = await self.before_tool_call(context)
                    break

            if result.get("decision") == "block":
                raise GuardBlockedError(result)

            if result.get("decision") == "require_approval":
                on_require_approval = options.get("on_require_approval") or options.get("onRequireApproval")
                if not callable(on_require_approval):
                    raise GuardApprovalRequiredError(result)

                approved = await _maybe_await(on_require_approval(result, input_value))
                if not approved:
                    raise GuardApprovalDeniedError(result)

            return await _maybe_await(tool_fn(input_value, result))

        return wrapped


def create_guard(config: dict[str, Any]) -> GuardEngine:
    return GuardEngine(config)
