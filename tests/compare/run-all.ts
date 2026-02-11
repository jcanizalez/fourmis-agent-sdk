/**
 * Run all comparison scenarios sequentially.
 *
 * Usage: bun tests/compare/run-all.ts
 */
import { scenarios } from "./scenarios/index.ts";
import { compareSDKs } from "./runner.ts";

console.log("═".repeat(80));
console.log("  SDK Comparison: fourmis-agents vs @anthropic-ai/claude-agent-sdk");
console.log("═".repeat(80));

const results: { name: string; fourmisOk: boolean; anthropicOk: boolean }[] = [];

for (const scenario of scenarios) {
  try {
    const { fourmis, anthropic } = await compareSDKs(scenario);
    results.push({
      name: scenario.name,
      fourmisOk: fourmis.errors.length === 0,
      anthropicOk: anthropic.errors.length === 0,
    });
  } catch (err: any) {
    console.error(`\n  FATAL: Scenario "${scenario.name}" threw: ${err.message}`);
    results.push({
      name: scenario.name,
      fourmisOk: false,
      anthropicOk: false,
    });
  }
}

// Summary
console.log(`\n${"═".repeat(80)}`);
console.log("  SUMMARY");
console.log("═".repeat(80));
for (const r of results) {
  const f = r.fourmisOk ? "OK" : "FAIL";
  const a = r.anthropicOk ? "OK" : "FAIL";
  console.log(`  ${r.name}  →  fourmis: ${f}  |  anthropic: ${a}`);
}
console.log("═".repeat(80));
