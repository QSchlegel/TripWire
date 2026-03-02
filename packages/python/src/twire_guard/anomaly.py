from __future__ import annotations

import math
import time
from typing import Any, Protocol

from .utils import hash_string

DAY_MS = 24 * 60 * 60 * 1000

DEFAULT_ANOMALY_CONFIG = {
    "burst_window_ms": 20_000,
    "burst_medium_count": 4,
    "burst_high_count": 7,
    "zscore_medium": 2.5,
    "zscore_high": 4,
    "require_approval_score": 0.45,
    "block_score": 0.8,
}

DECISION_RANK = {"allow": 0, "require_approval": 1, "block": 2}


class StateStore(Protocol):
    async def get(self, key: str) -> Any | None:
        ...

    async def set(self, key: str, value: Any, ttl_ms: int | None = None) -> None:
        ...


class InMemoryStore:
    def __init__(self) -> None:
        self._map: dict[str, dict[str, Any]] = {}

    async def get(self, key: str) -> Any | None:
        record = self._map.get(key)
        if record is None:
            return None

        expires_at = record.get("expires_at")
        if isinstance(expires_at, (int, float)) and (time.time() * 1000) > float(expires_at):
            self._map.pop(key, None)
            return None

        return record.get("value")

    async def set(self, key: str, value: Any, ttl_ms: int | None = None) -> None:
        expires_at = (time.time() * 1000 + ttl_ms) if isinstance(ttl_ms, (int, float)) else None
        self._map[key] = {"value": value, "expires_at": expires_at}


def _max_decision(a: str, b: str) -> str:
    return a if DECISION_RANK[a] >= DECISION_RANK[b] else b


async def _mark_novel(store: StateStore, key: str, token: str, ttl_ms: int) -> dict[str, bool]:
    seen = await store.get(key)
    seen_items = list(seen) if isinstance(seen, list) else []
    had_baseline = len(seen_items) > 0

    if token in seen_items:
        return {"novel": False, "had_baseline": had_baseline}

    next_items = seen_items[-255:] + [token]
    await store.set(key, next_items, ttl_ms)
    return {"novel": True, "had_baseline": had_baseline}


def _update_frequency(stats: dict[str, Any] | None, now_ms: int) -> dict[str, Any]:
    if not isinstance(stats, dict) or stats.get("last_ts") in (None, 0):
        return {
            "next": {
                "count": 0,
                "mean_delta_ms": 0,
                "m2": 0,
                "last_ts": now_ms,
            },
            "z_score": 0,
        }

    delta = max(1, now_ms - int(stats.get("last_ts", now_ms)))
    z_score = 0.0

    count = int(stats.get("count", 0))
    mean_delta_ms = float(stats.get("mean_delta_ms", 0))
    m2 = float(stats.get("m2", 0))

    if count >= 2:
        variance = m2 / max(1, count - 1)
        std = math.sqrt(max(1, variance))
        z_score = (mean_delta_ms - delta) / std

    next_count = count + 1
    mean = mean_delta_ms + (delta - mean_delta_ms) / next_count
    next_m2 = m2 + (delta - mean_delta_ms) * (delta - mean)

    return {
        "next": {
            "count": next_count,
            "mean_delta_ms": mean,
            "m2": next_m2,
            "last_ts": now_ms,
        },
        "z_score": z_score,
    }


def _metric_value(metric: str, signals: dict[str, Any]) -> float:
    if metric == "frequency_zscore":
        return float(signals["frequency_zscore"])
    if metric == "burst":
        return float(signals["burst_count"])
    if metric == "novel_tool":
        return 1.0 if signals["novel_tool"] else 0.0
    if metric == "novel_domain":
        return 1.0 if signals["novel_domain"] else 0.0
    if metric == "novel_template":
        return 1.0 if signals["novel_template"] else 0.0
    if metric == "arg_shape_drift":
        return 1.0 if signals["arg_shape_drift"] else 0.0
    return 0.0


def _default_threshold(metric: str) -> float:
    if metric == "frequency_zscore":
        return 3.0
    if metric == "burst":
        return 5.0
    return 1.0


