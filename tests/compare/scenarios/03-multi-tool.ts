/**
 * Scenario 3: Multi-tool — write + read chain.
 */
import { runScenario, type Scenario } from "../runner.ts";
import { unlinkSync } from "node:fs";

const testFile = `/tmp/fourmis-compare-${Date.now()}.txt`;

export const scenario: Scenario = {
  name: "03 - Multi-Tool (Write + Read)",
  prompt: `Create a file at ${testFile} with the content "hello world", then read it back and confirm the contents match. Be brief.`,
  maxTurns: 8,
  maxBudgetUsd: 0.30,
  teardown: async () => {
    try {
      unlinkSync(testFile);
    } catch {}
  },
};

// Run standalone
if (import.meta.main) {
  await runScenario(scenario);
}
