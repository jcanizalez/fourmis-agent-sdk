/**
 * Per-model pricing tables for cost tracking.
 */

export type ModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
};

export const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  // Opus
  "claude-opus-4-6": {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
  // Sonnet
  "claude-sonnet-4-5-20250929": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  // Haiku
  "claude-haiku-4-5-20251001": {
    inputPerMillion: 0.80,
    outputPerMillion: 4,
    cacheReadPerMillion: 0.08,
    cacheWritePerMillion: 1,
  },
  // Legacy models
  "claude-3-5-sonnet-20241022": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  "claude-3-5-haiku-20241022": {
    inputPerMillion: 0.80,
    outputPerMillion: 4,
    cacheReadPerMillion: 0.08,
    cacheWritePerMillion: 1,
  },
};

export const ANTHROPIC_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-6": 200_000,
  "claude-sonnet-4-5-20250929": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
};

export const ANTHROPIC_MAX_OUTPUT: Record<string, number> = {
  "claude-opus-4-6": 32_000,
  "claude-sonnet-4-5-20250929": 16_384,
  "claude-haiku-4-5-20251001": 8_192,
  "claude-3-5-sonnet-20241022": 8_192,
  "claude-3-5-haiku-20241022": 8_192,
};

/**
 * Calculate cost for a given model and token usage.
 */
export function calculateAnthropicCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number },
): number {
  const pricing = findPricing(model);
  if (!pricing) return 0;

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheReadCost = (usage.cacheReadInputTokens / 1_000_000) * (pricing.cacheReadPerMillion ?? pricing.inputPerMillion);
  const cacheWriteCost = (usage.cacheCreationInputTokens / 1_000_000) * (pricing.cacheWritePerMillion ?? pricing.inputPerMillion);

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

function findPricing(model: string): ModelPricing | undefined {
  // Exact match
  if (ANTHROPIC_PRICING[model]) return ANTHROPIC_PRICING[model];

  // Prefix match (e.g., "claude-sonnet-4-5" matches "claude-sonnet-4-5-20250929")
  for (const [key, pricing] of Object.entries(ANTHROPIC_PRICING)) {
    if (key.startsWith(model) || model.startsWith(key.split("-2025")[0])) {
      return pricing;
    }
  }

  return undefined;
}
