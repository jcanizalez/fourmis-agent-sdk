/**
 * Side-by-side SDK comparison harness.
 *
 * Runs the same prompt on both fourmis-agents and @anthropic-ai/claude-agent-sdk,
 * normalizes results into a common shape, and prints a comparison table.
 */

import { query as fourmisQuery } from "../../src/index.ts";
import type { AgentMessage } from "../../src/index.ts";
import { query as anthropicQuery } from "@anthropic-ai/claude-agent-sdk";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Scenario {
  name: string;
  prompt: string;
  cwd?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  model?: string;
  tools?: string | string[];
  hooks?: any;
  mcpServers?: Record<string, any>;
  agents?: Record<string, any>;
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
}

export interface CompareResult {
  sdk: "fourmis" | "anthropic";
  textOutput: string;
  toolCalls: { name: string; input: unknown }[];
  toolResults: { name: string; content: string; isError?: boolean }[];
  turns: number;
  costUsd: number;
  durationMs: number;        // total wall-clock time
  durationApiMs: number;     // API-only time (if reported by SDK)
  timeToFirstToken: number;  // ms from start to first text output
  stopReason: string;
  errors: string[];
}

function emptyResult(sdk: "fourmis" | "anthropic"): CompareResult {
  return {
    sdk,
    textOutput: "",
    toolCalls: [],
    toolResults: [],
    turns: 0,
    costUsd: 0,
    durationMs: 0,
    durationApiMs: 0,
    timeToFirstToken: 0,
    stopReason: "unknown",
    errors: [],
  };
}

// ─── Fourmis Runner ─────────────────────────────────────────────────────────

async function runFourmis(scenario: Scenario): Promise<CompareResult> {
  const result = emptyResult("fourmis");
  const start = performance.now();
  let firstTokenTime = 0;

  try {
    const conversation = fourmisQuery({
      prompt: scenario.prompt,
      options: {
        provider: "anthropic",
        model: scenario.model ?? "claude-sonnet-4-5-20250929",
        cwd: scenario.cwd ?? process.cwd(),
        tools: scenario.tools ?? "coding",
        maxTurns: scenario.maxTurns ?? 10,
        maxBudgetUsd: scenario.maxBudgetUsd ?? 0.50,
        permissionMode: "bypassPermissions",
        hooks: scenario.hooks,
        mcpServers: scenario.mcpServers,
        agents: scenario.agents,
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
          result.toolCalls.push({ name: msg.name, input: msg.input });
          break;
        case "tool_result":
          result.toolResults.push({
            name: msg.name,
            content: msg.content,
            isError: msg.isError,
          });
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

async function runAnthropic(scenario: Scenario): Promise<CompareResult> {
  const result = emptyResult("anthropic");
  const start = performance.now();
  let firstTokenTime = 0;

  // Strip the OAuth setup-token from env so Claude Code subprocess
  // uses its own stored auth instead of treating it as a regular API key.
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
        hooks: scenario.hooks,
        mcpServers: scenario.mcpServers,
        agents: scenario.agents,
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
                result.toolCalls.push({
                  name: block.name,
                  input: block.input,
                });
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
          if (r.errors) {
            result.errors = r.errors;
          }
          break;
        }
      }
    }
  } catch (err: any) {
    result.errors.push(err.message ?? String(err));
    result.stopReason = "exception";
  } finally {
    // Restore the API key for fourmis-agents usage
    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
  }

  const wallMs = Math.round(performance.now() - start);
  if (result.durationMs === 0) result.durationMs = wallMs;
  result.timeToFirstToken = firstTokenTime ? Math.round(firstTokenTime - start) : wallMs;

  return result;
}

// ─── Comparison Table ───────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function speedDelta(fourmisMs: number, anthropicMs: number): string {
  if (anthropicMs === 0 || fourmisMs === 0) return "";
  const ratio = anthropicMs / fourmisMs;
  if (ratio > 1) return `  (fourmis ${ratio.toFixed(1)}x faster)`;
  if (ratio < 1) return `  (anthropic ${(1 / ratio).toFixed(1)}x faster)`;
  return "  (same)";
}

