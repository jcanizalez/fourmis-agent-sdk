/**
 * Scenario 5: Budget limit — verify graceful stop when budget is exhausted.
 */
import { runScenario, type Scenario } from "../runner.ts";

export const scenario: Scenario = {
  name: "05 - Budget Limit",
  prompt:
    "List all files in the current directory, then read each one and summarize its contents.",
  cwd: import.meta.dir + "/../../..",
  maxTurns: 20,
  maxBudgetUsd: 0.001, // Extremely low — should trigger budget limit
};

// Run standalone
if (import.meta.main) {
  await runScenario(scenario);
}
