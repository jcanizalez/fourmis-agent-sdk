/**
 * Run comparison scenarios 01-05 using the OpenAI Codex provider (subscription auth).
 *
 * Requires stored OAuth tokens (run `bun src/auth/login-openai.ts` first).
 * Must NOT have OPENAI_API_KEY set (API key takes priority over Codex mode).
 *
 * Usage: bun tests/compare/run-openai-codex.ts
 */

import { query } from "../../src/index.ts";
import type { AgentMessage } from "../../src/index.ts";
import { isLoggedIn } from "../../src/auth/openai-oauth.ts";
import { scenarios } from "./scenarios/index.ts";

if (process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is set — unset it to use Codex/OAuth mode.");
  process.exit(1);
}

if (!isLoggedIn()) {
  console.error("Not logged in. Run: bun src/auth/login-openai.ts");
  process.exit(1);
}

interface ScenarioResult {
  name: string;
  ok: boolean;
  textOutput: string;
  toolCalls: { name: string }[];
  turns: number;
  costUsd: number;
  durationMs: number;
  stopReason: string;
  errors: string[];
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

async function runScenario(scenario: typeof scenarios[0]): Promise<ScenarioResult> {
  const result: ScenarioResult = {
    name: scenario.name,
    ok: false,
    textOutput: "",
    toolCalls: [],
    turns: 0,
    costUsd: 0,
    durationMs: 0,
    stopReason: "unknown",
    errors: [],
  };

  try {
    const conversation = query({
      prompt: scenario.prompt,
      options: {
        provider: "openai",
        model: "gpt-5.3-codex",
        cwd: scenario.cwd ?? process.cwd(),
        tools: scenario.tools ?? "coding",
        maxTurns: scenario.maxTurns ?? 10,
        maxBudgetUsd: scenario.maxBudgetUsd ?? 0.50,
        permissionMode: "bypassPermissions",
      },
    });

    for await (const msg of conversation) {
      switch (msg.type) {
        case "text":
          result.textOutput += msg.text;
          break;
        case "tool_use":
          result.toolCalls.push({ name: msg.name });
          break;
        case "result":
          if (msg.subtype === "success") {
            result.turns = msg.turns;
            result.costUsd = msg.costUsd;
            result.durationMs = msg.durationMs;
            result.stopReason = "success";
            result.ok = true;
          } else {
            result.turns = (msg as any).turns ?? 0;
            result.costUsd = (msg as any).costUsd ?? 0;
            result.durationMs = (msg as any).durationMs ?? 0;
            result.stopReason = msg.subtype;
            result.errors = (msg as any).errors ?? [];
          }
          break;
      }
    }
  } catch (err: any) {
    result.errors.push(err.message ?? String(err));
    result.stopReason = "exception";
  }

  return result;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const divider = "=".repeat(80);

console.log(divider);
console.log("  OpenAI Codex Provider — Scenario Tests (gpt-5.3-codex)");
console.log(divider);

const results: ScenarioResult[] = [];

for (const scenario of scenarios) {
  console.log(`\n  -> ${scenario.name}...`);

  if (scenario.setup) await scenario.setup();

  const start = performance.now();
  const result = await runScenario(scenario);
  const wallMs = Math.round(performance.now() - start);

  if (scenario.teardown) await scenario.teardown();

  results.push(result);

  const status = result.ok ? "OK" : "FAIL";
  const tools = result.toolCalls.map((t) => t.name).join(", ") || "(none)";
  console.log(`     ${status} | ${fmtMs(wallMs)} | turns: ${result.turns} | cost: $${result.costUsd.toFixed(4)} | tools: ${tools}`);
  if (result.textOutput) {
    console.log(`     Output: ${result.textOutput.trim().slice(0, 120)}`);
  }
  if (result.errors.length > 0) {
    console.log(`     Errors: ${result.errors.join("; ")}`);
  }
}

// Summary
console.log(`\n${divider}`);
console.log("  SUMMARY");
console.log(divider);

let passed = 0;
let failed = 0;
for (const r of results) {
  const status = r.ok ? "OK  " : "FAIL";
  console.log(`  [${status}] ${r.name}`);
  if (r.ok) passed++;
  else failed++;
}

console.log(`\n  ${passed} passed, ${failed} failed, ${results.length} total`);
console.log(divider);

if (failed > 0) process.exit(1);
