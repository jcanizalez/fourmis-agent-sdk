# fourmis-agents-sdk

Multi-provider AI agent SDK with direct API access and in-process tool execution.

> Requires [Bun](https://bun.sh) v1.0+. This SDK uses Bun-native APIs (`Bun.spawn`, `Bun.Glob`, `Bun.build`) and is not Node runtime-compatible for host execution.

## What It Is

`fourmis-agents-sdk` provides a single `query()` API that works across providers while keeping the agent loop transparent and controllable.

- Multi-provider: Anthropic, OpenAI, Gemini (plus custom providers via registry)
- Claude-style message envelopes (`system`, `assistant`, `user`, `stream_event`, `result`)
- In-process tool execution (file/system/web/notebook/config/todo)
- Hooks, permissions, MCP servers, subagents, skills, and memory

## Quick Start

```ts
import { query } from "fourmis-agents-sdk";

const conversation = query({
  prompt: "Read package.json and tell me the project name.",
  options: {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    cwd: process.cwd(),
    tools: { type: "preset", preset: "claude_code" },
    maxTurns: 5,
  },
});

for await (const msg of conversation) {
  if (msg.type === "assistant") {
    for (const block of msg.message.content) {
      if (block.type === "text") process.stdout.write(block.text);
    }
  }

  if (msg.type === "result") {
    console.log(`\nstop=${msg.subtype} cost=$${msg.total_cost_usd.toFixed(4)}`);
  }
}
```

## Providers

Built-in providers:

| Provider | Auth |
| --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` or Claude OAuth token |
| `openai` | `OPENAI_API_KEY` or OpenAI/Codex OAuth |
| `gemini` | `GEMINI_API_KEY` or Gemini CLI OAuth |

```ts
import { query, registerProvider } from "fourmis-agents-sdk";

query({ prompt: "...", options: { provider: "openai", model: "gpt-4.1-mini" } });
query({ prompt: "...", options: { provider: "gemini", model: "gemini-2.5-flash" } });

registerProvider("my-provider", myAdapter);
```

## Tools

Current built-in tools:

| Tool | Purpose |
| --- | --- |
| `Bash` | Shell command execution |
| `Read` | Read files with line numbers |
| `Write` | Write/overwrite files |
| `Edit` | Exact string replacement |
| `Glob` | File pattern matching |
| `Grep` | Regex content search |
| `NotebookEdit` | Edit Jupyter notebook cells |
| `WebFetch` | Fetch URL content |
| `WebSearch` | Lightweight web search |
| `TodoWrite` | Persist todo state |
| `Config` | Read/write `.claude/settings*.json` |
| `AskUserQuestion` | Ask user (returns runtime-unavailable error in this host mode) |
| `ExitPlanMode` | Request exit from plan mode |

Tool configuration:

```ts
query({
  prompt: "...",
  options: {
    // Exposed preset
    tools: { type: "preset", preset: "claude_code" },

    // Or explicit list
    // tools: ["Read", "Glob", "Grep"],

    allowedTools: ["Read", "Glob", "Grep"],
    disallowedTools: ["Bash"],
  },
});
```

## Hooks

Lifecycle hooks can observe and influence execution:

- `PreToolUse`, `PostToolUse`, `PostToolUseFailure`
- `SessionStart`, `SessionEnd`, `Stop`, `Notification`
- `SubagentStart`, `SubagentStop`, `PreCompact`, `PermissionRequest`
- `UserPromptSubmit`, `Setup`, `TeammateIdle`, `TaskCompleted`

```ts
query({
  prompt: "...",
  options: {
    hooks: {
      PreToolUse: [
        {
          matcher: "^Bash$",
          hooks: [
            async () => ({
              decision: { behavior: "deny", message: "Blocked by policy." },
            }),
          ],
        },
      ],
    },
  },
});
```

## MCP (Model Context Protocol)

Supports `stdio`, `sse`, `http`, and in-process `sdk` MCP servers.

```ts
query({
  prompt: "...",
  options: {
    mcpServers: {
      stdioServer: { command: "node", args: ["server.js"] },
      remoteSse: { type: "sse", url: "http://localhost:3000/sse" },
      remoteHttp: { type: "http", url: "http://localhost:3000" },
      inProc: { type: "sdk", name: "my-tools", instance: myMcpServer },
    },
  },
});
```

Create in-process MCP server configs:

```ts
import { createMcpServer, mcpTool } from "fourmis-agents-sdk";
import { z } from "zod";

const mcpConfig = createMcpServer({
  name: "my-tools",
  tools: [
    mcpTool("greet", "Say hello", { name: z.string() }, async ({ name }) => {
      return `Hello, ${name}!`;
    }),
  ],
});
```

## Subagents

Define agent roles and let the parent invoke them with `Task`:

```ts
query({
  prompt: "Delegate to researcher and report package name.",
  options: {
    agents: {
      researcher: {
        description: "Reads code and reports facts.",
        prompt: "Be concise and factual.",
        tools: ["Read", "Glob", "Grep"],
        maxTurns: 3,
      },
    },
  },
});
```

## Permissions and Settings

Permission modes:
- `default`
- `acceptEdits`
- `bypassPermissions` (requires `allowDangerouslySkipPermissions: true`)
- `plan`
- `delegate`
- `dontAsk`

You can combine:
- explicit `permissions` allow/deny rules
- dynamic `canUseTool` callback
- settings-file loading via `settingSources: ["user", "project", "local"]`

## Compatibility Harness

A strict side-by-side harness compares Fourmis vs `@anthropic-ai/claude-agent-sdk`.

Run:

```bash
bun run test:compat
```

Useful env vars:

- `COMPAT_REPEATS=3`
- `COMPAT_SCENARIOS=01-simple-text,02-read-package`
- `COMPAT_OUTPUT_DIR=/absolute/path`

Artifacts per run:

- `tests/compat/output/<timestamp>/summary.json`
- `tests/compat/output/<timestamp>/report.md`
- `tests/compat/output/<timestamp>/traces/*.json`

Current baseline (2026-02-17): 11/12 scenarios passing, with a known hook-deny mismatch in `08-hooks-deny-bash` on the Anthropic side.

## Message Model

`query()` yields `AgentMessage` envelopes, primarily:

- `system` (`init`, `status`, hook/task events)
- `assistant` (text and `tool_use` blocks)
- `user` (tool results)
- `stream_event` (partial deltas)
- `tool_progress`, `tool_use_summary`
- `result` (`success` or error subtype)

## Install and Test

```bash
bun add fourmis-agents-sdk
bun test
bun run test:compat
```
