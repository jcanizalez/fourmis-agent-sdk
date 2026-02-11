/**
 * Scenario 2: Read file — single tool usage.
 */
import { runScenario, type Scenario } from "../runner.ts";

export const scenario: Scenario = {
  name: "02 - Read File",
  prompt:
    "Read the file package.json in the current directory and tell me the project name. Be brief.",
  cwd: import.meta.dir + "/../../..",
  maxTurns: 5,
  maxBudgetUsd: 0.20,
};

// Run standalone
if (import.meta.main) {
  await runScenario(scenario);
}
