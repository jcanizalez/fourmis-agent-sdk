/**
 * Scenario 1: Simple text — no tools, just a text answer.
 */
import { runScenario, type Scenario } from "../runner.ts";

export const scenario: Scenario = {
  name: "01 - Simple Text (no tools)",
  prompt: "What is 2 + 2? Reply with just the number, nothing else.",
  maxTurns: 3,
  maxBudgetUsd: 0.10,
};

// Run standalone
if (import.meta.main) {
  await runScenario(scenario);
}
