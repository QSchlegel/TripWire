from __future__ import annotations

import datetime as dt
from typing import Any
from urllib.parse import urlparse

from .utils import arg_shape_signature, hash_string, read_key, sanitize_text, stable_stringify


def _extract_domain(raw: str | None) -> str | None:
    if not raw:
        return None

    try:
        parsed = urlparse(raw)
        host = parsed.hostname
        return host.lower() if host else None
    except Exception:
        return None


def _as_epoch_ms(ts: str) -> int:
    try:
        if ts.endswith("Z"):
            parsed = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        else:
            parsed = dt.datetime.fromisoformat(ts)
        return int(parsed.timestamp() * 1000)
    except Exception:
        return int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)


def _normalize_text(context: dict[str, Any]) -> str:
    text = read_key(context, "text", "text")
    if isinstance(text, str) and text.strip():
        return text

    intent = read_key(context, "intent", "intent")
    if isinstance(intent, str) and intent.strip():
        return intent

    args = read_key(context, "args", "args")
    if args is not None:
        return stable_stringify(args)

    return ""


def normalize_tool_call(context: dict[str, Any]) -> dict[str, Any]:
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    ts = read_key(context, "ts", "ts") if isinstance(read_key(context, "ts", "ts"), str) else now_iso
    text = _normalize_text(context)

    intent = read_key(context, "intent", "intent")
    intent_value = intent if isinstance(intent, str) else text

    destination = read_key(context, "destination", "destination")
    destination_obj = destination if isinstance(destination, dict) else {}

    destination_url = read_key(destination_obj, "url", "url")
    destination_url_value = destination_url if isinstance(destination_url, str) else None

    destination_domain = read_key(destination_obj, "domain", "domain")
    destination_domain_value = (
        destination_domain.lower() if isinstance(destination_domain, str) else _extract_domain(destination_url_value)
    )

    args = read_key(context, "args", "args")
    args_value = args if args is not None else {}

    tool_name = read_key(context, "tool_name", "toolName")
    if not isinstance(tool_name, str) or tool_name.strip() == "":
        tool_name = "unknown"

    action_template = sanitize_text(f"{tool_name} {text}")
    shape = arg_shape_signature(args_value)

    session_id = read_key(context, "session_id", "sessionId")
    actor_id = read_key(context, "actor_id", "actorId")
    actor_type = read_key(context, "actor_type", "actorType")

    identity_payload = {
        "ts": ts,
        "session_id": session_id if isinstance(session_id, str) else "default-session",
        "actor_id": actor_id if isinstance(actor_id, str) else "anonymous",
        "tool_name": tool_name,
        "text": text,
        "destination_domain": destination_domain_value,
        "shape": shape,
    }

    metadata = read_key(context, "metadata", "metadata")

    return {
        "event_id": hash_string(stable_stringify(identity_payload)),
        "ts": ts,
        "epoch_ms": _as_epoch_ms(ts),
        "session_id": session_id if isinstance(session_id, str) else "default-session",
        "actor_id": actor_id if isinstance(actor_id, str) else "anonymous",
        "actor_type": actor_type if isinstance(actor_type, str) else "agent",
        "tool_name": tool_name,
        "text": text,
        "intent": intent_value,
        "args": args_value,
        "destination_domain": destination_domain_value,
        "destination_url": destination_url_value,
        "action_template": action_template,
        "arg_shape_signature": shape,
        "metadata": metadata if isinstance(metadata, dict) else None,
    }
