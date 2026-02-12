# Architecture: fourmis-agents

## Overview

fourmis-agents is structured in 5 layers, from bottom (provider APIs) to top (public API).

```
┌─────────────────────────────────────────────────┐
│  Layer 5: Public API                            │
│  query() → AsyncGenerator<AgentMessage>         │
│  createMcpServer(), mcpTool()                   │
├─────────────────────────────────────────────────┤
│  Layer 4: Agent Loop                            │
│  prompt → LLM → tool calls → execute → repeat  │
│  Permission checks, hooks, subagent spawn       │
├─────────────────────────────────────────────────┤
│  Layer 3: Tool System                           │
│  Built-in tools (Bash, Read, Write, Edit,       │
│  Glob, Grep) + MCP tools + subagent tools       │
├─────────────────────────────────────────────────┤
│  Layer 2: Provider Adapters                     │
│  Anthropic, OpenAI, Gemini adapters             │
│  Normalize: messages, tool calls, streaming     │
├─────────────────────────────────────────────────┤
│  Layer 1: Provider APIs                         │
│  @anthropic-ai/sdk, openai, @google/genai       │
└─────────────────────────────────────────────────┘
```

## Layer 1: Provider APIs

Official SDKs for each provider:

```ts
import Anthropic from "@anthropic-ai/sdk";      // Anthropic direct API
import OpenAI from "openai";                    // OpenAI
import { GoogleGenAI } from "@google/genai";    // Gemini (API key mode)
```

No subprocess spawning — we call APIs directly.

## Layer 2: Provider Adapters

Each adapter implements `ProviderAdapter`, normalizing a provider's API into a common streaming interface:

```ts
interface ProviderAdapter {
  name: string;
  chat(request: ChatRequest): AsyncGenerator<ChatChunk>;
  calculateCost(model: string, usage: TokenUsage): number;
  getContextWindow(model: string): number;
  supportsFeature(feature: ProviderFeature): boolean;
}
```

