/**
 * Scenario 8: MCP — test in-process MCP server tool access in both SDKs.
 *
 * Both SDKs support McpSdkServerConfigWithInstance (type: "sdk") for in-process
 * MCP servers. We create identical MCP servers and verify both SDKs can discover
 * and call the tools.
 *
 * Tests:
 *   A) Fourmis-only: agent calls an in-process MCP tool
 *   B) Fourmis-only: multiple MCP servers with different tools
 *   C) Side-by-side: both SDKs connect to the same MCP server definition
 *
 * Usage: bun tests/compare/scenarios/08-mcp.ts
 */
import { query as fourmisQuery } from "../../../src/index.ts";
import { query as anthropicQuery } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "../../../src/index.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

interface McpResult {
  label: string;
  sdk: "fourmis" | "anthropic";
  textOutput: string;
  toolCalls: { name: string; input?: unknown }[];
  toolResults: { name: string; content: string; isError?: boolean }[];
  stopReason: string;
  errors: string[];
  durationMs: number;
}

function emptyResult(label: string, sdk: "fourmis" | "anthropic"): McpResult {
  return {
    label, sdk, textOutput: "", toolCalls: [], toolResults: [],
    stopReason: "unknown", errors: [], durationMs: 0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── MCP Server Factory ──────────────────────────────────────────────────────

/**
 * Creates a fresh McpServer with a "calculator" tool.
 * Each SDK call needs its own instance since one server can only have one transport.
 */
function createCalcServer(): McpServer {
  const server = new McpServer({ name: "calc", version: "1.0.0" });

  server.tool(
    "add",
    "Adds two numbers together",
    { a: z.number().describe("First number"), b: z.number().describe("Second number") },
    async ({ a, b }) => ({
      content: [{ type: "text" as const, text: String(a + b) }],
    }),
  );

  server.tool(
    "multiply",
    "Multiplies two numbers",
    { a: z.number().describe("First number"), b: z.number().describe("Second number") },
    async ({ a, b }) => ({
      content: [{ type: "text" as const, text: String(a * b) }],
    }),
  );

  return server;
}

function createGreetServer(): McpServer {
  const server = new McpServer({ name: "greeter", version: "1.0.0" });

  server.tool(
    "greet",
    "Greets a person by name",
    { name: z.string().describe("Name of the person to greet") },
    async ({ name }) => ({
      content: [{ type: "text" as const, text: `Hello, ${name}! Welcome!` }],
    }),
  );

  return server;
}

// ─── Fourmis Runner ───────────────────────────────────────────────────────────

async function runFourmisMcp(
  label: string,
  prompt: string,
  mcpServers: Record<string, any>,
): Promise<McpResult> {
  const result = emptyResult(label, "fourmis");
  const start = performance.now();

  try {
    const conversation = fourmisQuery({
      prompt,
      options: {
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        cwd: process.cwd(),
        tools: [],          // No built-in tools — only MCP tools
        maxTurns: 5,
        maxBudgetUsd: 0.30,
        permissionMode: "bypassPermissions",
        mcpServers,
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

  result.durationMs = Math.round(performance.now() - start);
  return result;
}

// ─── Anthropic Runner ─────────────────────────────────────────────────────────

async function runAnthropicMcp(
  label: string,
  prompt: string,
  mcpServers: Record<string, any>,
): Promise<McpResult> {
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
        cwd: process.cwd(),
        maxTurns: 5,
        maxBudgetUsd: 0.30,
        permissionMode: "acceptEdits",
        mcpServers,
      },
    });

    for await (const msg of conversation) {
      switch (msg.type) {
        case "assistant": {
          const content = (msg as any).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") result.textOutput += block.text;
              if (block.type === "tool_use") {
                result.toolCalls.push({ name: block.name, input: block.input });
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

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(90));
console.log("  SCENARIO 08: MCP (in-process MCP server tools)");
console.log("═".repeat(90));

const divider = "─".repeat(90);

// ─── Part 1: Fourmis-only MCP tests ─────────────────────────────────────────

console.log("\n  PART 1: Fourmis-agents MCP Tests");
console.log("  " + "─".repeat(50));

// Test A: Single MCP server with calculator
console.log("\n  → Test A: Single MCP calculator server...");
const resultA = await runFourmisMcp(
  "Single MCP calc",
  "What is 7 plus 3? Use the add tool to compute it. Reply with just the result.",
  {
    calc: {
      type: "sdk",
      name: "calc",
      instance: createCalcServer(),
    },
  },
);
console.log(`    ✓ Done in ${fmtMs(resultA.durationMs)}`);
console.log(`    Tools called: ${resultA.toolCalls.map((t) => t.name).join(", ") || "(none)"}`);
console.log(`    Result: ${truncate(resultA.textOutput.trim(), 60)}`);

// Test B: Multiple MCP servers
console.log("\n  → Test B: Multiple MCP servers (calc + greeter)...");
const resultB = await runFourmisMcp(
  "Multiple MCP servers",
  "First, greet Alice. Then add 5 and 8. Tell me both results briefly.",
  {
    calc: {
      type: "sdk",
      name: "calc",
      instance: createCalcServer(),
    },
    greeter: {
      type: "sdk",
      name: "greeter",
      instance: createGreetServer(),
    },
  },
);
console.log(`    ✓ Done in ${fmtMs(resultB.durationMs)}`);
console.log(`    Tools called: ${resultB.toolCalls.map((t) => t.name).join(", ") || "(none)"}`);
console.log(`    Result: ${truncate(resultB.textOutput.trim(), 60)}`);

// Part 1 summary
console.log(`\n${divider}`);

printTable([
  ["Field", "A: Single MCP", "B: Multiple MCP"],
  ["─────", "─────────────", "───────────────"],
  ["Stop Reason", resultA.stopReason, resultB.stopReason],
  ["Tool Calls", resultA.toolCalls.map((t) => t.name).join(", ") || "(none)", resultB.toolCalls.map((t) => t.name).join(", ") || "(none)"],
  ["Duration", fmtMs(resultA.durationMs), fmtMs(resultB.durationMs)],
  ["Text Output", truncate(resultA.textOutput.trim(), 40) || "(empty)", truncate(resultB.textOutput.trim(), 40) || "(empty)"],
  ["Errors", resultA.errors.length ? truncate(resultA.errors.join("; "), 40) : "(none)", resultB.errors.length ? truncate(resultB.errors.join("; "), 40) : "(none)"],
]);

console.log(divider);

// ─── Part 2: Side-by-side MCP comparison ─────────────────────────────────────

console.log("\n  PART 2: Side-by-Side MCP Comparison (fourmis vs anthropic)");
console.log("  " + "─".repeat(50));

const CALC_PROMPT = "What is 12 plus 8? Use the add tool. Reply with just the number.";

console.log("\n  → Test C (fourmis): In-process MCP calc server...");
const fourmisC = await runFourmisMcp(
  "fourmis MCP",
  CALC_PROMPT,
  {
    calc: {
      type: "sdk",
      name: "calc",
      instance: createCalcServer(),
    },
  },
);
console.log(`    ✓ Done in ${fmtMs(fourmisC.durationMs)}`);

console.log("\n  → Test C (anthropic): In-process MCP calc server...");
const anthropicC = await runAnthropicMcp(
  "anthropic MCP",
  CALC_PROMPT,
  {
    calc: {
      type: "sdk",
      name: "calc",
      instance: createCalcServer(),
    },
  },
);
console.log(`    ✓ Done in ${fmtMs(anthropicC.durationMs)}`);

// Side-by-side comparison
console.log(`\n${divider}`);
console.log(`  COMPARISON: In-Process MCP Calculator`);
console.log(divider);

printTable([
  ["Field", "fourmis-agents", "anthropic-sdk", "Delta"],
  ["─────", "──────────────", "──────────────", "─────"],
  ["Stop Reason", fourmisC.stopReason, anthropicC.stopReason, fourmisC.stopReason === anthropicC.stopReason ? "=" : "DIFF"],
  ["Tool Calls", fourmisC.toolCalls.map((t) => t.name).join(", ") || "(none)", anthropicC.toolCalls.map((t) => t.name).join(", ") || "(none)", fourmisC.toolCalls.length === anthropicC.toolCalls.length ? "=" : "DIFF"],
  ["Tool Namespacing", fourmisC.toolCalls[0]?.name ?? "?", anthropicC.toolCalls[0]?.name ?? "?", ""],
  ["Wall Time", fmtMs(fourmisC.durationMs), fmtMs(anthropicC.durationMs), speedDelta(fourmisC.durationMs, anthropicC.durationMs)],
  ["Answer Contains '20'", fourmisC.textOutput.includes("20") ? "YES" : "NO", anthropicC.textOutput.includes("20") ? "YES" : "NO", ""],
  ["Text Output", truncate(fourmisC.textOutput.trim(), 40) || "(empty)", truncate(anthropicC.textOutput.trim(), 40) || "(empty)", ""],
  ["Errors", fourmisC.errors.length ? truncate(fourmisC.errors.join("; "), 40) : "(none)", anthropicC.errors.length ? truncate(anthropicC.errors.join("; "), 40) : "(none)", ""],
]);

console.log(divider);

// ─── Assertions ──────────────────────────────────────────────────────────────

const pass = (label: string, ok: boolean) => console.log(`  ${ok ? "✓" : "✗"} ${label}`);

console.log("\n  Assertions:");

// Part 1
pass("A: MCP tool was called", resultA.toolCalls.length > 0);
pass("A: Tool name is namespaced (mcp__)", resultA.toolCalls.some((t) => t.name.startsWith("mcp__")));
pass("A: Result mentions 10", resultA.textOutput.includes("10"));
pass("A: Success", resultA.stopReason === "success");

pass("B: Multiple MCP tools called", resultB.toolCalls.length >= 2);
pass("B: Both calc and greeter used", resultB.toolCalls.some((t) => t.name.includes("add") || t.name.includes("multiply")) && resultB.toolCalls.some((t) => t.name.includes("greet")));
pass("B: Success", resultB.stopReason === "success");

// Part 2
pass("C (fourmis): Called MCP tool", fourmisC.toolCalls.length > 0);
pass("C (fourmis): Answer includes 20", fourmisC.textOutput.includes("20"));
pass("C (anthropic): Called MCP tool", anthropicC.toolCalls.length > 0);
pass("C (anthropic): Answer includes 20", anthropicC.textOutput.includes("20"));
pass("C: Both SDKs computed correct answer", fourmisC.textOutput.includes("20") && anthropicC.textOutput.includes("20"));

console.log("═".repeat(90));
