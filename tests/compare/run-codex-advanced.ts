/**
 * Run advanced scenarios (permissions, hooks, MCP, subagents) with
 * fourmis-agents (OpenAI Codex) vs @anthropic-ai/claude-agent-sdk.
 *
 * Usage: bun tests/compare/run-codex-advanced.ts
 */

import { query as fourmisQuery } from "../../src/index.ts";
import { query as anthropicQuery } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "../../src/index.ts";
import type { HookInput } from "../../src/hooks.ts";
import { isLoggedIn } from "../../src/auth/openai-oauth.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

if (process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is set — unset it to use Codex/OAuth mode.");
  process.exit(1);
}
if (!isLoggedIn()) {
  console.error("Not logged in to OpenAI. Run: bun src/auth/login-openai.ts");
  process.exit(1);
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

const CWD = import.meta.dir + "/../..";

interface Result {
  sdk: string;
  textOutput: string;
  toolCalls: { name: string }[];
  toolResults: { name: string; content: string; isError?: boolean }[];
  hookEvents: string[];
  stopReason: string;
  errors: string[];
  durationMs: number;
  deniedTools: string[];
}

function empty(sdk: string): Result {
  return {
    sdk, textOutput: "", toolCalls: [], toolResults: [],
    hookEvents: [], stopReason: "unknown", errors: [], durationMs: 0, deniedTools: [],
  };
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 3) + "...";
}

function speedDelta(a: number, b: number): string {
  if (a === 0 || b === 0) return "";
  const r = b / a;
  if (r > 1.05) return `codex ${r.toFixed(1)}x faster`;
  if (r < 0.95) return `anthropic ${(1 / r).toFixed(1)}x faster`;
  return "~same";
}

function printTable(rows: string[][]): void {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const row of rows) {
    console.log(`  ${row.map((c, i) => c.padEnd(widths[i])).join("  |  ")}`);
  }
}

const pass = (label: string, ok: boolean) => console.log(`  ${ok ? "PASS" : "FAIL"} ${label}`);

// ─── Fourmis (Codex) runner ─────────────────────────────────────────────────

