/**
 * Compare fourmis-agents (OpenAI Codex/subscription) vs @anthropic-ai/claude-agent-sdk.
 *
 * Requires:
 *  - Stored OAuth tokens (run `bun src/auth/login-openai.ts` first)
 *  - OPENAI_API_KEY must NOT be set (so Codex mode activates)
 *  - Anthropic SDK auth (Claude Pro/Max subscription or ANTHROPIC_API_KEY)
 *
 * Usage: bun tests/compare/run-codex-vs-anthropic.ts
 */

import { query as fourmisQuery } from "../../src/index.ts";
import type { AgentMessage } from "../../src/index.ts";
import { query as anthropicQuery } from "@anthropic-ai/claude-agent-sdk";
import { isLoggedIn } from "../../src/auth/openai-oauth.ts";
import { scenarios } from "./scenarios/index.ts";

if (process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is set — unset it to use Codex/OAuth mode.");
  process.exit(1);
}

if (!isLoggedIn()) {
  console.error("Not logged in to OpenAI. Run: bun src/auth/login-openai.ts");
  process.exit(1);
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  sdk: string;
  textOutput: string;
  toolCalls: { name: string }[];
  turns: number;
  costUsd: number;
  durationMs: number;
  durationApiMs: number;
  timeToFirstToken: number;
  stopReason: string;
  errors: string[];
}

function emptyResult(sdk: string): RunResult {
  return {
    sdk,
    textOutput: "",
    toolCalls: [],
    turns: 0,
    costUsd: 0,
    durationMs: 0,
    durationApiMs: 0,
    timeToFirstToken: 0,
    stopReason: "unknown",
    errors: [],
  };
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function speedDelta(aMs: number, bMs: number): string {
  if (aMs === 0 || bMs === 0) return "";
  const ratio = bMs / aMs;
  if (ratio > 1.05) return `${ratio.toFixed(1)}x faster`;
  if (ratio < 0.95) return `${(1 / ratio).toFixed(1)}x slower`;
  return "~same";
}

// ─── Fourmis (OpenAI Codex) Runner ──────────────────────────────────────────

async function runFourmisCodex(scenario: typeof scenarios[0]): Promise<RunResult> {
  const result = emptyResult("fourmis (codex)");
  const start = performance.now();
  let firstTokenTime = 0;

  try {
    const conversation = fourmisQuery({
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
          if (!firstTokenTime) firstTokenTime = performance.now();
          result.textOutput += msg.text;
          break;
        case "stream":
          if (!firstTokenTime && msg.subtype === "text_delta") {
            firstTokenTime = performance.now();
          }
          break;
        case "tool_use":
          result.toolCalls.push({ name: msg.name });
          break;
        case "result":
          if (msg.subtype === "success") {
            result.turns = msg.turns;
            result.costUsd = msg.costUsd;
            result.durationMs = msg.durationMs;
            result.durationApiMs = msg.durationApiMs;
            result.stopReason = "success";
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

  const wallMs = Math.round(performance.now() - start);
  if (result.durationMs === 0) result.durationMs = wallMs;
  result.timeToFirstToken = firstTokenTime ? Math.round(firstTokenTime - start) : wallMs;

  return result;
}

// ─── Anthropic SDK Runner ───────────────────────────────────────────────────

async function runAnthropicSDK(scenario: typeof scenarios[0]): Promise<RunResult> {
  const result = emptyResult("anthropic-sdk");
  const start = performance.now();
  let firstTokenTime = 0;

  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const conversation = anthropicQuery({
      prompt: scenario.prompt,
      options: {
        model: scenario.model ?? "claude-sonnet-4-5-20250929",
        executable: "node",
        cwd: scenario.cwd ?? process.cwd(),
        maxTurns: scenario.maxTurns ?? 10,
        maxBudgetUsd: scenario.maxBudgetUsd ?? 0.50,
        permissionMode: "acceptEdits",
        settingSources: ["project", "local"],
      },
    });

    for await (const msg of conversation) {
      switch (msg.type) {
        case "assistant": {
          const content = (msg as any).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") {
                if (!firstTokenTime) firstTokenTime = performance.now();
                result.textOutput += block.text;
              } else if (block.type === "tool_use") {
                result.toolCalls.push({ name: block.name });
              }
            }
          }
          break;
        }
        case "result": {
          const r = msg as any;
          result.turns = r.num_turns ?? 0;
          result.costUsd = r.total_cost_usd ?? 0;
          result.durationMs = r.duration_ms ?? 0;
          result.durationApiMs = r.duration_api_ms ?? 0;
          result.stopReason = r.subtype ?? "unknown";
          if (r.errors) result.errors = r.errors;
          break;
        }
      }
    }
  } catch (err: any) {
    result.errors.push(err.message ?? String(err));
    result.stopReason = "exception";
  } finally {
    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
  }

  const wallMs = Math.round(performance.now() - start);
  if (result.durationMs === 0) result.durationMs = wallMs;
  result.timeToFirstToken = firstTokenTime ? Math.round(firstTokenTime - start) : wallMs;

  return result;
}

// ─── Comparison Table ───────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 3) + "...";
}

