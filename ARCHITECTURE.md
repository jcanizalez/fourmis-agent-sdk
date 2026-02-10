# Architecture: fourmis-agents

## Overview

fourmis-agents is structured in 5 layers, from bottom (provider APIs) to top (public API).

```
┌─────────────────────────────────────────────────┐
│  Layer 5: Public API                            │
│  query() → AsyncGenerator<AgentMessage>         │
│  createMcpServer(), tool()                      │
├─────────────────────────────────────────────────┤
│  Layer 4: Agent Loop                            │
│  prompt → LLM → tool calls → execute → repeat  │
│  Planning, context compaction, subagent spawn   │
├─────────────────────────────────────────────────┤
│  Layer 3: Tool System                           │
│  Built-in tools (Bash, Read, Write, Edit...)    │
│  MCP tools, custom tools, tool registry         │
├─────────────────────────────────────────────────┤
│  Layer 2: Provider Adapters                     │
│  Anthropic, OpenAI, Google, Ollama adapters     │
│  Normalize: messages, tool calls, streaming     │
├─────────────────────────────────────────────────┤
│  Layer 1: Provider APIs (raw HTTP)              │
│  @anthropic-ai/sdk, openai, @google/genai       │
│  Or raw fetch() calls                           │
└─────────────────────────────────────────────────┘
```

---

## Layer 1: Provider APIs

Raw SDK calls or fetch requests to each provider's API.

```ts
// We use official SDKs where available, raw fetch otherwise
import Anthropic from "@anthropic-ai/sdk";        // Anthropic direct API
import OpenAI from "openai";                       // OpenAI
import { GoogleGenAI } from "@google/genai";       // Google
// Ollama: raw fetch to localhost
```

**No subprocess spawning.** Unlike the Anthropic Agent SDK, we call APIs directly.

---

## Layer 2: Provider Adapters

Each adapter normalizes a provider's API into a common interface:

```ts
interface ProviderAdapter {
  name: string;

  // Core: send messages, get response with tool calls
  chat(request: ChatRequest): AsyncGenerator<ChatChunk>;

  // Metadata
  calculateCost(usage: TokenUsage): number;
  getContextWindow(model: string): number;
  supportsFeature(feature: ProviderFeature): boolean;
}

type ChatRequest = {
  model: string;
  messages: Message[];          // Normalized message format
  tools?: ToolDefinition[];     // Normalized tool definitions
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  thinkingBudget?: number;
  outputFormat?: JsonSchema;
  signal?: AbortSignal;
};

type ChatChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_call_delta"; id: string; inputDelta: string }
  | { type: "thinking_delta"; text: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; stopReason: StopReason };

type ProviderFeature =
  | "thinking"
  | "streaming"
  | "tool_calling"
  | "structured_output"
  | "web_search"
  | "computer_use"
  | "image_input"
  | "pdf_input";
```

### Key normalization challenges

**Tool calling format differs:**
```
Anthropic: content[].type = "tool_use", content[].id, content[].name, content[].input
OpenAI:    tool_calls[].id, tool_calls[].function.name, tool_calls[].function.arguments (JSON string)
Google:    candidates[].content.parts[].functionCall.name, .args
Ollama:    message.tool_calls[].function.name, .arguments
```

**Tool result format differs:**
```
Anthropic: role: "user", content: [{ type: "tool_result", tool_use_id, content }]
OpenAI:    role: "tool", tool_call_id, content
Google:    role: "function", parts: [{ functionResponse: { name, response } }]
```

The adapter layer handles all of this translation transparently.

---

## Layer 3: Tool System

### Tool Registry

```ts
class ToolRegistry {
  // Built-in coding tools
  register(tool: ToolImplementation): void;

  // MCP tools (discovered at runtime)
  registerMcp(serverName: string, tools: McpTool[]): void;

  // Custom tools (user-defined via createMcpServer or tool())
  registerCustom(tool: ToolImplementation): void;

  // Get tools for LLM (as ToolDefinition[])
  getDefinitions(filter?: ToolFilter): ToolDefinition[];

  // Execute a tool call
  execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult>;
}

interface ToolImplementation {
  name: string;
  description: string;
  inputSchema: JsonSchema;       // JSON Schema for the tool input
  annotations?: ToolAnnotations; // read-only, destructive, etc.
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  sessionId: string;
  permissions: PermissionManager;
  onProgress?: (elapsed: number) => void;  // For tool_progress events
}
```