async function runCodex(opts: {
  prompt: string;
  tools?: string | string[];
  permissions?: { allow?: string[]; deny?: string[] };
  canUseTool?: any;
  hooks?: any;
  mcpServers?: Record<string, any>;
  agents?: Record<string, any>;
  maxTurns?: number;
  hookEvents?: string[];
}): Promise<Result> {
  const result = empty("codex");
  const start = performance.now();

  try {
    const conversation = fourmisQuery({
      prompt: opts.prompt,
      options: {
        provider: "openai",
        model: "gpt-5.3-codex",
        cwd: CWD,
        tools: opts.tools ?? "coding",
        maxTurns: opts.maxTurns ?? 5,
        maxBudgetUsd: 0.50,
        permissionMode: opts.permissions || opts.canUseTool ? "default" : "bypassPermissions",
        permissions: opts.permissions,
        canUseTool: opts.canUseTool,
        hooks: opts.hooks,
        mcpServers: opts.mcpServers,
        agents: opts.agents,
      },
    });

    for await (const msg of conversation) {
      switch (msg.type) {
        case "text": result.textOutput += msg.text; break;
        case "tool_use": result.toolCalls.push({ name: msg.name }); break;
        case "tool_result":
          result.toolResults.push({ name: msg.name, content: msg.content, isError: msg.isError });
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
  if (opts.hookEvents) result.hookEvents = [...opts.hookEvents];
  return result;
}

// ─── Anthropic SDK runner ───────────────────────────────────────────────────

async function runAnthropic(opts: {
  prompt: string;
  hooks?: any;
  mcpServers?: Record<string, any>;
  agents?: Record<string, any>;
  maxTurns?: number;
}): Promise<Result> {
  const result = empty("anthropic");
  const start = performance.now();

  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const conversation = anthropicQuery({
      prompt: opts.prompt,
      options: {
        model: "claude-sonnet-4-5-20250929",
        executable: "node",
        cwd: CWD,
        maxTurns: opts.maxTurns ?? 5,
        maxBudgetUsd: 0.50,
        permissionMode: "acceptEdits",
        hooks: opts.hooks,
        mcpServers: opts.mcpServers,
        agents: opts.agents,
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

  result.durationMs = Math.round(performance.now() - start);
  return result;
}

// ─── Comparison printer ─────────────────────────────────────────────────────

function compare(title: string, codex: Result, anthropic: Result): void {
  const d = "-".repeat(90);
  console.log(`\n${d}`);
  console.log(`  ${title}`);
  console.log(d);

  printTable([
    ["", "fourmis (codex)", "anthropic-sdk", ""],
    ["---", "---", "---", "---"],
    ["Status", codex.errors.length === 0 ? "OK" : "FAIL", anthropic.errors.length === 0 ? "OK" : "FAIL", ""],
    ["Stop Reason", codex.stopReason, anthropic.stopReason, codex.stopReason === anthropic.stopReason ? "=" : "DIFF"],
    ["Wall Time", fmtMs(codex.durationMs), fmtMs(anthropic.durationMs), speedDelta(codex.durationMs, anthropic.durationMs)],
    ["Tools", codex.toolCalls.map((t) => t.name).join(", ") || "(none)", anthropic.toolCalls.map((t) => t.name).join(", ") || "(none)", ""],
    ["Output", truncate(codex.textOutput.trim(), 45) || "(empty)", truncate(anthropic.textOutput.trim(), 45) || "(empty)", ""],
    ...(codex.errors.length > 0 || anthropic.errors.length > 0
      ? [["Errors",
          codex.errors.length ? truncate(codex.errors.join("; "), 45) : "(none)",
          anthropic.errors.length ? truncate(anthropic.errors.join("; "), 45) : "(none)",
          ""]]
      : []),
  ]);
  console.log(d);
}

// ─── MCP server factory ─────────────────────────────────────────────────────

function createCalcServer(): McpServer {
  const server = new McpServer({ name: "calc", version: "1.0.0" });
  server.tool("add", "Adds two numbers", { a: z.number(), b: z.number() },
    async ({ a, b }) => ({ content: [{ type: "text" as const, text: String(a + b) }] }));
  server.tool("multiply", "Multiplies two numbers", { a: z.number(), b: z.number() },
    async ({ a, b }) => ({ content: [{ type: "text" as const, text: String(a * b) }] }));
  return server;
}

function createGreetServer(): McpServer {
  const server = new McpServer({ name: "greeter", version: "1.0.0" });
  server.tool("greet", "Greets a person by name", { name: z.string() },
    async ({ name }) => ({ content: [{ type: "text" as const, text: `Hello, ${name}! Welcome!` }] }));
  return server;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════════

const DIV = "=".repeat(90);
console.log(DIV);
console.log("  fourmis (Codex / gpt-5.3-codex)  vs  @anthropic-ai/claude-agent-sdk");
console.log("  Advanced Scenarios: Permissions, Hooks, MCP, Subagents");
console.log(DIV);

const summary: { name: string; codexOk: boolean; anthropicOk: boolean }[] = [];

// ─── 06: Permissions ────────────────────────────────────────────────────────

console.log("\n\n  ## SCENARIO 06: Permissions\n");

const PERM_PROMPT = "Run the command 'echo hello' using Bash and tell me the output. Be brief.";

// 06a: Bash denied
console.log("  -> 06a: Bash DENIED...");
const perm06a = await runCodex({
  prompt: PERM_PROMPT,
  permissions: { deny: ["Bash"] },
  canUseTool: async (toolName: string) => ({
    behavior: "deny" as const,
    message: `Tool "${toolName}" denied by test.`,
  }),
});
console.log(`     ${perm06a.errors.length === 0 ? "OK" : "FAIL"} | ${fmtMs(perm06a.durationMs)} | tools: ${perm06a.toolCalls.map((t) => t.name).join(", ") || "(none)"}`);
pass("06a: Bash not successfully used", perm06a.toolCalls.every((t) => t.name !== "Bash") || perm06a.toolResults.some((r) => r.isError));

// 06b: Bash allowed
console.log("  -> 06b: Bash ALLOWED...");
const perm06b = await runCodex({
  prompt: PERM_PROMPT,
  permissions: { allow: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"] },
});
console.log(`     ${perm06b.errors.length === 0 ? "OK" : "FAIL"} | ${fmtMs(perm06b.durationMs)} | tools: ${perm06b.toolCalls.map((t) => t.name).join(", ") || "(none)"}`);
pass("06b: Bash was used", perm06b.toolCalls.some((t) => t.name === "Bash"));
pass("06b: Output contains 'hello'", perm06b.textOutput.includes("hello"));

// 06c: Side-by-side comparison
console.log("  -> 06c: Codex vs Anthropic (Bash allowed)...");
const perm06c_a = await runAnthropic({ prompt: PERM_PROMPT });
compare("06: Permissions — Bash Allowed", perm06b, perm06c_a);
summary.push({ name: "06 - Permissions", codexOk: perm06b.errors.length === 0, anthropicOk: perm06c_a.errors.length === 0 });

// ─── 07: Hooks ──────────────────────────────────────────────────────────────

console.log("\n\n  ## SCENARIO 07: Hooks\n");

const HOOK_PROMPT = "Read the file package.json in the current directory and tell me the project name. Be brief.";

// 07a: PreToolUse observe
const hookEvents07a: string[] = [];
console.log("  -> 07a: PreToolUse observe hook (Codex)...");
const hook07a = await runCodex({
  prompt: HOOK_PROMPT,
  hookEvents: hookEvents07a,
  hooks: {
    PreToolUse: [{
      hooks: [async (input: HookInput) => {
        hookEvents07a.push(`PreToolUse:${input.tool_name}`);
        return {};
      }],
    }],
  },
});
console.log(`     ${hook07a.errors.length === 0 ? "OK" : "FAIL"} | ${fmtMs(hook07a.durationMs)} | hooks: ${hookEvents07a.join(", ")}`);
pass("07a: Hook events fired", hookEvents07a.length > 0);
pass("07a: Observed tool call", hookEvents07a.some((e) => e.startsWith("PreToolUse:")));

// 07b: PreToolUse deny
const hookEvents07b: string[] = [];
console.log("  -> 07b: PreToolUse deny Bash hook (Codex)...");
const hook07b = await runCodex({
  prompt: "Run 'echo test' using Bash. Be brief.",
  hookEvents: hookEvents07b,
  hooks: {
    PreToolUse: [{
      matcher: "^Bash$",
      hooks: [async (input: HookInput) => {
        hookEvents07b.push(`DENY:${input.tool_name}`);
        return { permissionDecision: "deny" as const };
      }],
    }],
  },
});
console.log(`     ${hook07b.errors.length === 0 ? "OK" : "FAIL"} | ${fmtMs(hook07b.durationMs)} | hooks: ${hookEvents07b.join(", ")}`);
pass("07b: Bash was denied by hook", hookEvents07b.some((e) => e.includes("DENY")));

// 07c: PostToolUse observe
const hookEvents07c: string[] = [];
console.log("  -> 07c: PostToolUse observe hook (Codex)...");
const hook07c = await runCodex({
  prompt: HOOK_PROMPT,
  hookEvents: hookEvents07c,
  hooks: {
    PostToolUse: [{
      hooks: [async (input: HookInput) => {
        hookEvents07c.push(`PostToolUse:${input.tool_name}`);
        return {};
      }],
    }],
  },
});
console.log(`     ${hook07c.errors.length === 0 ? "OK" : "FAIL"} | ${fmtMs(hook07c.durationMs)} | hooks: ${hookEvents07c.join(", ")}`);
pass("07c: PostToolUse fired", hookEvents07c.length > 0);

// 07d: Side-by-side
const hookEvents07d: string[] = [];
console.log("  -> 07d: Codex vs Anthropic (PreToolUse logging)...");
const hook07d_codex = await runCodex({
  prompt: HOOK_PROMPT,
  hookEvents: hookEvents07d,
  hooks: {
    PreToolUse: [{
      hooks: [async (input: HookInput) => {
        hookEvents07d.push(`PreToolUse:${input.tool_name}`);
        return {};
      }],
    }],
  },
});
const hook07d_anthropic = await runAnthropic({
  prompt: HOOK_PROMPT,
  hooks: {
    PreToolUse: [{
      hooks: [async (input: any) => {
        return {};
      }],
    }],
  },
});
compare("07: Hooks — PreToolUse Logging", hook07d_codex, hook07d_anthropic);
summary.push({ name: "07 - Hooks", codexOk: hook07d_codex.errors.length === 0, anthropicOk: hook07d_anthropic.errors.length === 0 });

// ─── 08: MCP ────────────────────────────────────────────────────────────────

console.log("\n\n  ## SCENARIO 08: MCP\n");

// 08a: Single MCP calculator (Codex)
console.log("  -> 08a: Single MCP calc server (Codex)...");
const mcp08a = await runCodex({
  prompt: "What is 7 plus 3? Use the add tool to compute it. Reply with just the result.",
  tools: [],
  mcpServers: {
    calc: { type: "sdk", name: "calc", instance: createCalcServer() },
  },
});
console.log(`     ${mcp08a.errors.length === 0 ? "OK" : "FAIL"} | ${fmtMs(mcp08a.durationMs)} | tools: ${mcp08a.toolCalls.map((t) => t.name).join(", ") || "(none)"}`);
pass("08a: MCP tool called", mcp08a.toolCalls.length > 0);
pass("08a: Tool namespaced (mcp__)", mcp08a.toolCalls.some((t) => t.name.startsWith("mcp__")));
pass("08a: Result mentions 10", mcp08a.textOutput.includes("10"));

// 08b: Multiple MCP servers (Codex)
console.log("  -> 08b: Multiple MCP servers (calc + greeter) (Codex)...");
const mcp08b = await runCodex({
  prompt: "First greet Alice, then add 5 and 8. Tell me both results briefly.",
  tools: [],
  mcpServers: {
    calc: { type: "sdk", name: "calc", instance: createCalcServer() },
    greeter: { type: "sdk", name: "greeter", instance: createGreetServer() },
  },
});
console.log(`     ${mcp08b.errors.length === 0 ? "OK" : "FAIL"} | ${fmtMs(mcp08b.durationMs)} | tools: ${mcp08b.toolCalls.map((t) => t.name).join(", ") || "(none)"}`);
pass("08b: Multiple tools called", mcp08b.toolCalls.length >= 2);
pass("08b: Both servers used", mcp08b.toolCalls.some((t) => t.name.includes("greet")) && mcp08b.toolCalls.some((t) => t.name.includes("add")));

// 08c: Side-by-side
console.log("  -> 08c: Codex vs Anthropic (MCP calc: 12 + 8)...");
const mcp08c_codex = await runCodex({
  prompt: "What is 12 plus 8? Use the add tool. Reply with just the number.",
  tools: [],
  mcpServers: {
    calc: { type: "sdk", name: "calc", instance: createCalcServer() },
  },
});
const mcp08c_anthropic = await runAnthropic({
  prompt: "What is 12 plus 8? Use the add tool. Reply with just the number.",
  mcpServers: {
    calc: { type: "sdk", name: "calc", instance: createCalcServer() },
  },
});
compare("08: MCP — Calculator (12 + 8 = 20)", mcp08c_codex, mcp08c_anthropic);
pass("08c: Both got 20", mcp08c_codex.textOutput.includes("20") && mcp08c_anthropic.textOutput.includes("20"));
summary.push({ name: "08 - MCP", codexOk: mcp08c_codex.errors.length === 0, anthropicOk: mcp08c_anthropic.errors.length === 0 });

// ─── 09: Subagents ──────────────────────────────────────────────────────────

console.log("\n\n  ## SCENARIO 09: Subagents\n");

const AGENT_DEFS = {
  researcher: {
    description: "Research agent that reads files and answers questions about code",
    prompt: "You are a research agent. Read the requested files and provide a concise analysis. Be brief and factual.",
    tools: ["Read", "Glob", "Grep"],
    maxTurns: 3,
  },
};

// 09a: Researcher subagent (Codex)
console.log("  -> 09a: Researcher subagent delegation (Codex)...");
const sub09a = await runCodex({
  prompt: "Use the researcher agent to read package.json and find the project name. Report what the subagent found.",
  agents: AGENT_DEFS,
  maxTurns: 8,
});
console.log(`     ${sub09a.errors.length === 0 ? "OK" : "FAIL"} | ${fmtMs(sub09a.durationMs)} | tools: ${sub09a.toolCalls.map((t) => t.name).join(", ") || "(none)"}`);
pass("09a: Task tool invoked", sub09a.toolCalls.some((t) => t.name === "Task"));
pass("09a: Result mentions fourmis", sub09a.textOutput.toLowerCase().includes("fourmis"));

// 09b: Side-by-side
console.log("  -> 09b: Codex vs Anthropic (researcher subagent)...");
const SUB_PROMPT = "Use the researcher agent to read package.json and tell me the project name. Be brief.";
const sub09b_codex = await runCodex({
  prompt: SUB_PROMPT,
  agents: AGENT_DEFS,
  maxTurns: 8,
});
const sub09b_anthropic = await runAnthropic({
  prompt: SUB_PROMPT,
  agents: AGENT_DEFS,
  maxTurns: 8,
});
compare("09: Subagents — Researcher reads package.json", sub09b_codex, sub09b_anthropic);
pass("09b (codex): Used Task tool", sub09b_codex.toolCalls.some((t) => t.name === "Task"));
pass("09b (codex): Mentions fourmis", sub09b_codex.textOutput.toLowerCase().includes("fourmis"));
pass("09b (anthropic): Used Task tool", sub09b_anthropic.toolCalls.some((t) => t.name === "Task"));
pass("09b (anthropic): Mentions fourmis", sub09b_anthropic.textOutput.toLowerCase().includes("fourmis"));
summary.push({ name: "09 - Subagents", codexOk: sub09b_codex.errors.length === 0, anthropicOk: sub09b_anthropic.errors.length === 0 });

// ═══════════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${DIV}`);
console.log("  SUMMARY");
console.log(DIV);
for (const r of summary) {
  const c = r.codexOk ? "OK  " : "FAIL";
  const a = r.anthropicOk ? "OK  " : "FAIL";
  console.log(`  codex: ${c}  |  anthropic: ${a}  |  ${r.name}`);
}
console.log(DIV);

const failed = summary.filter((r) => !r.codexOk || !r.anthropicOk);
if (failed.length > 0) process.exit(1);
