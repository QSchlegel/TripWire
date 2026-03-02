import { describe, expect, it } from "vitest";
import { compilePolicy } from "@twire/guard";
import { buildChallengePolicy } from "@/lib/challenge/policies";

const themes = ["devops", "wallet", "support"] as const;
const modes = ["vulnerable", "hardened"] as const;

describe("challenge policy generation", () => {
  for (const theme of themes) {
    for (const mode of modes) {
      it(`compiles for ${theme}/${mode}`, () => {
        const markdown = buildChallengePolicy(theme, mode, ["ignore previous instructions"]);
        const compiled = compilePolicy(markdown);

        expect(compiled.id).toBe(`tripwire.challenge.${theme}.${mode}`);
        expect(compiled.rules.length).toBeGreaterThan(0);
      });
    }
  }
});