function printComparison(name: string, codex: RunResult, anthropic: RunResult): void {
  const d = "-".repeat(90);

  console.log(`\n${d}`);
  console.log(`  ${name}`);
  console.log(d);

  const rows: [string, string, string, string][] = [
    ["", "fourmis (codex)", "anthropic-sdk", ""],
    ["---", "---", "---", "---"],
    ["Status", codex.errors.length === 0 ? "OK" : "FAIL", anthropic.errors.length === 0 ? "OK" : "FAIL", ""],
    ["Stop Reason", codex.stopReason, anthropic.stopReason, codex.stopReason === anthropic.stopReason ? "=" : "DIFF"],
    ["Turns", String(codex.turns), String(anthropic.turns), ""],
    ["Cost", `$${codex.costUsd.toFixed(4)}`, `$${anthropic.costUsd.toFixed(4)}`, ""],
    ["Wall Time", fmtMs(codex.durationMs), fmtMs(anthropic.durationMs), speedDelta(codex.durationMs, anthropic.durationMs)],
    ["TTFT", fmtMs(codex.timeToFirstToken), fmtMs(anthropic.timeToFirstToken), speedDelta(codex.timeToFirstToken, anthropic.timeToFirstToken)],
    ["Tools", codex.toolCalls.map((t) => t.name).join(", ") || "(none)", anthropic.toolCalls.map((t) => t.name).join(", ") || "(none)", ""],
    ["Output", truncate(codex.textOutput.trim(), 45) || "(empty)", truncate(anthropic.textOutput.trim(), 45) || "(empty)", ""],
  ];

  if (codex.errors.length > 0 || anthropic.errors.length > 0) {
    rows.push([
      "Errors",
      codex.errors.length ? truncate(codex.errors.join("; "), 45) : "(none)",
      anthropic.errors.length ? truncate(anthropic.errors.join("; "), 45) : "(none)",
      "",
    ]);
  }

  const widths = [0, 0, 0, 0];
  for (const row of rows) {
    for (let i = 0; i < 4; i++) {
      widths[i] = Math.max(widths[i], row[i].length);
    }
  }

  for (const row of rows) {
    const line = row.map((cell, i) => cell.padEnd(widths[i])).join("  |  ");
    console.log(`  ${line}`);
  }
  console.log(d);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const divider = "=".repeat(90);

console.log(divider);
console.log("  fourmis-agents (OpenAI Codex / gpt-5.3-codex)  vs  @anthropic-ai/claude-agent-sdk");
console.log(divider);

const summary: { name: string; codexOk: boolean; anthropicOk: boolean }[] = [];

for (const scenario of scenarios) {
  console.log(`\n  >> ${scenario.name}`);

  if (scenario.setup) await scenario.setup();

  console.log(`     Running fourmis (codex)...`);
  const t1 = performance.now();
  const codex = await runFourmisCodex(scenario);
  console.log(`     Done in ${fmtMs(Math.round(performance.now() - t1))}`);

  console.log(`     Running anthropic-sdk...`);
  const t2 = performance.now();
  const anthropic = await runAnthropicSDK(scenario);
  console.log(`     Done in ${fmtMs(Math.round(performance.now() - t2))}`);

  if (scenario.teardown) await scenario.teardown();

  printComparison(scenario.name, codex, anthropic);

  summary.push({
    name: scenario.name,
    codexOk: codex.errors.length === 0,
    anthropicOk: anthropic.errors.length === 0,
  });
}

// Final summary
console.log(`\n${divider}`);
console.log("  SUMMARY");
console.log(divider);
for (const r of summary) {
  const c = r.codexOk ? "OK  " : "FAIL";
  const a = r.anthropicOk ? "OK  " : "FAIL";
  console.log(`  codex: ${c}  |  anthropic: ${a}  |  ${r.name}`);
}
console.log(divider);
