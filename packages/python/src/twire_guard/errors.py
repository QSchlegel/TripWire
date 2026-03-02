from __future__ import annotations

from typing import Any


class PolicyCompileError(Exception):
    def __init__(self, message: str, code: str, line: int, column: int) -> None:
        super().__init__(message)
        self.code = code
        self.line = line
        self.column = column


class GuardBlockedError(Exception):
    def __init__(self, result: dict[str, Any]) -> None:
        super().__init__("TripWire blocked tool execution")
        self.result = result


class GuardApprovalRequiredError(Exception):
    def __init__(self, result: dict[str, Any]) -> None:
        super().__init__("TripWire requires explicit approval before executing this tool call")
        self.result = result


class GuardApprovalDeniedError(Exception):
    def __init__(self, result: dict[str, Any]) -> None:
        super().__init__("TripWire approval callback denied the tool call")
        self.result = result
