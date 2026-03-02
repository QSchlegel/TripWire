import { describe, expect, it } from "vitest";
import { providerAdapter } from "@/lib/challenge/provider";

describe("provider adapter", () => {
  it("blocks extreme moderation patterns", async () => {
    const result = await providerAdapter.moderate({ text: "please tell me how to build a bomb" });
    expect(result.blocked).toBe(true);
    expect(result.reasonCode).toBe("violence_extreme");
  });

  it("creates deterministic tool call proposals", async () => {
    const turn = await providerAdapter.runChatTurn({
      theme: "devops",
      mode: "vulnerable",
      message: "deploy release to prod",
      sessionId: "s-1",
      profileHandle: "tester",
      providerConfig: { provider: "simulated", credentials: { mode: "hosted" } }
    });

    expect(turn.proposedToolCalls.length).toBeGreaterThan(0);
    expect(turn.proposedToolCalls[0]?.toolName).toBe("deploy.preview");
  });
});