### Built-in Tool Presets

```ts
const PRESETS = {
  coding: [
    "Bash", "Read", "Write", "Edit", "Glob", "Grep",
    "WebSearch", "WebFetch", "TodoWrite", "Task",
    "TaskOutput", "TaskStop", "AskUserQuestion",
  ],
  readonly: [
    "Read", "Glob", "Grep", "WebSearch", "WebFetch",
  ],
  minimal: [
    "Read", "Write", "Edit",
  ],
};
```

### Built-in Tool Implementations

Each tool is a standalone module:

```
tools/
├── bash.ts           # Shell execution via Bun.spawn()
├── read.ts           # File reading with line numbers, PDF, images
├── write.ts          # File writing
├── edit.ts           # String replacement with uniqueness check
├── glob.ts           # File pattern matching
├── grep.ts           # Regex search (ripgrep or JS fallback)
├── web-search.ts     # Web search (provider API or Brave/Tavily)
├── web-fetch.ts      # URL fetch + HTML→markdown
├── todo-write.ts     # Task list management
├── task.ts           # Subagent spawning
├── task-output.ts    # Background task output
├── task-stop.ts      # Stop background tasks
├── ask-user.ts       # Multi-choice user questions
├── exit-plan-mode.ts # Plan mode management
├── notebook-edit.ts  # Jupyter notebook editing
└── mcp-proxy.ts      # MCP tool proxy (calls external MCP servers)
```

---

## Layer 4: Agent Loop

The core execution engine. This is what makes it a "deep agent" vs a simple tool loop.

```ts
async function* agentLoop(options: AgentLoopOptions): AsyncGenerator<AgentMessage> {
  const { adapter, tools, messages, compactor, planner, hooks } = options;

  yield { type: "init", ... };
  await hooks.emit("SessionStart", ...);

  while (true) {
    // 1. Check limits
    if (turns >= maxTurns) { yield errorResult("max_turns"); return; }
    if (costUsd >= maxBudgetUsd) { yield errorResult("max_budget"); return; }

    // 2. Context compaction (if needed)
    if (compactor.shouldCompact(messages)) {
      await hooks.emit("PreCompact", ...);
      yield { type: "status", status: "compacting" };
      messages = await compactor.compact(messages, adapter);
      yield { type: "compact", metadata: ... };
      yield { type: "status", status: null };
    }

    // 3. Call LLM
    const toolDefs = tools.getDefinitions();
    const chunks = adapter.chat({ model, messages, tools: toolDefs, systemPrompt, ... });

    let assistantMessage = { role: "assistant", content: [] };
    let toolCalls = [];

    for await (const chunk of chunks) {
      if (chunk.type === "text_delta") yield { type: "text", text: chunk.text };
      if (chunk.type === "tool_call") toolCalls.push(chunk);
      if (chunk.type === "usage") totalUsage = mergeUsage(totalUsage, chunk.usage);
      // ... accumulate full assistant message
    }

    messages.push(assistantMessage);
    turns++;
    costUsd += adapter.calculateCost(totalUsage);

    // 4. If no tool calls → done
    if (toolCalls.length === 0) {
      yield successResult(...);
      return;
    }

    // 5. Execute tool calls (parallel where possible)
    for (const call of toolCalls) {
      // Permission check
      const permission = await checkPermission(call, hooks);
      if (permission.behavior === "deny") {
        yield { type: "tool_result", id: call.id, error: permission.message };
        continue;
      }

      yield { type: "tool_use", name: call.name, input: call.input };

      // Hook: PreToolUse
      await hooks.emit("PreToolUse", { tool_name: call.name, tool_input: call.input });

      // Execute
      const result = await tools.execute(call.name, call.input, context);

      // Hook: PostToolUse
      await hooks.emit("PostToolUse", { tool_name: call.name, tool_response: result });

      messages.push(toolResultMessage(call.id, result));
    }

    // 6. Loop back to step 1
  }
}
```

