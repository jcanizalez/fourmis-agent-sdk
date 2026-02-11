/**
 * Scenario 4: Error recovery — tool produces an error, agent recovers.
 */
import { runScenario, type Scenario } from "../runner.ts";

export const scenario: Scenario = {
  name: "04 - Error Recovery",
  prompt:
    "Read the file /nonexistent/path/does-not-exist.txt and tell me what happened. Be brief.",
  maxTurns: 5,
  maxBudgetUsd: 0.20,
};

// Run standalone
if (import.meta.main) {
  await runScenario(scenario);
}
