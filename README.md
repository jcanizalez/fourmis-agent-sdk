# fourmis-agents-sdk

Multi-provider AI agent SDK with direct API access and in-process tool execution.

> **Requires [Bun](https://bun.sh) v1.0+** — this SDK uses Bun-native APIs (`Bun.spawn`, `Bun.Glob`, `Bun.build`) and is not compatible with Node.js.

A TypeScript library that gives you coding agents on **any LLM provider** — same `query()` API, same streaming events, same tool capabilities — without being locked to a single vendor.

## Why?

The [Anthropic Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) is excellent but:
- **Claude-only** — spawns a Claude Code subprocess, no other providers
- **Opaque** — the agent loop runs inside the subprocess
- **~12s startup overhead** per query (subprocess spawn)

`fourmis-agents-sdk` provides:
- **Multi-provider** — Anthropic, OpenAI, and Gemini out of the box, extensible via `registerProvider()`
- **Transparent agent loop** — you control the execution cycle
- **No subprocess overhead** — direct API calls, <100ms startup
- **In-process tool execution** — 6 built-in coding tools

## Quick Start

```ts
import { query } from "fourmis-agents-sdk";

const conversation = query({
  prompt: "Read package.json and tell me the project name",
  options: {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    cwd: "./my-project",
    tools: "coding",  // preset: Bash, Read, Write, Edit, Glob, Grep
    maxTurns: 5,
  },
});

for await (const msg of conversation) {
  if (msg.type === "text") process.stdout.write(msg.text);
  if (msg.type === "tool_use") console.log(`\n[tool] ${msg.name}`);
  if (msg.type === "result") console.log(`\nDone: $${msg.costUsd}`);
}
```

## Features

### Providers

Three built-in providers, with an extensible registry:

| Provider | Auth | Models |
|----------|------|--------|
| `anthropic` | `ANTHROPIC_API_KEY` | Claude Sonnet, Opus, Haiku |
| `openai` | `OPENAI_API_KEY` or Codex OAuth | GPT-4o, o3, etc. |
| `gemini` | `GEMINI_API_KEY` or Gemini CLI OAuth | Gemini 2.5 Pro, Flash, etc. |

```ts
// Use OpenAI
query({ prompt: "...", options: { provider: "openai", model: "gpt-4o" } });

// Use Gemini
query({ prompt: "...", options: { provider: "gemini", model: "gemini-2.5-flash" } });

// Register a custom provider
import { registerProvider } from "fourmis-agents-sdk";
registerProvider("my-provider", myAdapter);
```

### Tools

6 built-in tools with 3 presets:

| Tool | Description |
|------|-------------|
| `Bash` | Shell command execution via `Bun.spawn()` |
| `Read` | File reading with line numbers |
| `Write` | File creation/overwriting |
| `Edit` | String replacement with uniqueness check |
| `Glob` | File pattern matching |
| `Grep` | Regex content search |

```ts
// Presets
tools: "coding"   // All 6: Bash, Read, Write, Edit, Glob, Grep
tools: "readonly"  // Read, Glob, Grep
tools: "minimal"   // Read, Write, Edit, Glob, Grep

// Custom list
tools: ["Read", "Glob", "Grep"]

// Filter tools
allowedTools: ["Read", "Bash"]
disallowedTools: ["Bash"]
```

### Hooks

Lifecycle callbacks for observing and intervening at key points in the agent loop:

| Event | When |
|-------|------|
| `PreToolUse` | Before a tool executes — can deny or modify input |
| `PostToolUse` | After a tool succeeds — can append context |
| `PostToolUseFailure` | After a tool fails or is denied |
| `SessionStart` / `SessionEnd` | Session lifecycle |
| `Stop` | Before the agent returns its final result |
| `Notification` | Informational events |
| `SubagentStart` / `SubagentStop` | Subagent lifecycle |
| `PreCompact` | Before context compaction |
| `PermissionRequest` | When a permission decision is needed |
| `UserPromptSubmit` | When a user prompt is submitted |

```ts
query({
  prompt: "...",
  options: {
    hooks: {
      PreToolUse: [{
        matcher: "Bash",  // regex matched against tool name
        hooks: [async (input) => {
          console.log("Running:", input.tool_input);
          return {};  // or { permissionDecision: "deny" }
        }],
      }],
    },
  },
});
```

### MCP (Model Context Protocol)

Connect to external MCP servers to extend the agent with additional tools. Supports 4 transport types:

```ts
query({
  prompt: "...",
  options: {
    mcpServers: {
      // stdio
      myServer: { command: "node", args: ["server.js"] },
      // SSE
      remote: { type: "sse", url: "http://localhost:3000/sse" },
      // HTTP
      httpServer: { type: "http", url: "http://localhost:3000" },
      // In-process SDK server
      inProc: { type: "sdk", name: "myTools", instance: myMcpServer },
    },
  },
});
```

Create in-process MCP servers with Zod-typed tools:

```ts
import { createMcpServer, mcpTool } from "fourmis-agents-sdk";
import { z } from "zod";

const server = createMcpServer({
  name: "my-tools",
  tools: [
    mcpTool("greet", "Say hello", z.object({ name: z.string() }), async ({ name }) => ({
      content: [{ type: "text", text: `Hello, ${name}!` }],
    })),
  ],
});
```

### Subagents

Define specialized agents that the main agent can spawn via the `Task` tool:

```ts
query({
  prompt: "Refactor the auth module",
  options: {
    agents: {
      researcher: {
        description: "Reads code and answers questions",
        prompt: "You are a code researcher. Read files and answer questions.",
        tools: ["Read", "Glob", "Grep"],
        model: "claude-haiku-4-5-20251001",
      },
      coder: {
        description: "Writes and edits code",
        prompt: "You are a code editor.",
        tools: ["Read", "Write", "Edit", "Glob", "Grep"],
        provider: "openai",  // can use a different provider per agent
      },
    },
  },
});
```

Subagents run as background tasks managed by a `TaskManager` and expose `Task`, `TaskOutput`, and `TaskStop` tools to the parent agent.

### Permissions

6 permission modes control what the agent can do:

| Mode | Behavior |
|------|----------|
| `default` | Allow all (host app handles permissions) |
| `bypassPermissions` | Allow everything unconditionally |
| `acceptEdits` | Auto-approve read + file edit tools |
| `plan` | Read-only tools only |
| `delegate` | Team coordination tools only |
| `dontAsk` | Deny anything not in the allow list |

```ts
query({
  prompt: "...",
  options: {
    permissionMode: "acceptEdits",
    permissions: {
      allow: ["Read", "Glob", "Grep", { toolName: "Bash", ruleContent: "npm test" }],
      deny: ["Bash"],
    },
    // Or provide a custom callback
    canUseTool: async (toolName, input, options) => {
      return { behavior: "allow" };
    },
  },
});
```

### Settings Files

Load permissions from `.claude/settings*.json` files (compatible with Claude Code's format):

```ts
query({
  prompt: "...",
  options: {
    settingSources: ["user", "project", "local"],
    // Loads from:
    //   ~/.claude/settings.json (user-wide)
    //   <cwd>/.claude/settings.json (project, shared)
    //   <cwd>/.claude/settings.local.json (personal, gitignored)
  },
});
```

## Configuration Reference

All options passed via `QueryOptions`:

```ts
query({
  prompt: "...",
  options: {
    // Provider
    provider: "anthropic",       // "anthropic" | "openai" | "gemini" | custom
    apiKey: "sk-...",            // Override env var
    baseUrl: "https://...",      // Custom endpoint

    // Core
    model: "claude-sonnet-4-5-20250929",
    cwd: "/path/to/project",
    systemPrompt: "You are...",
    maxTurns: 10,                // Default: 10
    maxBudgetUsd: 5,             // Default: $5
    maxThinkingTokens: 10000,

    // Tools
    tools: "coding",             // Preset name or string[]
    allowedTools: ["Read"],      // Whitelist
    disallowedTools: ["Bash"],   // Blacklist

    // Permissions
    permissionMode: "default",
    canUseTool: async () => ({ behavior: "allow" }),
    permissions: { allow: [...], deny: [...] },
    settingSources: ["user", "project", "local"],

    // Streaming
    includeStreamEvents: false,  // Emit text_delta/thinking_delta events

    // Hooks, MCP, Subagents (see sections above)
    hooks: { ... },
    mcpServers: { ... },
    agents: { ... },

    // Debug
    debug: false,
    signal: abortController.signal,
    env: { PATH: "..." },
  },
});
```

## Message Types

The query yields `AgentMessage` events:

| Type | Description |
|------|-------------|
| `init` | Session started — includes model, provider, tools, cwd |
| `text` | Assistant text output |
| `tool_use` | Tool invocation (name, input) |
| `tool_result` | Tool result (content, isError) |
| `stream` | Streaming delta (text or thinking) — only with `includeStreamEvents: true` |
| `result` (success) | Final result with cost, duration, usage stats |
| `result` (error) | Error result (execution error, max turns, max budget) |
| `status` | Status update |

## Runtime

Built for [Bun](https://bun.sh). Uses `Bun.spawn()` for the Bash tool and `Bun.Glob` for pattern matching.

```sh
bun add fourmis-agents-sdk
bun test
```
