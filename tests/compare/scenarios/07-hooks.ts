/**
 * Scenario 7: Hooks — test lifecycle callbacks in both SDKs.
 *
 * Hooks are natively in-process for fourmis-agents, but for the Anthropic SDK
 * they run in a subprocess. Both SDKs accept hooks via the same
 * Partial<Record<HookEvent, HookCallbackMatcher[]>> shape.
 *
 * Tests:
 *   A) PreToolUse hook that allows (observe tool calls)
 *   B) PreToolUse hook that denies a specific tool
 *   C) PostToolUse hook that observes results
 *   D) Side-by-side: both SDKs get a PreToolUse hook for logging
 *
 * Usage: bun tests/compare/scenarios/07-hooks.ts
 */
import { query as fourmisQuery } from "../../../src/index.ts";
import { query as anthropicQuery } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "../../../src/index.ts";
import type { HookInput, SyncHookJSONOutput } from "../../../src/hooks.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HookResult {
  label: string;
  sdk: "fourmis" | "anthropic";
  textOutput: string;
  toolCalls: { name: string }[];
  toolResults: { name: string; content: string; isError?: boolean }[];
  hookEvents: string[];
  stopReason: string;
  errors: string[];
  durationMs: number;
}

function emptyResult(label: string, sdk: "fourmis" | "anthropic"): HookResult {
  return {
    label, sdk, textOutput: "", toolCalls: [], toolResults: [],
    hookEvents: [], stopReason: "unknown", errors: [], durationMs: 0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CWD = import.meta.dir + "/../../..";

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 3) + "...";
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function speedDelta(a: number, b: number): string {
  if (a === 0 || b === 0) return "";
  const ratio = b / a;
  if (ratio > 1) return `  (fourmis ${ratio.toFixed(1)}x faster)`;
  if (ratio < 1) return `  (anthropic ${(1 / ratio).toFixed(1)}x faster)`;
  return "  (same)";
}

function printTable(rows: string[][]): void {
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map((r) => r[i].length)),
  );
  for (const row of rows) {
    console.log(`  ${row.map((c, i) => c.padEnd(widths[i])).join("  │  ")}`);
  }
}

// ─── Fourmis Runner ───────────────────────────────────────────────────────────

