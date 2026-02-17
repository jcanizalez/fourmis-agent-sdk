import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CompatScenario } from "./types.ts";

function createCalcServer(name = "calc"): McpServer {
  const server = new McpServer({ name, version: "1.0.0" });

  server.tool(
    "add",
    "Adds two numbers",
    { a: z.number(), b: z.number() },
    async ({ a, b }) => ({
      content: [{ type: "text" as const, text: String(a + b) }],
    }),
  );

  server.tool(
    "multiply",
    "Multiplies two numbers",
    { a: z.number(), b: z.number() },
    async ({ a, b }) => ({
      content: [{ type: "text" as const, text: String(a * b) }],
    }),
  );

  return server;
}

function createGreeterServer(name = "greeter"): McpServer {
  const server = new McpServer({ name, version: "1.0.0" });

  server.tool(
    "greet",
    "Greets a person",
    { name: z.string() },
    async ({ name }) => ({
      content: [{ type: "text" as const, text: `Hello, ${name}!` }],
    }),
  );

  return server;
}

async function safeClose(server: unknown): Promise<void> {
  if (!server || typeof server !== "object") return;
  if (typeof (server as { close?: () => Promise<void> | void }).close === "function") {
    await (server as { close: () => Promise<void> | void }).close();
  }
}

export function getCompatScenarios(repoRoot: string): CompatScenario[] {
  const defaultCwd = repoRoot;

  return [
    {
      id: "01-simple-text",
      name: "Simple Text",
      description: "No tools, deterministic text response.",
      buildRunConfig: async () => ({
        prompt: "What is 2 + 2? Reply with exactly: 4",
        cwd: defaultCwd,
        tools: [],
        maxTurns: 2,
        maxBudgetUsd: 0.1,
      }),
      assertions: {
        shared: {
          stopReasons: ["success"],
          textIncludes: ["4"],
          maxTurns: 2,
        },
        parity: {
          requireNonEmptyTextBoth: true,
        },
      },
    },
    {
      id: "02-read-package",
      name: "Read package.json",
      description: "Single read flow to verify core tool orchestration.",
      buildRunConfig: async () => ({
        prompt: "Read package.json and tell me only the project name.",
        cwd: defaultCwd,
        tools: { type: "preset", preset: "claude_code" },
        maxTurns: 5,
        maxBudgetUsd: 0.2,
      }),
      assertions: {
        shared: {
          stopReasons: ["success"],
          requiredTools: ["Read"],
          textIncludes: ["fourmis-agents-sdk"],
          maxTurns: 6,
        },
      },
    },
    {
      id: "03-write-read-roundtrip",
      name: "Write + Read Roundtrip",
      description: "Create and read back a temp file with exact payload.",
      buildRunConfig: async (ctx) => {
        const filePath = join(ctx.scratchDir, `roundtrip-${ctx.runId}.txt`);
        const payload = `compatibility-check-${ctx.runId}`;

        return {
          prompt:
            `Write a file at ${filePath} with exactly this content: ${payload}. ` +
            "Then read the same file and reply with exactly that content.",
          cwd: defaultCwd,
          tools: { type: "preset", preset: "claude_code" },
          maxTurns: 8,
          maxBudgetUsd: 0.3,
          cleanup: async () => {
            await rm(filePath, { force: true });
          },
        };
      },
      assertions: {
        shared: {
          stopReasons: ["success"],
          requiredTools: ["Write", "Read"],
          textIncludes: ["compatibility-check-"],
          maxTurns: 8,
        },
      },
    },
    {
      id: "04-missing-file-recovery",
      name: "Missing File Recovery",
      description: "Tool error path where agent must recover gracefully.",
      buildRunConfig: async (ctx) => ({
        prompt:
          `Read ${join(ctx.scratchDir, `does-not-exist-${ctx.runId}.txt`)} and explain what happened in one sentence.`,
        cwd: defaultCwd,
        tools: { type: "preset", preset: "claude_code" },
        maxTurns: 5,
        maxBudgetUsd: 0.2,
      }),
      assertions: {
        shared: {
          stopReasons: ["success"],
          requiredTools: ["Read"],
          textMatches: [/(not found|doesn'?t exist|does not exist|no such file)/i],
          maxTurns: 5,
        },
      },
    },
    {
      id: "05-budget-limit",
      name: "Budget Limit",
      description: "Hard budget stop reason parity.",
      buildRunConfig: async () => ({
        prompt:
          "List every file in the current directory, read each one, and summarize all of them.",
        cwd: defaultCwd,
        tools: { type: "preset", preset: "claude_code" },
        maxTurns: 20,
        maxBudgetUsd: 0.001,
      }),
      assertions: {
        shared: {
          stopReasons: ["error_max_budget_usd"],
          minToolCalls: 1,
          maxTurns: 3,
        },
      },
    },
    {
      id: "06-permissions-settings-deny-bash",
      name: "Permissions via settings.local.json",
      description: "Both SDKs should honor local permission deny rules.",
      buildRunConfig: async (ctx) => {
        const workspace = join(ctx.scratchDir, `perm-${ctx.runId}`);
        const claudeDir = join(workspace, ".claude");
        await mkdir(claudeDir, { recursive: true });
        await writeFile(
          join(claudeDir, "settings.local.json"),
          JSON.stringify({
            permissions: {
              allow: ["Read", "Glob", "Grep", "Write", "Edit"],
              deny: ["Bash"],
            },
          }, null, 2),
          "utf8",
        );

        return {
          prompt: "Use the Bash tool to run exactly: echo compat-permission-check",
          cwd: workspace,
          tools: { type: "preset", preset: "claude_code" },
          maxTurns: 5,
          maxBudgetUsd: 0.2,
          sharedOptions: {
            settingSources: ["local"],
          },
          fourmisOptions: {
            permissionMode: "default",
          },
          anthropicOptions: {
            permissionMode: "acceptEdits",
            settingSources: ["local"],
          },
          cleanup: async () => {
            await rm(workspace, { recursive: true, force: true });
          },
        };
      },
      assertions: {
        shared: {
          stopReasons: ["success"],
          requiredTools: ["Bash"],
          textMatches: [/(denied|not allowed|permission)/i],
          maxTurns: 5,
        },
      },
    },
    {
      id: "07-hooks-observe-read",
      name: "Hooks Observe",
      description: "PreToolUse and PostToolUse hook parity.",
      buildRunConfig: async () => ({
        prompt: "Read package.json and tell me the project name.",
        cwd: defaultCwd,
        tools: { type: "preset", preset: "claude_code" },
        maxTurns: 5,
        maxBudgetUsd: 0.2,
        buildHooks: (_sdk, sink) => ({
          PreToolUse: [
            {
              matcher: "^Read$",
              hooks: [
                async (input) => {
                  sink.push(`PreToolUse:${String(input.tool_name ?? "")}`);
                  return { decision: { behavior: "allow" } };
                },
              ],
            },
          ],
          PostToolUse: [
            {
              matcher: "^Read$",
              hooks: [
                async (input) => {
                  sink.push(`PostToolUse:${String(input.tool_name ?? "")}`);
                  return {};
                },
              ],
            },
          ],
        }),
      }),
      assertions: {
        shared: {
          stopReasons: ["success"],
          requiredTools: ["Read"],
          minHookEvents: 2,
          requiredHookEvents: ["PreToolUse:Read", "PostToolUse:Read"],
        },
      },
    },
    {
      id: "08-hooks-deny-bash",
      name: "Hooks Deny Bash",
      description: "PreToolUse hook denial should block Bash execution.",
      buildRunConfig: async () => ({
        prompt: "Use Bash to run: echo compat-hook-deny and then report the output.",
        cwd: defaultCwd,
        tools: { type: "preset", preset: "claude_code" },
        maxTurns: 5,
        maxBudgetUsd: 0.2,
        buildHooks: (_sdk, sink) => ({
          PreToolUse: [
            {
              matcher: "^Bash$",
              hooks: [
                async () => {
                  sink.push("PreToolUse:Bash:Deny");
                  return {
                    decision: {
                      behavior: "deny",
                      message: "Denied by compatibility harness.",
                    },
                  };
                },
              ],
            },
          ],
        }),
      }),
      assertions: {
        shared: {
          stopReasons: ["success"],
          requiredTools: ["Bash"],
          requiredHookEvents: ["PreToolUse:Bash:Deny"],
          textMatches: [/(denied|not allowed|permission)/i],
          maxTurns: 5,
        },
      },
    },
    {
      id: "09-mcp-single-server",
      name: "MCP Single Server",
      description: "Both SDKs should call mcp__calc__add and return 20.",
      buildRunConfig: async () => ({
        prompt: "Use MCP calculator add to compute 12 + 8 and reply with only the number.",
        cwd: defaultCwd,
        tools: [],
        maxTurns: 5,
        maxBudgetUsd: 0.3,
        anthropicOptions: {
          permissionMode: "bypassPermissions",
        },
        buildMcpServers: () => {
          const fourmisCalc = createCalcServer("calc");
          const anthropicCalc = createCalcServer("calc");
          return {
            fourmis: {
              calc: { type: "sdk", name: "calc", instance: fourmisCalc as any },
            },
            anthropic: {
              calc: { type: "sdk", name: "calc", instance: anthropicCalc as any },
            },
            cleanup: async () => {
              await safeClose(fourmisCalc);
              await safeClose(anthropicCalc);
            },
          };
        },
      }),
      assertions: {
        shared: {
          stopReasons: ["success"],
          requiredTools: ["mcp__calc__add"],
          textIncludes: ["20"],
          maxTurns: 5,
        },
        parity: {
          requiredToolsBoth: ["mcp__calc__add"],
        },
      },
    },
    {
      id: "10-mcp-multi-server",
      name: "MCP Multi Server",
      description: "Both SDKs should route calls across two MCP servers.",
      buildRunConfig: async () => ({
        prompt:
          "Use MCP greeter to greet Ada and calculator multiply 3 by 7. " +
          "Reply in one line containing both the greeting and 21.",
        cwd: defaultCwd,
        tools: [],
        maxTurns: 6,
        maxBudgetUsd: 0.3,
        anthropicOptions: {
          permissionMode: "bypassPermissions",
        },
        buildMcpServers: () => {
          const fourmisCalc = createCalcServer("calc");
          const anthropicCalc = createCalcServer("calc");
          const fourmisGreeter = createGreeterServer("greeter");
          const anthropicGreeter = createGreeterServer("greeter");

          return {
            fourmis: {
              calc: { type: "sdk", name: "calc", instance: fourmisCalc as any },
              greeter: { type: "sdk", name: "greeter", instance: fourmisGreeter as any },
            },
            anthropic: {
              calc: { type: "sdk", name: "calc", instance: anthropicCalc as any },
              greeter: { type: "sdk", name: "greeter", instance: anthropicGreeter as any },
            },
            cleanup: async () => {
              await safeClose(fourmisCalc);
              await safeClose(anthropicCalc);
              await safeClose(fourmisGreeter);
              await safeClose(anthropicGreeter);
            },
          };
        },
      }),
      assertions: {
        shared: {
          stopReasons: ["success"],
          requiredTools: ["mcp__calc__multiply", "mcp__greeter__greet"],
          textIncludes: ["21"],
          maxTurns: 6,
        },
      },
    },
    {
      id: "11-subagent-task",
      name: "Subagent Delegation",
      description: "Parent agent delegates via Task tool to researcher agent.",
      buildRunConfig: async () => ({
        prompt:
          "Delegate to the researcher subagent to read package.json and return only the project name.",
        cwd: defaultCwd,
        tools: { type: "preset", preset: "claude_code" },
        maxTurns: 8,
        maxBudgetUsd: 0.5,
        sharedOptions: {
          agents: {
            researcher: {
              description: "Reads local files and reports project metadata.",
              prompt:
                "You are a researcher. Use tools only as needed. Return concise factual output.",
              tools: ["Read", "Glob", "Grep"],
              maxTurns: 3,
            },
          },
        },
      }),
      assertions: {
        shared: {
          stopReasons: ["success"],
          requiredTools: ["Task"],
          textIncludes: ["fourmis-agents-sdk"],
          maxTurns: 8,
        },
      },
    },
    {
      id: "12-structured-output",
      name: "Structured Output",
      description: "Both SDKs should produce structured_output for json_schema.",
      buildRunConfig: async () => ({
        prompt:
          "Return the sum of 7 + 5 using the required JSON schema. " +
          "Set label to exactly 'sum'.",
        cwd: defaultCwd,
        tools: [],
        maxTurns: 3,
        maxBudgetUsd: 0.15,
        sharedOptions: {
          outputFormat: {
            type: "json_schema",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                value: { type: "number" },
                label: { type: "string" },
              },
              required: ["value", "label"],
            },
          },
        },
      }),
      assertions: {
        shared: {
          stopReasons: ["success"],
          requireStructuredOutput: true,
          maxTurns: 3,
        },
      },
      validateTrace: {
        fourmis: (trace) => {
          const errors: string[] = [];
          const output = trace.structuredOutput;
          if (!output || typeof output !== "object") {
            errors.push("structured_output must be an object");
            return errors;
          }
          const value = (output as { value?: unknown }).value;
          const label = (output as { label?: unknown }).label;
          if (value !== 12) {
            errors.push(`structured_output.value expected 12, got ${String(value)}`);
          }
          if (label !== "sum") {
            errors.push(`structured_output.label expected \"sum\", got ${String(label)}`);
          }
          return errors;
        },
        anthropic: (trace) => {
          const errors: string[] = [];
          const output = trace.structuredOutput;
          if (!output || typeof output !== "object") {
            errors.push("structured_output must be an object");
            return errors;
          }
          const value = (output as { value?: unknown }).value;
          const label = (output as { label?: unknown }).label;
          if (value !== 12) {
            errors.push(`structured_output.value expected 12, got ${String(value)}`);
          }
          if (label !== "sum") {
            errors.push(`structured_output.label expected \"sum\", got ${String(label)}`);
          }
          return errors;
        },
      },
    },
  ];
}
