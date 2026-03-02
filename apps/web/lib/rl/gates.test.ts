import { describe, expect, it } from "vitest";
import { passesRolloutGate } from "@/lib/rl/gates";

describe("rollout gate", () => {
  it("passes candidate at threshold", () => {
    expect(
      passesRolloutGate({
        hackSuccessDelta: 0.08,
        legitCompletionDrop: 0.02
      })
    ).toBe(true);
  });

  it("fails candidate below improvement threshold", () => {
    expect(
      passesRolloutGate({
        hackSuccessDelta: 0.05,
        legitCompletionDrop: 0.01
      })
    ).toBe(false);
  });
});