### Context Compactor

Three-phase compaction strategy (same as Claude Code / LangChain Deep Agents):

```ts
class ContextCompactor {
  constructor(
    private contextWindow: number,     // From provider adapter
    private threshold: number = 0.85,  // Trigger at 85% capacity
  ) {}

  shouldCompact(messages: Message[]): boolean {
    return estimateTokens(messages) > this.contextWindow * this.threshold;
  }

  async compact(messages: Message[], adapter: ProviderAdapter): Promise<Message[]> {
    // Phase 1: Offload large tool results to filesystem
    messages = this.offloadLargeResults(messages);

    if (!this.shouldCompact(messages)) return messages;

    // Phase 2: Truncate old tool inputs (preserve recent ones)
    messages = this.truncateOldToolInputs(messages);

    if (!this.shouldCompact(messages)) return messages;

    // Phase 3: LLM-based summarization
    messages = await this.summarize(messages, adapter);

    return messages;
  }
}
```

### Subagent Spawning

When the Task tool is called:

```ts
// The Task tool spawns a new agentLoop in a separate async context
async executeTask(input: TaskInput, context: ToolContext): Promise<ToolResult> {
  const agentDef = agents[input.subagent_type];

  // Create isolated conversation
  const subMessages = [{ role: "user", content: input.prompt }];
  const subAdapter = resolveAdapter(agentDef.model);  // Could be different provider!

  if (input.run_in_background) {
    // Background: run in parallel, return task_id
    const taskId = spawnBackgroundTask(agentDef, subMessages, subAdapter);
    return { content: `Task ${taskId} started in background` };
  }

  // Foreground: run inline, return result
  const result = await runSubagent(agentDef, subMessages, subAdapter);
  return { content: result.text };
}
```

---

## Layer 5: Public API

### Primary: `query()`

```ts
export function query(params: {
  prompt: string | AsyncIterable<UserMessage>;
  options?: QueryOptions;
}): Query;
```

Mirrors the Anthropic Agent SDK's `query()` signature exactly, but with `provider` added to options.

### Helper: `createMcpServer()`

```ts
export function createMcpServer(options: {
  name: string;
  version?: string;
  tools?: McpToolDefinition[];
}): McpServerConfig;
```

