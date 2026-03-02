from __future__ import annotations

import json
import re
from typing import Any


def hash_string(input_value: str) -> str:
    hash_value = 2166136261
    for ch in input_value:
        hash_value ^= ord(ch)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return f"fnv1a:{hash_value:08x}"


def _sort_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_sort_value(item) for item in value]

    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key in sorted(value.keys()):
            out[str(key)] = _sort_value(value[key])
        return out

    return value


def stable_stringify(value: Any) -> str:
    return json.dumps(_sort_value(value), separators=(",", ":"), ensure_ascii=False)


def sanitize_text(input_value: str) -> str:
    cleaned = input_value.lower()
    cleaned = re.sub(r"[0-9]+", "#", cleaned)
    cleaned = re.sub(r"\b[a-f0-9]{12,}\b", "hex", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _infer_type(value: Any) -> str:
    if isinstance(value, list):
        return "array"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def arg_shape_signature(value: Any) -> str:
    if not isinstance(value, (dict, list)):
        return _infer_type(value)

    if isinstance(value, list):
        member = "empty" if len(value) == 0 else arg_shape_signature(value[0])
        return f"array<{member}>"

    keys = sorted(value.keys())
    return "|".join(f"{key}:{arg_shape_signature(value[key])}" for key in keys)


def get_by_path(source: Any, path: str) -> Any:
    if not isinstance(path, str) or path.strip() == "":
        return None

    parts = [part.strip() for part in path.split(".") if part.strip()]
    cursor = source

    for part in parts:
        if cursor is None:
            return None

        if isinstance(cursor, list):
            if not part.isdigit():
                return None
            idx = int(part)
            if idx < 0 or idx >= len(cursor):
                return None
            cursor = cursor[idx]
            continue

        if not isinstance(cursor, dict):
            return None

        cursor = cursor.get(part)

    return cursor


def maybe_await(value: Any):
    if hasattr(value, "__await__"):
        return value
    return value


def read_key(data: dict[str, Any], snake: str, camel: str) -> Any:
    if snake in data:
        return data[snake]
    return data.get(camel)


def parse_js_regex_flags(flags: str | None) -> int:
    if not flags:
        return 0

    out = 0
    for flag in flags:
        if flag == "i":
            out |= re.IGNORECASE
        elif flag == "m":
            out |= re.MULTILINE
        elif flag == "s":
            out |= re.DOTALL
        elif flag in ("g", "u", "y"):
            # JS-only runtime modifiers that do not affect Python compile-time behavior.
            continue
        else:
            raise ValueError(f"Unsupported regex flag: {flag}")

    return out


def compile_regex(pattern: str, flags: str | None, default_insensitive: bool = False) -> re.Pattern[str]:
    compiled_flags = 0
    if flags is not None:
        compiled_flags = parse_js_regex_flags(flags)
    elif default_insensitive:
        compiled_flags = re.IGNORECASE

    return re.compile(pattern, compiled_flags)