The adapters handle translation of tool call formats (Anthropic's `content[].type = "tool_use"` vs OpenAI's `tool_calls[].function` vs Gemini's `functionCall`/`functionResponse` parts) and tool result formats transparently.

The Gemini adapter operates in two modes:
- **API key mode** — uses `@google/genai` SDK with `generateContentStream()`
- **OAuth mode** — direct HTTP to Google's Code Assist endpoint (`cloudcode-pa.googleapis.com`) with SSE streaming, using tokens from `gemini login` CLI

New providers can be added via `registerProvider()`.

## Layer 3: Tool System

### Tool Registry

```ts
class ToolRegistry {
  register(tool: ToolImplementation): void;
  getDefinitions(): ToolDefinition[];
  execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult>;
  list(): string[];
}
```

6 built-in tools are available in 3 presets (`coding`, `readonly`, `minimal`). MCP tools and subagent tools (Task, TaskOutput, TaskStop) are registered dynamically at runtime.

### Tool Context

```ts
type ToolContext = {
  cwd: string;
  signal: AbortSignal;
  sessionId: string;
  env?: Record<string, string>;
};
```

## Layer 4: Agent Loop

The core execution engine (`agent-loop.ts`). An `AsyncGenerator<AgentMessage>` that:

1. Sends messages to the LLM via the provider adapter
2. Streams text deltas as events
3. Collects tool calls from the response
4. Fires `PreToolUse` hooks (can deny or modify input)
5. Checks permissions via `PermissionManager`
6. Executes tools via the registry
7. Fires `PostToolUse` / `PostToolUseFailure` hooks
8. Feeds results back to the LLM
9. Repeats until no tool calls remain or limits are hit

Limits: `maxTurns`, `maxBudgetUsd`, `AbortSignal`.

## Layer 5: Public API

### `query()`

Single entry point — creates a provider, builds a tool registry, sets up permissions/hooks/MCP/subagents, and returns a `Query` (AsyncGenerator with `interrupt()` and `close()` control methods).

### `createMcpServer()` / `mcpTool()`

Create in-process MCP servers with Zod-typed tool definitions.

### `registerProvider()` / `getProvider()`

Manage the provider registry. Built-in providers (`anthropic`, `openai`) are lazy-created on first use.

## File Structure

```
fourmis-agents/
├── src/
│   ├── index.ts                 # Public API exports
│   ├── api.ts                   # query() implementation
│   ├── query.ts                 # Query wrapper (AsyncGenerator + control methods)
│   ├── types.ts                 # All core types (messages, permissions, options)
│   ├── agent-loop.ts            # Core agent execution loop
│   ├── permissions.ts           # Permission manager (6 modes + rules + callback)
│   ├── hooks.ts                 # Hook system (12 event types)
│   ├── settings.ts              # Settings file loader (.claude/settings*.json)
│   │
│   ├── providers/
│   │   ├── types.ts             # ProviderAdapter interface, ChatRequest, ChatChunk
│   │   ├── registry.ts          # Provider registry (register/get)
│   │   ├── anthropic.ts         # Anthropic API adapter
│   │   ├── openai.ts            # OpenAI API adapter (API key + Codex OAuth)
│   │   └── gemini.ts            # Gemini API adapter (API key + CLI OAuth)
│   │
│   ├── tools/
│   │   ├── registry.ts          # ToolRegistry class
│   │   ├── presets.ts           # Tool presets (coding, readonly, minimal)
│   │   ├── bash.ts              # Shell execution via Bun.spawn()
│   │   ├── read.ts              # File reading with line numbers
│   │   ├── write.ts             # File creation/overwriting
│   │   ├── edit.ts              # String replacement editing
│   │   ├── glob.ts              # File pattern matching
│   │   ├── grep.ts              # Regex content search
│   │   └── mcp-resources.ts     # MCP resource listing/reading tools
│   │
│   ├── mcp/
│   │   ├── index.ts             # Re-exports
│   │   ├── client.ts            # MCP client (connect to external servers)
│   │   ├── server.ts            # In-process MCP server + tool() helper
│   │   └── types.ts             # MCP config types (stdio, SSE, HTTP, SDK)
│   │
│   ├── agents/
│   │   ├── index.ts             # Re-exports
│   │   ├── types.ts             # AgentDefinition, BackgroundTask
│   │   ├── task-manager.ts      # Background task lifecycle
│   │   └── tools.ts             # Task, TaskOutput, TaskStop tool implementations
│   │
│   ├── auth/
│   │   ├── login-openai.ts      # OpenAI Codex login flow
│   │   ├── openai-oauth.ts      # OpenAI OAuth token management
│   │   └── gemini-oauth.ts      # Gemini CLI OAuth token management
│   │
│   └── utils/
│       ├── cost.ts              # Per-model cost tables
│       └── system-prompt.ts     # Default system prompt builder
│
├── tests/
│   ├── agent-loop.test.ts
│   ├── hooks.test.ts
│   ├── integration.test.ts
│   ├── providers/
│   │   ├── anthropic.test.ts
│   │   ├── openai.test.ts
│   │   └── openai-integration.test.ts
│   ├── tools/
│   │   ├── bash.test.ts
│   │   ├── edit.test.ts
│   │   ├── glob.test.ts
│   │   ├── grep.test.ts
│   │   ├── read.test.ts
│   │   └── write.test.ts
│   ├── mcp/
│   │   ├── client.test.ts
│   │   ├── sdk-server.test.ts
│   │   └── integration.test.ts
│   ├── agents/
│   │   ├── task-manager.test.ts
│   │   ├── tools.test.ts
│   │   └── integration.test.ts
│   ├── auth/
│   │   ├── openai-oauth.test.ts
│   │   └── openai-codex-integration.test.ts
│   └── compare/               # SDK comparison scenarios
│       └── scenarios/
│
├── package.json
├── tsconfig.json
├── README.md
└── ARCHITECTURE.md
```