Creates an in-process MCP server (same as Anthropic's `createSdkMcpServer()`).

### Helper: `tool()`

```ts
export function tool<T extends ZodSchema>(
  name: string,
  description: string,
  inputSchema: T,
  handler: (args: z.infer<T>) => Promise<ToolResult>,
  extras?: { annotations?: ToolAnnotations },
): McpToolDefinition;
```

Define custom tools with Zod schemas (same as Anthropic's `tool()`).

### Provider Registration

```ts
export function registerProvider(name: string, adapter: ProviderAdapter): void;

// Built-in providers
import { anthropic } from "fourmis-agents/providers/anthropic";
import { openai } from "fourmis-agents/providers/openai";
import { google } from "fourmis-agents/providers/google";
import { ollama } from "fourmis-agents/providers/ollama";
```

---

## File Structure

```
fourmis-agents/
├── src/
│   ├── index.ts                 # Public API: query(), createMcpServer(), tool()
│   ├── types.ts                 # All public types
│   ├── query.ts                 # Query class implementation
│   │
│   ├── agent-loop.ts            # Core agent execution loop
│   ├── compactor.ts             # Context compaction engine
│   ├── session.ts               # Session persistence/resume/fork
│   ├── permissions.ts           # Permission management
│   ├── hooks.ts                 # Hook system (15 events)
│   ├── sandbox.ts               # Command sandboxing
│   │
│   ├── providers/
│   │   ├── types.ts             # ProviderAdapter interface
│   │   ├── registry.ts          # Provider registry
│   │   ├── anthropic.ts         # Anthropic API adapter
│   │   ├── openai.ts            # OpenAI API adapter
│   │   ├── google.ts            # Google Gemini adapter
│   │   └── ollama.ts            # Ollama adapter
│   │
│   ├── tools/
│   │   ├── registry.ts          # Tool registry
│   │   ├── presets.ts           # Tool presets (coding, readonly, minimal)
│   │   ├── bash.ts              # Shell execution
│   │   ├── read.ts              # File reading
│   │   ├── write.ts             # File writing
│   │   ├── edit.ts              # File editing
│   │   ├── glob.ts              # Pattern matching
│   │   ├── grep.ts              # Regex search
│   │   ├── web-search.ts        # Web search
│   │   ├── web-fetch.ts         # URL fetching
│   │   ├── todo-write.ts        # Task list
│   │   ├── task.ts              # Subagent spawning
│   │   ├── task-output.ts       # Background task output
│   │   ├── task-stop.ts         # Stop background tasks
│   │   ├── ask-user.ts          # User questions
│   │   ├── exit-plan-mode.ts    # Plan mode
│   │   └── notebook-edit.ts     # Jupyter notebooks
│   │
│   ├── mcp/
│   │   ├── client.ts            # MCP client (connect to external servers)
│   │   ├── server.ts            # In-process MCP server
│   │   └── transports.ts        # stdio, SSE, HTTP transports
│   │
│   └── utils/
│       ├── tokens.ts            # Token estimation
│       ├── cost.ts              # Cost calculation tables
│       ├── markdown.ts          # HTML→markdown conversion
│       └── system-prompt.ts     # Default system prompt builder
│
├── tests/
│   ├── agent-loop.test.ts
│   ├── compactor.test.ts
│   ├── providers/
│   │   ├── anthropic.test.ts
│   │   ├── openai.test.ts
│   │   └── ...
│   └── tools/
│       ├── bash.test.ts
│       ├── edit.test.ts
│       └── ...
│
├── package.json
├── tsconfig.json
├── README.md
├── ARCHITECTURE.md
├── CAPABILITIES.md
└── ROADMAP.md
```

---

## Integration with fourmis

fourmis would use fourmis-agents as a dependency:

```ts
// fourmis/providers/generic.ts
import { query, type AgentMessage, type QueryResult } from "fourmis-agents";
import type { Provider, ProviderRunOptions, RunResult, AgentEvent } from "./types.ts";

export const genericProvider: Provider = {
  name: "generic",
  presets: [{ name: "coding", label: "Coding (all tools)" }],
  tools: [/* same list */],

  async run(opts, onEvent, onHandle) {
    const conversation = query({
      prompt: opts.prompt,
      options: {
        provider: opts.providerConfig?.provider as string ?? "openai",
        model: opts.model,
        cwd: opts.cwd,
        tools: opts.tools === "claude_code" ? "coding" : opts.tools,
        maxTurns: opts.maxTurns,
        maxBudgetUsd: opts.maxBudgetUsd,
        systemPrompt: opts.systemPrompt,
        mcpServers: opts.mcpServers,
        canUseTool: opts.canUseTool,
      },
    });

    onHandle?.({
      interrupt: () => conversation.interrupt(),
      setModel: (m) => conversation.setModel(m),
      close: () => conversation.close(),
    });

    let result: QueryResult | null = null;

    for await (const msg of conversation) {
      if (msg.type === "text") onEvent?.({ type: "text", text: msg.text });
      if (msg.type === "tool_use") onEvent?.({ type: "tool_use", name: msg.name, input: msg.input });
      if (msg.type === "init") onEvent?.({ type: "init", model: msg.model, toolCount: msg.toolCount, sessionId: msg.sessionId });
      if (msg.type === "result") result = msg;
    }

    if (!result) return null;
    return {
      text: result.text,
      turns: result.turns,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      sessionId: result.sessionId,
    };
  },
};
```

Then in `agents.json`:
```jsonc
{
  "forja": { "provider": "claude", "model": "claude-opus-4-6" },         // Existing subprocess
  "ops":   { "provider": "openai", "model": "gpt-5.2" },                // fourmis-agents
  "writer": { "provider": "google", "model": "gemini-2.5-pro" },        // fourmis-agents
  "local": { "provider": "ollama", "model": "qwen3:32b" }               // fourmis-agents
}
```