function printComparison(scenario: Scenario, fourmis: CompareResult, anthropic: CompareResult): void {
  const divider = "─".repeat(90);

  console.log(`\n${divider}`);
  console.log(`  SCENARIO: ${scenario.name}`);
  console.log(`  PROMPT: "${truncate(scenario.prompt, 70)}"`);
  console.log(divider);

  const rows: [string, string, string, string][] = [
    ["Field", "fourmis-agents", "anthropic-sdk", "Delta"],
    ["─────", "──────────────", "──────────────", "─────"],
    ["Stop Reason", fourmis.stopReason, anthropic.stopReason, fourmis.stopReason === anthropic.stopReason ? "=" : "DIFF"],
    ["Turns", String(fourmis.turns), String(anthropic.turns), fourmis.turns === anthropic.turns ? "=" : "DIFF"],
    ["Cost (USD)", `$${fourmis.costUsd.toFixed(4)}`, `$${anthropic.costUsd.toFixed(4)}`, ""],
    ["Wall Time", fmtMs(fourmis.durationMs), fmtMs(anthropic.durationMs), speedDelta(fourmis.durationMs, anthropic.durationMs)],
    ["API Time", fmtMs(fourmis.durationApiMs), fmtMs(anthropic.durationApiMs), ""],
    ["Time to First Token", fmtMs(fourmis.timeToFirstToken), fmtMs(anthropic.timeToFirstToken), speedDelta(fourmis.timeToFirstToken, anthropic.timeToFirstToken)],
    ["Tool Calls", String(fourmis.toolCalls.length), String(anthropic.toolCalls.length), fourmis.toolCalls.length === anthropic.toolCalls.length ? "=" : "DIFF"],
    [
      "Tools Used",
      fourmis.toolCalls.map((t) => t.name).join(", ") || "(none)",
      anthropic.toolCalls.map((t) => t.name).join(", ") || "(none)",
      "",
    ],
    [
      "Text Output",
      truncate(fourmis.textOutput.trim(), 50) || "(empty)",
      truncate(anthropic.textOutput.trim(), 50) || "(empty)",
      "",
    ],
    [
      "Errors",
      fourmis.errors.length ? truncate(fourmis.errors.join("; "), 50) : "(none)",
      anthropic.errors.length ? truncate(anthropic.errors.join("; "), 50) : "(none)",
      "",
    ],
  ];

  // Calculate column widths
  const widths = [0, 0, 0, 0];
  for (const row of rows) {
    for (let i = 0; i < 4; i++) {
      widths[i] = Math.max(widths[i], row[i].length);
    }
  }

  for (const row of rows) {
    const line = row.map((cell, i) => cell.padEnd(widths[i])).join("  │  ");
    console.log(`  ${line}`);
  }

  // Show tool call details if different
  if (fourmis.toolCalls.length > 0 || anthropic.toolCalls.length > 0) {
    console.log(`\n  Tool Call Details:`);
    const maxLen = Math.max(fourmis.toolCalls.length, anthropic.toolCalls.length);
    for (let i = 0; i < maxLen; i++) {
      const f = fourmis.toolCalls[i];
      const a = anthropic.toolCalls[i];
      console.log(`    [${i + 1}] fourmis: ${f ? f.name : "(none)"}  |  anthropic: ${a ? a.name : "(none)"}`);
    }
  }

  console.log(divider);
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function compareSDKs(scenario: Scenario): Promise<{
  fourmis: CompareResult;
  anthropic: CompareResult;
}> {
  console.log(`\n🔄 Running scenario: ${scenario.name}...`);

  if (scenario.setup) {
    await scenario.setup();
  }

  // Run both SDKs sequentially (to avoid API rate limits)
  console.log(`  → Running fourmis-agents...`);
  const t1 = performance.now();
  const fourmis = await runFourmis(scenario);
  console.log(`    ✓ Done in ${fmtMs(Math.round(performance.now() - t1))} (cost: $${fourmis.costUsd.toFixed(4)}, ttft: ${fmtMs(fourmis.timeToFirstToken)})`);

  console.log(`  → Running anthropic-sdk...`);
  const t2 = performance.now();
  const anthropic = await runAnthropic(scenario);
  console.log(`    ✓ Done in ${fmtMs(Math.round(performance.now() - t2))} (cost: $${anthropic.costUsd.toFixed(4)}, ttft: ${fmtMs(anthropic.timeToFirstToken)})`);

  printComparison(scenario, fourmis, anthropic);

  if (scenario.teardown) {
    await scenario.teardown();
  }

  return { fourmis, anthropic };
}

/** Run a single scenario standalone (for individual scenario files) */
export async function runScenario(scenario: Scenario): Promise<void> {
  await compareSDKs(scenario);
}
