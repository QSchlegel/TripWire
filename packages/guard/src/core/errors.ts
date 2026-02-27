import type { GuardDecisionResult } from "../types/index.js";

export class GuardBlockedError extends Error {
  public readonly result: GuardDecisionResult;

  public constructor(result: GuardDecisionResult) {
    super("TripWire blocked tool execution");
    this.name = "GuardBlockedError";
    this.result = result;
  }
}

export class GuardApprovalRequiredError extends Error {
  public readonly result: GuardDecisionResult;

  public constructor(result: GuardDecisionResult) {
    super("TripWire requires explicit approval before executing this tool call");
    this.name = "GuardApprovalRequiredError";
    this.result = result;
  }
}

export class GuardApprovalDeniedError extends Error {
  public readonly result: GuardDecisionResult;

  public constructor(result: GuardDecisionResult) {
    super("TripWire approval callback denied the tool call");
    this.name = "GuardApprovalDeniedError";
    this.result = result;
  }
}
