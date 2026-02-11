/**
 * Scenario 9: Subagents — test agent delegation via Task tool in both SDKs.
 *
 * Both SDKs support agents: Record<string, AgentDefinition>, where each agent
 * has a description, prompt, optional tools/model/maxTurns. The parent agent
 * invokes subagents via the "Task" tool.
 *
 * Tests:
 *   A) Fourmis-only: parent delegates to a researcher subagent
 *   B) Fourmis-only: multiple agent types available
 *   C) Side-by-side: both SDKs delegate to a subagent and return the result
 *
 * Usage: bun tests/compare/scenarios/09-subagents.ts
 */
import { query as fourmisQuery } from "../../../src/index.ts";
import { query as anthropicQuery } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "../../../src/index.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubagentResult {
  label: string;
  sdk: "fourmis" | "anthropic";
  textOutput: string;
  toolCalls: { name: string; input?: unknown }[];
  toolResults: { name: string; content: string; isError?: boolean }[];
  stopReason: string;
  errors: string[];
  durationMs: number;
}

function emptyResult(label: string, sdk: "fourmis" | "anthropic"): SubagentResult {
  return {
    label, sdk, textOutput: "", toolCalls: [], toolResults: [],
    stopReason: "unknown", errors: [], durationMs: 0,
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

// ─── Agent Definitions (shared) ──────────────────────────────────────────────

const AGENT_DEFINITIONS = {
  researcher: {
    description: "Research agent that reads files and answers questions about code",
    prompt: "You are a research agent. Read the requested files and provide a concise analysis. Be brief and factual.",
    tools: ["Read", "Glob", "Grep"],
    maxTurns: 3,
  },
  summarizer: {
    description: "Summarizes text content into bullet points",
    prompt: "You are a summarizer. Take the given text and produce 2-3 bullet points. Be extremely concise.",
    maxTurns: 2,
  },
};

// ─── Fourmis Runner ───────────────────────────────────────────────────────────

async function runFourmisSubagent(
  label: string,
  prompt: string,
  agents: Record<string, any>,
): Promise<SubagentResult> {
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
        maxTurns: 8,
        maxBudgetUsd: 0.50,
        permissionMode: "bypassPermissions",
        agents,
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

async function runAnthropicSubagent(
  label: string,
  prompt: string,
  agents: Record<string, any>,
): Promise<SubagentResult> {
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
        maxTurns: 8,
        maxBudgetUsd: 0.50,
        permissionMode: "acceptEdits",
        agents,
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
console.log("  SCENARIO 09: Subagents (agent delegation via Task tool)");
console.log("═".repeat(90));

const divider = "─".repeat(90);

// ─── Part 1: Fourmis-only subagent tests ─────────────────────────────────────

console.log("\n  PART 1: Fourmis-agents Subagent Tests");
console.log("  " + "─".repeat(50));

// Test A: Delegate to researcher
console.log("\n  → Test A: Parent delegates to researcher subagent...");
const resultA = await runFourmisSubagent(
  "Researcher delegation",
  "Use the researcher agent to read package.json and find the project name. Report what the subagent found.",
  { researcher: AGENT_DEFINITIONS.researcher },
);
console.log(`    ✓ Done in ${fmtMs(resultA.durationMs)}`);
console.log(`    Tools called: ${resultA.toolCalls.map((t) => t.name).join(", ") || "(none)"}`);
console.log(`    Result: ${truncate(resultA.textOutput.trim(), 60)}`);

// Test B: Multiple agent types
console.log("\n  → Test B: Multiple agent types available...");
const resultB = await runFourmisSubagent(
  "Multiple agents",
  "Use the researcher agent to read the file package.json, then report what it found. Use only one agent.",
  AGENT_DEFINITIONS,
);
console.log(`    ✓ Done in ${fmtMs(resultB.durationMs)}`);
console.log(`    Tools called: ${resultB.toolCalls.map((t) => t.name).join(", ") || "(none)"}`);
console.log(`    Result: ${truncate(resultB.textOutput.trim(), 60)}`);

// Part 1 summary
console.log(`\n${divider}`);

printTable([
  ["Field", "A: Researcher", "B: Multi-Agent"],
  ["─────", "─────────────", "──────────────"],
  ["Stop Reason", resultA.stopReason, resultB.stopReason],
  ["Tool Calls", resultA.toolCalls.map((t) => t.name).join(", ") || "(none)", resultB.toolCalls.map((t) => t.name).join(", ") || "(none)"],
  ["Used Task", resultA.toolCalls.some((t) => t.name === "Task") ? "YES" : "NO", resultB.toolCalls.some((t) => t.name === "Task") ? "YES" : "NO"],
  ["Duration", fmtMs(resultA.durationMs), fmtMs(resultB.durationMs)],
  ["Text Output", truncate(resultA.textOutput.trim(), 40) || "(empty)", truncate(resultB.textOutput.trim(), 40) || "(empty)"],
  ["Errors", resultA.errors.length ? truncate(resultA.errors.join("; "), 40) : "(none)", resultB.errors.length ? truncate(resultB.errors.join("; "), 40) : "(none)"],
]);

console.log(divider);

// ─── Part 2: Side-by-side subagent comparison ────────────────────────────────

console.log("\n  PART 2: Side-by-Side Subagent Comparison (fourmis vs anthropic)");
console.log("  " + "─".repeat(50));

const SUBAGENT_PROMPT = "Use the researcher agent to read package.json and tell me the project name. Be brief.";

// Fourmis uses "researcher" agent definition as-is
const fourmisAgents = { researcher: AGENT_DEFINITIONS.researcher };

// Anthropic uses the same shape — description, prompt, tools, maxTurns
const anthropicAgents = {
  researcher: {
    description: AGENT_DEFINITIONS.researcher.description,
    prompt: AGENT_DEFINITIONS.researcher.prompt,
    tools: AGENT_DEFINITIONS.researcher.tools,
    maxTurns: AGENT_DEFINITIONS.researcher.maxTurns,
  },
};

console.log("\n  → Test C (fourmis): Delegate to researcher via Task tool...");
const fourmisC = await runFourmisSubagent("fourmis subagent", SUBAGENT_PROMPT, fourmisAgents);
console.log(`    ✓ Done in ${fmtMs(fourmisC.durationMs)}`);

console.log("\n  → Test C (anthropic): Delegate to researcher via Task tool...");
const anthropicC = await runAnthropicSubagent("anthropic subagent", SUBAGENT_PROMPT, anthropicAgents);
console.log(`    ✓ Done in ${fmtMs(anthropicC.durationMs)}`);

// Side-by-side comparison
console.log(`\n${divider}`);
console.log(`  COMPARISON: Subagent Delegation (researcher → read package.json)`);
console.log(divider);

printTable([
  ["Field", "fourmis-agents", "anthropic-sdk", "Delta"],
  ["─────", "──────────────", "──────────────", "─────"],
  ["Stop Reason", fourmisC.stopReason, anthropicC.stopReason, fourmisC.stopReason === anthropicC.stopReason ? "=" : "DIFF"],
  ["Used Task Tool", fourmisC.toolCalls.some((t) => t.name === "Task") ? "YES" : "NO", anthropicC.toolCalls.some((t) => t.name === "Task") ? "YES" : "NO", ""],
  ["Total Tool Calls", String(fourmisC.toolCalls.length), String(anthropicC.toolCalls.length), fourmisC.toolCalls.length === anthropicC.toolCalls.length ? "=" : "DIFF"],
  ["Tools Used", fourmisC.toolCalls.map((t) => t.name).join(", ") || "(none)", anthropicC.toolCalls.map((t) => t.name).join(", ") || "(none)", ""],
  ["Wall Time", fmtMs(fourmisC.durationMs), fmtMs(anthropicC.durationMs), speedDelta(fourmisC.durationMs, anthropicC.durationMs)],
  ["Mentions Project", fourmisC.textOutput.includes("fourmis") ? "YES" : "NO", anthropicC.textOutput.includes("fourmis") ? "YES" : "NO", ""],
  ["Text Output", truncate(fourmisC.textOutput.trim(), 40) || "(empty)", truncate(anthropicC.textOutput.trim(), 40) || "(empty)", ""],
  ["Errors", fourmisC.errors.length ? truncate(fourmisC.errors.join("; "), 40) : "(none)", anthropicC.errors.length ? truncate(anthropicC.errors.join("; "), 40) : "(none)", ""],
]);

console.log(divider);

// ─── Assertions ──────────────────────────────────────────────────────────────

const pass = (label: string, ok: boolean) => console.log(`  ${ok ? "✓" : "✗"} ${label}`);

console.log("\n  Assertions:");

// Part 1
pass("A: Task tool was invoked", resultA.toolCalls.some((t) => t.name === "Task"));
pass("A: Task tool returned a result", resultA.toolResults.some((t) => t.name === "Task" && !t.isError));
pass("A: Result mentions project name", resultA.textOutput.includes("fourmis"));
pass("A: Success", resultA.stopReason === "success");

pass("B: Task tool was invoked", resultB.toolCalls.some((t) => t.name === "Task"));
pass("B: Success", resultB.stopReason === "success");

// Part 2
pass("C (fourmis): Used Task tool", fourmisC.toolCalls.some((t) => t.name === "Task"));
pass("C (fourmis): Mentions project name", fourmisC.textOutput.includes("fourmis"));
pass("C (anthropic): Used Task tool", anthropicC.toolCalls.some((t) => t.name === "Task"));
pass("C (anthropic): Mentions project name", anthropicC.textOutput.includes("fourmis"));
pass("C: Both SDKs delegated successfully", fourmisC.toolCalls.some((t) => t.name === "Task") && anthropicC.toolCalls.some((t) => t.name === "Task"));

console.log("═".repeat(90));