async function runFourmisHooks(
  label: string,
  prompt: string,
  hookEvents: string[],
  hookConfig: any,
): Promise<HookResult> {
  const result = emptyResult(label, "fourmis");
  const start = performance.now();

  try {
    const conversation = fourmisQuery({
      prompt,
      options: {
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        cwd: CWD,
        tools: "coding",
        maxTurns: 5,
        maxBudgetUsd: 0.30,
        permissionMode: "bypassPermissions",
        hooks: hookConfig,
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
        case "tool_result":
          result.toolResults.push({
            name: msg.name,
            content: msg.content,
            isError: msg.isError,
          });
          break;
        case "result":
          result.stopReason = msg.subtype;
          if ("errors" in msg) result.errors = (msg as any).errors ?? [];
          break;
      }
    }
  } catch (err: any) {
    result.errors.push(err.message ?? String(err));
    result.stopReason = "exception";
  }

  result.hookEvents = [...hookEvents];
  result.durationMs = Math.round(performance.now() - start);
  return result;
}

// ─── Anthropic Runner ─────────────────────────────────────────────────────────

async function runAnthropicHooks(
  label: string,
  prompt: string,
  hookEvents: string[],
  hookConfig: any,
): Promise<HookResult> {
  const result = emptyResult(label, "anthropic");
  const start = performance.now();

  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const conversation = anthropicQuery({
      prompt,
      options: {
        model: "claude-sonnet-4-5-20250929",
        executable: "node",
        cwd: CWD,
        maxTurns: 5,
        maxBudgetUsd: 0.30,
        permissionMode: "acceptEdits",
        hooks: hookConfig,
      },
    });

    for await (const msg of conversation) {
      switch (msg.type) {
        case "assistant": {
          const content = (msg as any).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") result.textOutput += block.text;
              if (block.type === "tool_use") result.toolCalls.push({ name: block.name });
            }
          }
          break;
        }
        case "result": {
          const r = msg as any;
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

  result.hookEvents = [...hookEvents];
  result.durationMs = Math.round(performance.now() - start);
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(90));
console.log("  SCENARIO 07: Hooks (lifecycle callbacks)");
console.log("═".repeat(90));

const PROMPT = "Read the file package.json in the current directory and tell me the project name. Be brief.";

// ─── Part 1: Fourmis-only hook tests ─────────────────────────────────────────

console.log("\n  PART 1: Fourmis-agents Hook Tests");
console.log("  " + "─".repeat(50));

// Test A: PreToolUse observes tool calls (allow)
const observedToolsA: string[] = [];
const hookEventsA: string[] = [];
console.log("\n  → Test A: PreToolUse hook observes tool calls (allow)...");
const resultA = await runFourmisHooks("PreToolUse observe", PROMPT, hookEventsA, {
  PreToolUse: [{
    hooks: [async (input: HookInput) => {
      hookEventsA.push(`PreToolUse:${input.tool_name}`);
      return {};  // allow
    }],
  }],
});
console.log(`    ✓ Done in ${fmtMs(resultA.durationMs)}`);
console.log(`    Hook events: ${hookEventsA.join(", ") || "(none)"}`);

// Test B: PreToolUse denies Bash
const hookEventsB: string[] = [];
console.log("\n  → Test B: PreToolUse hook denies Bash...");
const resultB = await runFourmisHooks(
  "PreToolUse deny Bash",
  "Run the command 'echo test' using Bash and tell me the output. Be brief.",
  hookEventsB,
  {
    PreToolUse: [{
      matcher: "^Bash$",
      hooks: [async (input: HookInput) => {
        hookEventsB.push(`PreToolUse:DENY:${input.tool_name}`);
        return { permissionDecision: "deny" as const };
      }],
    }],
  },
);
console.log(`    ✓ Done in ${fmtMs(resultB.durationMs)}`);
console.log(`    Hook events: ${hookEventsB.join(", ") || "(none)"}`);

// Test C: PostToolUse observes results
const hookEventsC: string[] = [];
console.log("\n  → Test C: PostToolUse hook observes results...");
const resultC = await runFourmisHooks("PostToolUse observe", PROMPT, hookEventsC, {
  PostToolUse: [{
    hooks: [async (input: HookInput) => {
      hookEventsC.push(`PostToolUse:${input.tool_name}:${(input.tool_result ?? "").substring(0, 30)}`);
      return {};
    }],
  }],
});
console.log(`    ✓ Done in ${fmtMs(resultC.durationMs)}`);
console.log(`    Hook events: ${hookEventsC.join(", ") || "(none)"}`);

// Part 1 summary
const divider = "─".repeat(90);
console.log(`\n${divider}`);

printTable([
  ["Field", "A: PreToolUse Observe", "B: PreToolUse Deny", "C: PostToolUse Observe"],
  ["─────", "─────────────────────", "───────────────────", "──────────────────────"],
  ["Stop Reason", resultA.stopReason, resultB.stopReason, resultC.stopReason],
  ["Tool Calls", resultA.toolCalls.map((t) => t.name).join(", ") || "(none)", resultB.toolCalls.map((t) => t.name).join(", ") || "(none)", resultC.toolCalls.map((t) => t.name).join(", ") || "(none)"],
  ["Hook Events", hookEventsA.join(", ").substring(0, 35) || "(none)", hookEventsB.join(", ").substring(0, 35) || "(none)", hookEventsC.join(", ").substring(0, 35) || "(none)"],
  ["Duration", fmtMs(resultA.durationMs), fmtMs(resultB.durationMs), fmtMs(resultC.durationMs)],
  ["Text Output", truncate(resultA.textOutput.trim(), 35) || "(empty)", truncate(resultB.textOutput.trim(), 35) || "(empty)", truncate(resultC.textOutput.trim(), 35) || "(empty)"],
  ["Errors", resultA.errors.length ? truncate(resultA.errors.join("; "), 35) : "(none)", resultB.errors.length ? truncate(resultB.errors.join("; "), 35) : "(none)", resultC.errors.length ? truncate(resultC.errors.join("; "), 35) : "(none)"],
]);

console.log(divider);

// ─── Part 2: Side-by-side hooks comparison ───────────────────────────────────

console.log("\n  PART 2: Side-by-Side Hooks Comparison (fourmis vs anthropic)");
console.log("  " + "─".repeat(50));

// Both SDKs use PreToolUse hook that logs tool calls
const fourmisHookEvents: string[] = [];
const anthropicHookEvents: string[] = [];

// The hook callback — same shape for both SDKs
const loggingHookConfig = {
  PreToolUse: [{
    hooks: [async (input: any, _toolUseId: any) => {
      return {};  // allow — just observe
    }],
  }],
};

console.log("\n  → Test D (fourmis): PreToolUse logging hook...");
const fourmisD = await runFourmisHooks("fourmis hooks", PROMPT, fourmisHookEvents, {
  PreToolUse: [{
    hooks: [async (input: HookInput) => {
      fourmisHookEvents.push(`PreToolUse:${input.tool_name}`);
      return {};
    }],
  }],
});
console.log(`    ✓ Done in ${fmtMs(fourmisD.durationMs)} — hooks: ${fourmisHookEvents.join(", ")}`);

console.log("\n  → Test D (anthropic): PreToolUse logging hook...");
const anthropicD = await runAnthropicHooks("anthropic hooks", PROMPT, anthropicHookEvents, {
  PreToolUse: [{
    hooks: [async (input: any) => {
      anthropicHookEvents.push(`PreToolUse:${input?.tool_name ?? "?"}`);
      return {};
    }],
  }],
});
console.log(`    ✓ Done in ${fmtMs(anthropicD.durationMs)} — hooks: ${anthropicHookEvents.join(", ")}`);

// Side-by-side comparison
console.log(`\n${divider}`);
console.log(`  COMPARISON: PreToolUse Logging Hook`);
console.log(divider);

printTable([
  ["Field", "fourmis-agents", "anthropic-sdk", "Delta"],
  ["─────", "──────────────", "──────────────", "─────"],
  ["Stop Reason", fourmisD.stopReason, anthropicD.stopReason, fourmisD.stopReason === anthropicD.stopReason ? "=" : "DIFF"],
  ["Tool Calls", fourmisD.toolCalls.map((t) => t.name).join(", ") || "(none)", anthropicD.toolCalls.map((t) => t.name).join(", ") || "(none)", fourmisD.toolCalls.length === anthropicD.toolCalls.length ? "=" : "DIFF"],
  ["Hook Events", fourmisD.hookEvents.join(", ").substring(0, 40) || "(none)", anthropicD.hookEvents.join(", ").substring(0, 40) || "(none)", fourmisD.hookEvents.length === anthropicD.hookEvents.length ? "=" : "DIFF"],
  ["Wall Time", fmtMs(fourmisD.durationMs), fmtMs(anthropicD.durationMs), speedDelta(fourmisD.durationMs, anthropicD.durationMs)],
  ["Text Output", truncate(fourmisD.textOutput.trim(), 40) || "(empty)", truncate(anthropicD.textOutput.trim(), 40) || "(empty)", ""],
  ["Errors", fourmisD.errors.length ? truncate(fourmisD.errors.join("; "), 40) : "(none)", anthropicD.errors.length ? truncate(anthropicD.errors.join("; "), 40) : "(none)", ""],
]);

console.log(divider);

// ─── Assertions ──────────────────────────────────────────────────────────────

const pass = (label: string, ok: boolean) => console.log(`  ${ok ? "✓" : "✗"} ${label}`);

console.log("\n  Assertions:");

// Part 1
pass("A: Hook events were fired", hookEventsA.length > 0);
pass("A: Hook observed at least one tool", hookEventsA.some((e) => e.startsWith("PreToolUse:")));
pass("A: Success result", resultA.stopReason === "success");

pass("B: Bash was denied by hook", hookEventsB.some((e) => e.includes("DENY")));
pass("B: Tool result shows denial", resultB.toolResults.some((r) => r.isError || (r.content ?? "").includes("Denied")));

pass("C: PostToolUse hook fired", hookEventsC.length > 0);
pass("C: Hook captured tool result", hookEventsC.some((e) => e.startsWith("PostToolUse:")));

// Part 2
pass("D (fourmis): Hooks fired", fourmisD.hookEvents.length > 0);
pass("D (fourmis): Used Read tool", fourmisD.toolCalls.some((t) => t.name === "Read"));
pass("D (anthropic): Used Read tool", anthropicD.toolCalls.some((t) => t.name === "Read"));
pass("D: Both completed successfully", fourmisD.stopReason === "success" && (anthropicD.stopReason === "success" || anthropicD.stopReason === "end_turn"));

console.log("═".repeat(90));
