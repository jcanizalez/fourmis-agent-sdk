import { test, expect } from "bun:test";
import { calculateAnthropicCost, ANTHROPIC_CONTEXT_WINDOWS } from "../../src/utils/cost.ts";

test("calculates cost for claude-sonnet-4-5", () => {
  const cost = calculateAnthropicCost("claude-sonnet-4-5-20250929", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });

  // $3/M input + $15/M output = $18
  expect(cost).toBeCloseTo(18, 1);
});

test("calculates cost for claude-opus-4-6", () => {
  const cost = calculateAnthropicCost("claude-opus-4-6", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });

  // $15/M input + $75/M output = $90
  expect(cost).toBeCloseTo(90, 1);
});

test("calculates cost with cache tokens", () => {
  const cost = calculateAnthropicCost("claude-sonnet-4-5-20250929", {
    inputTokens: 100_000,
    outputTokens: 50_000,
    cacheReadInputTokens: 500_000,
    cacheCreationInputTokens: 100_000,
  });

  // 0.1M * $3 + 0.05M * $15 + 0.5M * $0.3 + 0.1M * $3.75
  // = $0.30 + $0.75 + $0.15 + $0.375 = $1.575
  expect(cost).toBeCloseTo(1.575, 2);
});

test("returns 0 for unknown model", () => {
  const cost = calculateAnthropicCost("unknown-model-xyz", {
    inputTokens: 1000,
    outputTokens: 1000,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
  expect(cost).toBe(0);
});

test("context window lookup", () => {
  expect(ANTHROPIC_CONTEXT_WINDOWS["claude-opus-4-6"]).toBe(200_000);
  expect(ANTHROPIC_CONTEXT_WINDOWS["claude-sonnet-4-5-20250929"]).toBe(200_000);
  expect(ANTHROPIC_CONTEXT_WINDOWS["claude-haiku-4-5-20251001"]).toBe(200_000);
});
