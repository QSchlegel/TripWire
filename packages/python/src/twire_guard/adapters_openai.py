from __future__ import annotations

import inspect
from typing import Any


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


class OpenAIAdapter:
    def __init__(self, guard: Any, options: dict[str, Any] | None = None) -> None:
        self.guard = guard
        self.options = options or {}

    async def before_tool_execution(self, tool_call: dict[str, Any]) -> dict[str, Any]:
        context = {
            "tool_name": tool_call.get("tool_name") or tool_call.get("toolName"),
            "args": tool_call.get("args"),
            "text": tool_call.get("text"),
            "intent": tool_call.get("intent"),
            "destination": tool_call.get("destination"),
            "actor_id": self.options.get("actor_id", self.options.get("actorId")),
            "actor_type": self.options.get("actor_type", self.options.get("actorType", "agent")),
            "session_id": self.options.get("session_id", self.options.get("sessionId")),
            "metadata": tool_call.get("metadata"),
        }
        return await self.guard.before_tool_call(context)

    def wrap_tool(self, tool_name: str, tool_fn: Any, opts: dict[str, Any] | None = None):
        options = opts or {}
        adapter_options = self.options

        async def on_require_approval(result: dict[str, Any], input_value: Any) -> bool:
            cb = options.get("on_require_approval") or options.get("onRequireApproval")
            if callable(cb):
                return bool(await _maybe_await(cb(result, input_value)))

            adapter_cb = adapter_options.get("on_require_approval") or adapter_options.get("onRequireApproval")
            if not callable(adapter_cb):
                return False

            payload = {
                "tool_name": tool_name,
                "args": input_value,
                "text": None,
                "intent": None,
            }
            return bool(await _maybe_await(adapter_cb(result, payload)))

        async def on_chain_review(request: dict[str, Any]) -> dict[str, Any]:
            cb = options.get("on_chain_of_command_review") or options.get("onChainOfCommandReview")
            if callable(cb):
                out = await _maybe_await(cb(request))
                return out if isinstance(out, dict) else {}

            adapter_cb = adapter_options.get("on_chain_of_command_review") or adapter_options.get("onChainOfCommandReview")
            if not callable(adapter_cb):
                return {}

            payload = {
                "tool_name": tool_name,
                "args": request.get("input"),
                "text": None,
                "intent": None,
            }
            out = await _maybe_await(adapter_cb({**request, "input": payload}))
            return out if isinstance(out, dict) else {}

        base_opts = dict(options)
        has_review = callable(options.get("on_chain_of_command_review") or options.get("onChainOfCommandReview")) or callable(
            adapter_options.get("on_chain_of_command_review") or adapter_options.get("onChainOfCommandReview")
        )

        base_opts["on_require_approval"] = on_require_approval
        if has_review:
            base_opts["on_chain_of_command_review"] = on_chain_review

        return self.guard.wrap_tool(tool_name, tool_fn, base_opts)

    async def guardrail(self, input_value: dict[str, Any]) -> dict[str, Any]:
        return await self.guard.before_tool_call(
            {
                "tool_name": input_value.get("tool_name"),
                "args": input_value.get("tool_input"),
                "text": str(input_value.get("tool_input") or {}),
                "session_id": self.options.get("session_id", self.options.get("sessionId")),
                "actor_id": self.options.get("actor_id", self.options.get("actorId")),
                "actor_type": self.options.get("actor_type", self.options.get("actorType", "agent")),
                "metadata": input_value.get("run_context"),
            }
        )


def openai_adapter(guard: Any, options: dict[str, Any] | None = None) -> OpenAIAdapter:
    return OpenAIAdapter(guard, options)
