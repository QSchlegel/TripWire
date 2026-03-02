from __future__ import annotations

import inspect
from typing import Any


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def langchain_middleware(guard: Any, options: dict[str, Any] | None = None):
    opts = options or {}

    async def middleware(request: dict[str, Any], next_fn):
        tool_call = request.get("toolCall") if isinstance(request.get("toolCall"), dict) else request.get("tool_call")
        call = tool_call if isinstance(tool_call, dict) else {}

        async def wrapped_tool(input_request: dict[str, Any], _guard_result: dict[str, Any]):
            return await _maybe_await(next_fn(input_request))

        async def build_context(input_request: dict[str, Any]):
            tool_input = input_request.get("toolCall") if isinstance(input_request.get("toolCall"), dict) else input_request.get("tool_call")
            tool = tool_input if isinstance(tool_input, dict) else {}
            return {
                "args": tool.get("args"),
                "text": tool.get("text"),
                "intent": tool.get("intent"),
                "destination": tool.get("destination"),
                "actor_id": opts.get("actor_id", opts.get("actorId")),
                "actor_type": opts.get("actor_type", opts.get("actorType", "agent")),
                "session_id": opts.get("session_id", opts.get("sessionId")),
                "metadata": tool.get("metadata"),
            }

        base_opts: dict[str, Any] = {
            "build_context": build_context,
        }

        on_require_approval = opts.get("on_require_approval") or opts.get("onRequireApproval")
        if callable(on_require_approval):

            async def _approval(result: dict[str, Any], input_request: dict[str, Any]):
                tool_input = input_request.get("toolCall") if isinstance(input_request.get("toolCall"), dict) else input_request.get("tool_call")
                tool = tool_input if isinstance(tool_input, dict) else {}
                return await _maybe_await(on_require_approval(result, tool))

            base_opts["on_require_approval"] = _approval

        on_chain_review = opts.get("on_chain_of_command_review") or opts.get("onChainOfCommandReview")
        if callable(on_chain_review):

            async def _chain_review(review_request: dict[str, Any]):
                input_tool = review_request.get("input", {}).get("toolCall") if isinstance(review_request.get("input"), dict) else None
                if not isinstance(input_tool, dict):
                    input_tool = (
                        review_request.get("input", {}).get("tool_call")
                        if isinstance(review_request.get("input"), dict)
                        else None
                    )
                if not isinstance(input_tool, dict):
                    input_tool = {}
                return await _maybe_await(on_chain_review({**review_request, "input": input_tool}))

            base_opts["on_chain_of_command_review"] = _chain_review

        wrapped = guard.wrap_tool(str(call.get("toolName") or call.get("tool_name") or "unknown"), wrapped_tool, base_opts)
        return await wrapped(request)

    return middleware


def create_langchain_tool_wrapper(guard: Any, options: dict[str, Any] | None = None):
    opts = options or {}
    approval = opts.get("on_require_approval") or opts.get("onRequireApproval")
    chain_review = opts.get("on_chain_of_command_review") or opts.get("onChainOfCommandReview")

    def wrap_tool(tool_name: str, tool_fn):
        base_opts: dict[str, Any] = {
            "build_context": lambda _input: {
                "actor_id": opts.get("actor_id", opts.get("actorId")),
                "session_id": opts.get("session_id", opts.get("sessionId")),
                "actor_type": opts.get("actor_type", opts.get("actorType", "agent")),
                "args": _input,
            }
        }

        if callable(approval):

            async def _approval(result: dict[str, Any], input_value: Any):
                return await _maybe_await(approval(result, {"tool_name": tool_name, "args": input_value}))

            base_opts["on_require_approval"] = _approval

        if callable(chain_review):

            async def _chain_review(request: dict[str, Any]):
                return await _maybe_await(
                    chain_review({**request, "input": {"tool_name": tool_name, "args": request.get("input")}})
                )

            base_opts["on_chain_of_command_review"] = _chain_review

        return guard.wrap_tool(tool_name, tool_fn, base_opts)

    return wrap_tool