async def score_anomaly(
    event: dict[str, Any],
    policy: dict[str, Any],
    store: StateStore,
    config_patch: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = {**DEFAULT_ANOMALY_CONFIG, **(config_patch or {})}
    scope = f"{event['actor_id']}:{event['session_id']}"

    reasons: list[str] = []
    signals: dict[str, Any] = {
        "frequency_zscore": 0.0,
        "burst_count": 0,
        "novel_tool": False,
        "novel_domain": False,
        "novel_template": False,
        "arg_shape_drift": False,
    }

    score = 0.0

    freq_key = f"freq:{scope}:{event['tool_name']}"
    freq_stats = await store.get(freq_key)
    freq = _update_frequency(freq_stats if isinstance(freq_stats, dict) else None, int(event["epoch_ms"]))
    signals["frequency_zscore"] = float(freq["z_score"])
    await store.set(freq_key, freq["next"], 90 * DAY_MS)

    if signals["frequency_zscore"] >= float(config["zscore_high"]):
        score += 0.35
        reasons.append(f"frequency z-score {signals['frequency_zscore']:.2f} exceeded high threshold")
    elif signals["frequency_zscore"] >= float(config["zscore_medium"]):
        score += 0.2
        reasons.append(f"frequency z-score {signals['frequency_zscore']:.2f} exceeded medium threshold")

    burst_key = f"burst:{scope}"
    burst_window = await store.get(burst_key)
    burst_items = list(burst_window) if isinstance(burst_window, list) else []
    min_allowed = int(event["epoch_ms"]) - int(config["burst_window_ms"])

    pruned = [int(ts) for ts in burst_items if isinstance(ts, (int, float)) and int(ts) >= min_allowed]
    pruned.append(int(event["epoch_ms"]))
    signals["burst_count"] = len(pruned)
    await store.set(burst_key, pruned, int(config["burst_window_ms"]) * 2)

    if signals["burst_count"] >= int(config["burst_high_count"]):
        score += 0.35
        reasons.append(f"burst count {signals['burst_count']} exceeded high threshold")
    elif signals["burst_count"] >= int(config["burst_medium_count"]):
        score += 0.2
        reasons.append(f"burst count {signals['burst_count']} exceeded medium threshold")

    tool_novelty = await _mark_novel(store, f"seen:tool:{scope}", hash_string(str(event["tool_name"]).lower()), 90 * DAY_MS)
    signals["novel_tool"] = bool(tool_novelty["novel"] and tool_novelty["had_baseline"])
    if signals["novel_tool"]:
        score += 0.1
        reasons.append("first-seen tool for this actor/session baseline")

    destination_domain = event.get("destination_domain")
    if isinstance(destination_domain, str) and destination_domain:
        domain_novelty = await _mark_novel(store, f"seen:domain:{scope}", hash_string(destination_domain), 90 * DAY_MS)
        signals["novel_domain"] = bool(domain_novelty["novel"] and domain_novelty["had_baseline"])
        if signals["novel_domain"]:
            score += 0.1
            reasons.append("first-seen destination domain")

    template_novelty = await _mark_novel(
        store,
        f"seen:template:{scope}",
        hash_string(str(event["action_template"])),
        60 * DAY_MS,
    )
    signals["novel_template"] = bool(template_novelty["novel"] and template_novelty["had_baseline"])
    if signals["novel_template"]:
        score += 0.08
        reasons.append("new action template observed")

    shape_novelty = await _mark_novel(
        store,
        f"seen:arg-shape:{scope}:{event['tool_name']}",
        hash_string(str(event["arg_shape_signature"])),
        60 * DAY_MS,
    )
    signals["arg_shape_drift"] = bool(shape_novelty["novel"] and shape_novelty["had_baseline"])
    if signals["arg_shape_drift"]:
        score += 0.15
        reasons.append("argument shape drift from known baseline")

    triggered_rules: list[dict[str, Any]] = []
    policy_suggested_action = "allow"

    anomaly_rules = policy.get("anomaly_rules")
    if not isinstance(anomaly_rules, list):
        anomaly_rules = policy.get("anomalyRules") if isinstance(policy.get("anomalyRules"), list) else []

    for rule in anomaly_rules:
        if not isinstance(rule, dict):
            continue

        metric = str(rule.get("metric", ""))
        observed = _metric_value(metric, signals)
        threshold_raw = rule.get("threshold")
        threshold = float(threshold_raw) if isinstance(threshold_raw, (int, float)) else _default_threshold(metric)

        if observed < threshold:
            continue

        action = str(rule.get("action", "allow"))

        triggered_rules.append(
            {
                "id": rule.get("id"),
                "metric": metric,
                "observed": observed,
                "threshold": threshold,
                "action": action,
            }
        )

        weight_raw = rule.get("weight")
        weight = float(weight_raw) if isinstance(weight_raw, (int, float)) else (0.35 if action == "block" else 0.2)
        score += weight
        policy_suggested_action = _max_decision(policy_suggested_action, action)

        why = rule.get("why")
        if isinstance(why, str) and why:
            reasons.append(why)

    bounded_score = min(1.0, score)

    score_decision = "allow"
    if bounded_score >= float(config["block_score"]):
        score_decision = "block"
    elif bounded_score >= float(config["require_approval_score"]):
        score_decision = "require_approval"

    return {
        "score": bounded_score,
        "proposed_action": _max_decision(score_decision, policy_suggested_action),
        "signals": signals,
        "reasons": reasons,
        "triggered_rules": triggered_rules,
    }


def get_default_anomaly_config() -> dict[str, Any]:
    return dict(DEFAULT_ANOMALY_CONFIG)
