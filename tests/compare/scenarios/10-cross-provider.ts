/**
 * Scenario 10: Cross-provider comparison.
 *
 * Runs the same prompt on fourmis with Anthropic vs fourmis with OpenAI.
 * Validates that the provider abstraction works end-to-end.
 *
 * Requires both ANTHROPIC_API_KEY and OPENAI_API_KEY to be set.
 *
 * Usage:
 *   OPENAI_API_KEY=... bun tests/compare/scenarios/10-cross-provider.ts
 */

import { query } from "../../../src/index.ts";
import type { AgentMessage } from "../../../src/index.ts";

interface ProviderResult {
  provider: string;
  textOutput: string;
  toolCalls: { name: string; input: unknown }[];
  turns: number;
  costUsd: number;
  durationMs: number;
  errors: string[];
}

async function runProvider(provider: string, model: string): Promise<ProviderResult> {
  const result: ProviderResult = {
    provider,
    textOutput: "",
    toolCalls: [],
    turns: 0,
    costUsd: 0,
    durationMs: 0,
    errors: [],
  };

  try {
    const conversation = query({
      prompt: "Read the file package.json in the current directory and tell me the project name and version. Be brief.",
      options: {
        provider,
        model,
        cwd: import.meta.dir + "/../../..",
        tools: "coding",
        maxTurns: 5,
        maxBudgetUsd: 0.20,
        permissionMode: "bypassPermissions",
      },
    });

    for await (const msg of conversation) {
      switch (msg.type) {
        case "text":
          result.textOutput += msg.text;
          break;
        case "tool_use":
          result.toolCalls.push({ name: msg.name, input: msg.input });
          break;
        case "result":
          if (msg.subtype === "success") {
            result.turns = msg.turns;
            result.costUsd = msg.costUsd;
            result.durationMs = msg.durationMs;
          } else {
            result.errors = (msg as any).errors ?? [];
          }
          break;
      }
    }
  } catch (err: any) {
    result.errors.push(err.message ?? String(err));
  }

  return result;
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set — skipping Anthropic run");
}
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY not set — skipping OpenAI run");
}

const divider = "─".repeat(80);
console.log(`\n${divider}`);
console.log("  CROSS-PROVIDER COMPARISON: Anthropic vs OpenAI");
console.log(divider);

const results: ProviderResult[] = [];

if (process.env.ANTHROPIC_API_KEY) {
  console.log("\n  → Running with Anthropic (claude-haiku-4-5-20251001)...");
  const anthropic = await runProvider("anthropic", "claude-haiku-4-5-20251001");
  results.push(anthropic);
  console.log(`    Done in ${fmtMs(anthropic.durationMs)} — cost: $${anthropic.costUsd.toFixed(4)}`);
}

if (process.env.OPENAI_API_KEY) {
  console.log("\n  → Running with OpenAI (gpt-4.1-mini)...");
  const openai = await runProvider("openai", "gpt-4.1-mini");
  results.push(openai);
  console.log(`    Done in ${fmtMs(openai.durationMs)} — cost: $${openai.costUsd.toFixed(4)}`);
}

console.log(`\n${divider}`);
console.log("  RESULTS");
console.log(divider);

for (const r of results) {
  console.log(`\n  [${r.provider}]`);
  console.log(`    Turns:      ${r.turns}`);
  console.log(`    Cost:       $${r.costUsd.toFixed(4)}`);
  console.log(`    Duration:   ${fmtMs(r.durationMs)}`);
  console.log(`    Tool Calls: ${r.toolCalls.map((t) => t.name).join(", ") || "(none)"}`);
  console.log(`    Output:     ${r.textOutput.trim().slice(0, 100)}`);
  if (r.errors.length > 0) {
    console.log(`    Errors:     ${r.errors.join("; ")}`);
  }
}

console.log(`\n${divider}\n`);
