/**
 * Provider registry — maps provider names to adapter instances.
 */

import type { ProviderAdapter } from "./types.ts";
import { AnthropicAdapter } from "./anthropic.ts";

const providers = new Map<string, ProviderAdapter>();

export function registerProvider(name: string, adapter: ProviderAdapter): void {
  providers.set(name, adapter);
}

export function getProvider(name: string, options?: { apiKey?: string; baseUrl?: string }): ProviderAdapter {
  // If custom options are provided, always create a fresh adapter
  if (!options?.apiKey && !options?.baseUrl) {
    const existing = providers.get(name);
    if (existing) return existing;
  }

  // Lazy-create built-in providers
  if (name === "anthropic") {
    const adapter = new AnthropicAdapter(options);
    if (!options?.apiKey && !options?.baseUrl) {
      providers.set(name, adapter);
    }
    return adapter;
  }

  throw new Error(`Unknown provider: "${name}". Register it with registerProvider() first.`);
}

export function listProviders(): string[] {
  return [...providers.keys()];
}
