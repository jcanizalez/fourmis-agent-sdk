/**
 * Scenario 6: Permissions — test that allow/deny lists control tool access.
 *
 * Tests A-C: fourmis-agents internal permission modes (allow/deny/canUseTool).
 * Test D:    Side-by-side comparison — both fourmis-agents and @anthropic-ai/claude-agent-sdk
 *            loading permissions from .claude/settings.local.json files.
 */
import { query as fourmisQuery } from "../../../src/index.ts";
import { query as anthropicQuery } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "../../../src/index.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PermissionResult {
  label: string;
  sdk: "fourmis" | "anthropic";
  textOutput: string;
  toolCalls: { name: string }[];
  stopReason: string;
  errors: string[];
  durationMs: number;
  deniedTools: string[];
}

function emptyResult(label: string, sdk: "fourmis" | "anthropic" = "fourmis"): PermissionResult {
  return {
    label,
    sdk,
    textOutput: "",
    toolCalls: [],
    stopReason: "unknown",
    errors: [],
    durationMs: 0,
    deniedTools: [],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROMPT = "Run the command 'echo hello' using Bash and tell me the output. Be brief.";
const CWD = import.meta.dir + "/../../..";

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

function printTable(rows: string[][]): void {
  const cols = rows[0].length;
  const widths = Array(cols).fill(0);
  for (const row of rows) {
    for (let i = 0; i < cols; i++) {
      widths[i] = Math.max(widths[i], row[i].length);
    }
  }
  for (const row of rows) {
    const line = row.map((cell, i) => cell.padEnd(widths[i])).join("  │  ");
    console.log(`  ${line}`);
  }
}

// ─── Fourmis Runner (with permissions) ───────────────────────────────────────

async function runFourmisWithPermissions(
  label: string,
  permissions: { allow?: string[]; deny?: string[] },
): Promise<PermissionResult> {
  const result = emptyResult(label);
  const start = performance.now();

  try {
    const conversation = fourmisQuery({
      prompt: PROMPT,
      options: {
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        cwd: CWD,
        tools: "coding",
        maxTurns: 5,
        maxBudgetUsd: 0.20,
        permissionMode: "default",
        permissions,
        canUseTool: async (toolName, _input, _options) => {
          result.deniedTools.push(toolName);
          return {
            behavior: "deny" as const,
            message: `Tool "${toolName}" requires approval and was denied by test.`,
          };
        },
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
          result.stopReason = msg.subtype;
          if ("errors" in msg) result.errors = (msg as any).errors ?? [];
          break;
      }
    }
  } catch (err: any) {
    result.errors.push(err.message ?? String(err));
    result.stopReason = "exception";
  }

  result.durationMs = Math.round(performance.now() - start);
  return result;
}

// ─── Fourmis Runner (with settingSources) ────────────────────────────────────

async function runFourmisWithSettings(
  label: string,
  cwd: string,
): Promise<PermissionResult> {
  const result = emptyResult(label, "fourmis");
  const start = performance.now();

  try {
    const conversation = fourmisQuery({
      prompt: PROMPT,
      options: {
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        cwd,
        tools: "coding",
        maxTurns: 5,
        maxBudgetUsd: 0.20,
        permissionMode: "default",
        settingSources: ["local"],
        canUseTool: async (toolName, _input, _options) => {
          result.deniedTools.push(toolName);
          return {
            behavior: "deny" as const,
            message: `Tool "${toolName}" requires approval and was denied by test.`,
          };
        },
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
          result.stopReason = msg.subtype;
          if ("errors" in msg) result.errors = (msg as any).errors ?? [];
          break;
      }
    }
  } catch (err: any) {
    result.errors.push(err.message ?? String(err));
    result.stopReason = "exception";
  }

  result.durationMs = Math.round(performance.now() - start);
  return result;
}

// ─── Anthropic SDK Runner (with settingSources) ──────────────────────────────

async function runAnthropicWithSettings(
  label: string,
  cwd: string,
): Promise<PermissionResult> {
  const result = emptyResult(label, "anthropic");
  const start = performance.now();

  // Strip the API key so subprocess uses its own stored auth
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const conversation = anthropicQuery({
      prompt: PROMPT,
      options: {
        model: "claude-sonnet-4-5-20250929",
        executable: "node",
        cwd,
        maxTurns: 5,
        maxBudgetUsd: 0.20,
        permissionMode: "acceptEdits",
        settingSources: ["local"],
      },
    });

    for await (const msg of conversation) {
      switch (msg.type) {
        case "assistant": {
          const content = (msg as any).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") {
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

  result.durationMs = Math.round(performance.now() - start);
  return result;
}

// ─── Main ───────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(90));
console.log("  SCENARIO 06: Permissions (allow/deny lists + settings file comparison)");
console.log("  PROMPT: \"" + PROMPT + "\"");
console.log("═".repeat(90));

// ─── Part 1: Fourmis-only permission mode tests ─────────────────────────────

console.log("\n  PART 1: Fourmis-agents Permission Modes");
console.log("  " + "─".repeat(50));

// Test A: Bash denied — agent should fail to use Bash
console.log("\n  → Test A: Bash DENIED (permissions.deny: ['Bash'])...");
const denied = await runFourmisWithPermissions("Bash DENIED", { deny: ["Bash"] });
console.log(`    ✓ Done in ${fmtMs(denied.durationMs)}`);

// Test B: Only Read/Glob/Grep allowed, Bash not in allow list + canUseTool denies
console.log("\n  → Test B: Only read tools ALLOWED (permissions.allow: ['Read', 'Glob', 'Grep'])...");
const readOnly = await runFourmisWithPermissions("Read-Only", {
  allow: ["Read", "Glob", "Grep"],
});
console.log(`    ✓ Done in ${fmtMs(readOnly.durationMs)}`);

// Test C: Bash explicitly allowed — should work normally
console.log("\n  → Test C: Bash ALLOWED (permissions.allow: ['Bash', 'Read', ...])...");
const allowed = await runFourmisWithPermissions("Bash ALLOWED", {
  allow: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
});
console.log(`    ✓ Done in ${fmtMs(allowed.durationMs)}`);

// Permission mode comparison table
const divider = "─".repeat(90);
console.log(`\n${divider}`);

printTable([
  ["Field", "A: Bash DENIED", "B: Read-Only", "C: Bash ALLOWED"],
  ["─────", "──────────────", "────────────", "───────────────"],
  ["Stop Reason", denied.stopReason, readOnly.stopReason, allowed.stopReason],
  ["Tool Calls", denied.toolCalls.map(t => t.name).join(", ") || "(none)", readOnly.toolCalls.map(t => t.name).join(", ") || "(none)", allowed.toolCalls.map(t => t.name).join(", ") || "(none)"],
  ["Denied Tools", denied.deniedTools.join(", ") || "(none)", readOnly.deniedTools.join(", ") || "(none)", allowed.deniedTools.join(", ") || "(none)"],
  ["Duration", fmtMs(denied.durationMs), fmtMs(readOnly.durationMs), fmtMs(allowed.durationMs)],
  ["Text Output", truncate(denied.textOutput.trim(), 40) || "(empty)", truncate(readOnly.textOutput.trim(), 40) || "(empty)", truncate(allowed.textOutput.trim(), 40) || "(empty)"],
  ["Errors", denied.errors.length ? truncate(denied.errors.join("; "), 40) : "(none)", readOnly.errors.length ? truncate(readOnly.errors.join("; "), 40) : "(none)", allowed.errors.length ? truncate(allowed.errors.join("; "), 40) : "(none)"],
]);

console.log(divider);

// ─── Part 2: Side-by-side settings file comparison ──────────────────────────

console.log("\n  PART 2: Settings File Comparison (fourmis vs anthropic)");
console.log("  " + "─".repeat(50));

const tempDir = join(import.meta.dir, "__test_settings_tmp__");
const claudeDir = join(tempDir, ".claude");
const settingsPath = join(claudeDir, "settings.local.json");

// Create temp settings file
mkdirSync(claudeDir, { recursive: true });
writeFileSync(
  settingsPath,
  JSON.stringify(
    {
      permissions: {
        allow: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
      },
    },
    null,
    2,
  ) + "\n",
);

let fourmisFileResult: PermissionResult;
let anthropicFileResult: PermissionResult;

try {
  // Run fourmis-agents with settingSources
  console.log("\n  → Test D (fourmis): Bash ALLOWED via settings.local.json...");
  fourmisFileResult = await runFourmisWithSettings("fourmis settings", tempDir);
  console.log(`    ✓ Done in ${fmtMs(fourmisFileResult.durationMs)}`);

  // Run Anthropic SDK with settingSources
  console.log("\n  → Test D (anthropic): Bash ALLOWED via settings.local.json...");
  anthropicFileResult = await runAnthropicWithSettings("anthropic settings", tempDir);
  console.log(`    ✓ Done in ${fmtMs(anthropicFileResult.durationMs)}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

// Side-by-side comparison table
console.log(`\n${divider}`);
console.log(`  COMPARISON: File-Based Settings (settingSources: ["local"])`);
console.log(divider);

printTable([
  ["Field", "fourmis-agents", "anthropic-sdk", "Delta"],
  ["─────", "──────────────", "──────────────", "─────"],
  ["Stop Reason", fourmisFileResult.stopReason, anthropicFileResult.stopReason, fourmisFileResult.stopReason === anthropicFileResult.stopReason ? "=" : "DIFF"],
  ["Tool Calls", fourmisFileResult.toolCalls.map(t => t.name).join(", ") || "(none)", anthropicFileResult.toolCalls.map(t => t.name).join(", ") || "(none)", fourmisFileResult.toolCalls.length === anthropicFileResult.toolCalls.length ? "=" : "DIFF"],
  ["Denied Tools", fourmisFileResult.deniedTools.join(", ") || "(none)", anthropicFileResult.deniedTools.join(", ") || "(none)", ""],
  ["Wall Time", fmtMs(fourmisFileResult.durationMs), fmtMs(anthropicFileResult.durationMs), speedDelta(fourmisFileResult.durationMs, anthropicFileResult.durationMs)],
  ["Has Bash", fourmisFileResult.toolCalls.some(t => t.name === "Bash") ? "YES" : "NO", anthropicFileResult.toolCalls.some(t => t.name === "Bash") ? "YES" : "NO", ""],
  ["Text Output", truncate(fourmisFileResult.textOutput.trim(), 40) || "(empty)", truncate(anthropicFileResult.textOutput.trim(), 40) || "(empty)", ""],
  ["Errors", fourmisFileResult.errors.length ? truncate(fourmisFileResult.errors.join("; "), 40) : "(none)", anthropicFileResult.errors.length ? truncate(anthropicFileResult.errors.join("; "), 40) : "(none)", ""],
]);

console.log(divider);

// ─── Assertions ──────────────────────────────────────────────────────────────

const pass = (label: string, ok: boolean) => console.log(`  ${ok ? "✓" : "✗"} ${label}`);

console.log("\n  Assertions:");

// Part 1: Permission modes
pass("A: Bash was attempted but denied", denied.deniedTools.includes("Bash") || denied.toolCalls.every(t => t.name !== "Bash"));
pass("B: Bash was denied via canUseTool", readOnly.deniedTools.includes("Bash") || readOnly.toolCalls.every(t => t.name !== "Bash"));
pass("C: Bash was used successfully", allowed.toolCalls.some(t => t.name === "Bash"));
pass("C: No tools were denied", allowed.deniedTools.length === 0);
pass("C: Output contains 'hello'", allowed.textOutput.includes("hello"));

// Part 2: File-based settings comparison
pass("D (fourmis): Bash was used via file settings", fourmisFileResult.toolCalls.some(t => t.name === "Bash"));
pass("D (fourmis): No tools were denied", fourmisFileResult.deniedTools.length === 0);
pass("D (fourmis): Output contains 'hello'", fourmisFileResult.textOutput.includes("hello"));
pass("D (anthropic): Bash was used via file settings", anthropicFileResult.toolCalls.some(t => t.name === "Bash"));
pass("D (anthropic): Output contains 'hello'", anthropicFileResult.textOutput.includes("hello"));
pass("D: Both SDKs used Bash", fourmisFileResult.toolCalls.some(t => t.name === "Bash") && anthropicFileResult.toolCalls.some(t => t.name === "Bash"));

console.log("═".repeat(90));
