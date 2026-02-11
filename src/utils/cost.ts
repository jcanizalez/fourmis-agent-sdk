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

// ─── OpenAI ──────────────────────────────────────────────────────────────────

export const OPENAI_PRICING: Record<string, ModelPricing> = {
  "gpt-4.1": {
    inputPerMillion: 2,
    outputPerMillion: 8,
    cacheReadPerMillion: 0.5,
  },
  "gpt-4.1-mini": {
    inputPerMillion: 0.4,
    outputPerMillion: 1.6,
    cacheReadPerMillion: 0.1,
  },
  "gpt-4.1-nano": {
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
    cacheReadPerMillion: 0.025,
  },
  "gpt-4o": {
    inputPerMillion: 2.5,
    outputPerMillion: 10,
    cacheReadPerMillion: 1.25,
  },
  "gpt-4o-mini": {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cacheReadPerMillion: 0.075,
  },
  "o3": {
    inputPerMillion: 2,
    outputPerMillion: 8,
    cacheReadPerMillion: 0.5,
  },
  "o3-mini": {
    inputPerMillion: 1.1,
    outputPerMillion: 4.4,
    cacheReadPerMillion: 0.275,
  },
  "o4-mini": {
    inputPerMillion: 1.1,
    outputPerMillion: 4.4,
    cacheReadPerMillion: 0.275,
  },
};

export const OPENAI_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-4.1": 1_047_576,
  "gpt-4.1-mini": 1_047_576,
  "gpt-4.1-nano": 1_047_576,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "o3": 200_000,
  "o3-mini": 200_000,
  "o4-mini": 200_000,
};

export const OPENAI_MAX_OUTPUT: Record<string, number> = {
  "gpt-4.1": 32_768,
  "gpt-4.1-mini": 32_768,
  "gpt-4.1-nano": 32_768,
  "gpt-4o": 16_384,
  "gpt-4o-mini": 16_384,
  "o3": 100_000,
  "o3-mini": 100_000,
  "o4-mini": 100_000,
};

/**
 * Calculate cost for an OpenAI model and token usage.
 */
export function calculateOpenAICost(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number },
): number {
  const pricing = findOpenAIPricing(model);
  if (!pricing) return 0;

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheReadCost = (usage.cacheReadInputTokens / 1_000_000) * (pricing.cacheReadPerMillion ?? pricing.inputPerMillion);

  return inputCost + outputCost + cacheReadCost;
}

export function findOpenAIPricing(model: string): ModelPricing | undefined {
  // Exact match
  if (OPENAI_PRICING[model]) return OPENAI_PRICING[model];

  // Prefix match for dated variants (e.g., "gpt-4.1-mini-2025-04-14" → "gpt-4.1-mini")
  // Sort by key length descending so "gpt-4.1-mini" matches before "gpt-4.1"
  let bestKey = "";
  let bestPricing: ModelPricing | undefined;
  for (const [key, pricing] of Object.entries(OPENAI_PRICING)) {
    if (model.startsWith(key) && key.length > bestKey.length) {
      bestKey = key;
      bestPricing = pricing;
    }
  }

  return bestPricing;
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

export const GEMINI_PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-pro": {
    inputPerMillion: 1.25,
    outputPerMillion: 10.00,
    cacheReadPerMillion: 0.315,
  },
  "gemini-2.5-flash": {
    inputPerMillion: 0.15,
    outputPerMillion: 0.60,
    cacheReadPerMillion: 0.0375,
  },
  "gemini-2.5-flash-lite": {
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
  "gemini-2.0-flash": {
    inputPerMillion: 0.10,
    outputPerMillion: 0.40,
    cacheReadPerMillion: 0.025,
  },
  "gemini-2.0-flash-lite": {
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
};

export const GEMINI_CONTEXT_WINDOWS: Record<string, number> = {
  "gemini-2.5-pro": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-2.5-flash-lite": 1_048_576,
  "gemini-2.0-flash": 1_048_576,
  "gemini-2.0-flash-lite": 1_048_576,
};

export const GEMINI_MAX_OUTPUT: Record<string, number> = {
  "gemini-2.5-pro": 65_536,
  "gemini-2.5-flash": 65_536,
  "gemini-2.5-flash-lite": 65_536,
  "gemini-2.0-flash": 8_192,
  "gemini-2.0-flash-lite": 8_192,
};

/**
 * Calculate cost for a Gemini model and token usage.
 */
export function calculateGeminiCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number },
): number {
  const pricing = findGeminiPricing(model);
  if (!pricing) return 0;

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheReadCost = (usage.cacheReadInputTokens / 1_000_000) * (pricing.cacheReadPerMillion ?? pricing.inputPerMillion);

  return inputCost + outputCost + cacheReadCost;
}

export function findGeminiPricing(model: string): ModelPricing | undefined {
  // Exact match
  if (GEMINI_PRICING[model]) return GEMINI_PRICING[model];

  // Prefix match (e.g., "gemini-2.5-flash-preview-05-20" → "gemini-2.5-flash")
  let bestKey = "";
  let bestPricing: ModelPricing | undefined;
  for (const [key, pricing] of Object.entries(GEMINI_PRICING)) {
    if (model.startsWith(key) && key.length > bestKey.length) {
      bestKey = key;
      bestPricing = pricing;
    }
  }

  return bestPricing;
}
