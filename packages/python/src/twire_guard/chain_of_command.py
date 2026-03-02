from __future__ import annotations

import datetime as dt
from typing import Any

from .utils import hash_string, stable_stringify

DEFAULT_CHAIN_OF_COMMAND_MAX_LEVELS = 3
CHAIN_PERMIT_KEY_PREFIX = "chain:permit"


def chain_of_command_enabled(enabled: bool | None) -> bool:
    return enabled is True


def chain_of_command_max_levels(raw: int | float | None) -> int:
    if not isinstance(raw, (int, float)):
        return DEFAULT_CHAIN_OF_COMMAND_MAX_LEVELS

    normalized = int(raw)
    if normalized < 1:
        return 1
    return normalized


def is_unsupported_by_policy(options: dict[str, Any]) -> bool:
    return (
        options.get("fallback_action") == "block"
        and int(options.get("findings_count", 0)) == 0
        and options.get("policy_decision") == "block"
    )


def unsupported_call_fingerprint(event: dict[str, Any]) -> str:
    payload = {
        "tool_name": str(event.get("tool_name", "")).lower(),
        "text": str(event.get("text", "")).strip(),
        "intent": str(event.get("intent", "")).strip(),
        "args": event.get("args"),
        "destination": {
            "domain": event.get("destination_domain") or "",
            "url": event.get("destination_url") or "",
        },
        "actor_id": event.get("actor_id"),
        "session_id": event.get("session_id"),
    }

    return hash_string(stable_stringify(payload))


def chain_permit_store_key(scope: dict[str, str], fingerprint: str) -> str:
    return f"{CHAIN_PERMIT_KEY_PREFIX}:{scope['actor_id']}:{scope['session_id']}:{fingerprint}"


def create_permit_record(event: dict[str, Any], fingerprint: str, input_value: dict[str, Any]) -> dict[str, Any]:
    created_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    permit_seed = {
        "fingerprint": fingerprint,
        "created_at": created_at,
        "actor_id": event.get("actor_id"),
        "session_id": event.get("session_id"),
        "reviewer_id": input_value.get("reviewer_id"),
    }

    return {
        "permit_id": f"permit:{hash_string(stable_stringify(permit_seed))}",
        "fingerprint": fingerprint,
        "actor_id": event.get("actor_id"),
        "session_id": event.get("session_id"),
        "tool_name": event.get("tool_name"),
        "remaining_uses": 1,
        "created_at": created_at,
        "reviewer_id": input_value.get("reviewer_id"),
        "reason": input_value.get("reason"),
        "supervisor_signature": input_value.get("supervisor_signature"),
        "review_trail": [dict(entry) for entry in input_value.get("review_trail", [])],
    }


async def read_permit(store: Any, scope: dict[str, str], fingerprint: str) -> dict[str, Any] | None:
    key = chain_permit_store_key(scope, fingerprint)
    value = await store.get(key)
    if isinstance(value, dict):
        return value
    return None


async def write_permit(store: Any, permit: dict[str, Any]) -> None:
    key = chain_permit_store_key(
        {
            "actor_id": str(permit.get("actor_id", "")),
            "session_id": str(permit.get("session_id", "")),
        },
        str(permit.get("fingerprint", "")),
    )
    await store.set(key, permit)


async def consume_permit(store: Any, scope: dict[str, str], fingerprint: str) -> dict[str, Any] | None:
    key = chain_permit_store_key(scope, fingerprint)
    permit = await store.get(key)
    if not isinstance(permit, dict) or int(permit.get("remaining_uses", 0)) < 1:
        return None

    consumed = dict(permit)
    consumed["remaining_uses"] = int(permit.get("remaining_uses", 0)) - 1
    await store.set(key, consumed)
    return consumed
