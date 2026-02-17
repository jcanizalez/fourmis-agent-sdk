import { describe, expect, test } from "bun:test";
import { evaluateScenario } from "./assertions.ts";
import type { CompatScenario, RunTrace } from "./types.ts";

function trace(overrides: Partial<RunTrace>): RunTrace {
  return {
    sdk: "fourmis",
    scenarioId: "scenario",
    runId: "run-1",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 10,
    durationApiMs: 5,
    ttftMs: 4,
    turns: 1,
    costUsd: 0,
    stopReason: "success",
    errors: [],
    textOutput: "ok",
    toolCalls: [],
    toolResults: [],
    hookEvents: [],
    permissionDenials: [],
    streamEventCounts: {
      textDelta: 0,
      thinkingDelta: 0,
      partialAssistant: 0,
    },
    ...overrides,
  };
}

describe("compat assertions", () => {
  const scenario: CompatScenario = {
    id: "scenario",
    name: "Scenario",
    description: "test",
    buildRunConfig: async () => ({ prompt: "x" }),
    assertions: {
      shared: {
        stopReasons: ["success"],
        requiredTools: ["Read"],
      },
      parity: {
        sameStopReason: true,
      },
    },
  };

  test("passes when both traces satisfy shared + parity checks", () => {
    const fourmis = trace({
      sdk: "fourmis",
      toolCalls: [{ name: "Read", input: {} }],
      textOutput: "done",
    });
    const anthropic = trace({
      sdk: "anthropic",
      toolCalls: [{ name: "Read", input: {} }],
      textOutput: "done",
    });

    const failures = evaluateScenario(scenario, fourmis, anthropic);
    expect(failures).toHaveLength(0);
  });

  test("fails required tool check", () => {
    const fourmis = trace({ sdk: "fourmis" });
    const anthropic = trace({ sdk: "anthropic", toolCalls: [{ name: "Read", input: {} }] });

    const failures = evaluateScenario(scenario, fourmis, anthropic);
    expect(failures.some((failure) => failure.code === "required_tool_missing")).toBe(true);
  });

  test("fails parity stop reason mismatch", () => {
    const fourmis = trace({
      sdk: "fourmis",
      toolCalls: [{ name: "Read", input: {} }],
      stopReason: "success",
    });
    const anthropic = trace({
      sdk: "anthropic",
      toolCalls: [{ name: "Read", input: {} }],
      stopReason: "error_max_turns",
    });

    const failures = evaluateScenario(scenario, fourmis, anthropic);
    expect(failures.some((failure) => failure.code === "stop_reason_diff")).toBe(true);
  });
});
