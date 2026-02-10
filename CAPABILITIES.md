# Capabilities: Anthropic Agent SDK vs fourmis-agents

This document maps every capability of the Anthropic Agent SDK (v0.2.34) and defines how fourmis-agents will implement each one.

---

## 1. Core API

### Anthropic Agent SDK
```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const conversation = query({
  prompt: "fix the bug",
  options: { model: "claude-opus-4-6", cwd: "/project", maxTurns: 20 }
});

for await (const msg of conversation) { /* SDKMessage stream */ }
```

- `query()` spawns a Claude Code subprocess
- Returns `Query` (AsyncGenerator<SDKMessage>)
- Prompt can be `string` or `AsyncIterable<SDKUserMessage>` for multi-turn

### fourmis-agents equivalent
```ts
import { query } from "fourmis-agents";

const conversation = query({
  prompt: "fix the bug",
  options: { provider: "openai", model: "gpt-5.2", cwd: "/project", maxTurns: 20 }
});

for await (const msg of conversation) { /* AgentMessage stream */ }
```

- `query()` calls provider API directly, runs tool loop in-process
- Returns `Query` (AsyncGenerator<AgentMessage>)
- Same prompt types supported

---

## 2. Query Control Methods

| Method | Anthropic SDK | fourmis-agents | Notes |
|--------|--------------|----------------|-------|
| `interrupt()` | ✅ | ✅ | Cancel current execution |
| `setModel(model)` | ✅ | ✅ | Switch model mid-session |
| `setPermissionMode(mode)` | ✅ | ✅ | Change permission mode |
| `setMaxThinkingTokens(n)` | ✅ | ✅ Provider-dependent | Only Anthropic/OpenAI support thinking |
| `initializationResult()` | ✅ | ✅ | Return init metadata |
| `supportedModels()` | ✅ | ✅ | List models for current provider |
| `mcpServerStatus()` | ✅ | ✅ | MCP connection health |
| `reconnectMcpServer(name)` | ✅ | ✅ | Reconnect failed MCP |
| `toggleMcpServer(name, on)` | ✅ | ✅ | Enable/disable MCP server |
| `setMcpServers(servers)` | ✅ | ✅ | Dynamic MCP management |
| `rewindFiles(msgId)` | ✅ | ✅ | File state rollback |
| `streamInput(stream)` | ✅ | ✅ | Multi-turn streaming input |
| `close()` | ✅ | ✅ | Force close |
| `supportedCommands()` | ✅ | ✅ | List available commands |
| `accountInfo()` | ✅ | 🔄 Provider-specific | Different per provider |

---

## 3. Message/Event Types

### Anthropic SDK: 16 SDKMessage types

| Type | Subtype | fourmis-agents | Notes |
|------|---------|----------------|-------|
| `assistant` | - | ✅ `assistant` | LLM response with text + tool_use blocks |
| `user` | - | ✅ `user` | User messages |
| `user` (replay) | isReplay | ✅ `user_replay` | Replayed on session resume |
| `result` | success | ✅ `result` | Final result with cost, turns, usage |
| `result` | error_* | ✅ `error` | Budget/turn/execution errors |
| `system` | init | ✅ `init` | Session initialization metadata |
| `stream_event` | - | ✅ `stream` | Partial streaming chunks |
| `system` | compact_boundary | ✅ `compact` | Context compaction boundary |
| `system` | status | ✅ `status` | Status changes (compacting, etc.) |
| `tool_progress` | - | ✅ `tool_progress` | Long-running tool heartbeat |
| `tool_use_summary` | - | ✅ `tool_summary` | Summary after tool use |
| `system` | hook_started | ✅ `hook_started` | Hook execution started |
| `system` | hook_progress | ✅ `hook_progress` | Hook execution progress |
| `system` | hook_response | ✅ `hook_response` | Hook execution result |
| `system` | task_notification | ✅ `task_notification` | Background task status |
| `system` | files_persisted | ✅ `files_persisted` | File persistence events |
| `auth_status` | - | ⏭️ Skip | Provider-specific auth |

---

## 4. Options / Configuration

### Core Options

| Option | Anthropic SDK | fourmis-agents | Notes |
|--------|--------------|----------------|-------|
| `model` | ✅ | ✅ | Model identifier |
| `provider` | N/A (always Claude) | ✅ **NEW** | Provider selection |
| `apiKey` | Env var | ✅ Explicit or env | Per-provider API key |
| `cwd` | ✅ | ✅ | Working directory |
| `systemPrompt` | ✅ string or preset | ✅ | Custom system prompt |
| `tools` | ✅ preset or string[] | ✅ | Tool configuration |
| `allowedTools` | ✅ | ✅ | Auto-allow list |
| `disallowedTools` | ✅ | ✅ | Block list |
| `maxTurns` | ✅ | ✅ | Turn limit |
| `maxBudgetUsd` | ✅ | ✅ | Cost limit |
| `maxThinkingTokens` | ✅ | ✅ | Thinking budget |
| `outputFormat` | ✅ JSON schema | ✅ | Structured output |
| `permissionMode` | ✅ 6 modes | ✅ | Permission handling |
| `canUseTool` | ✅ callback | ✅ | Custom permission logic |
| `env` | ✅ | ✅ | Environment variables |
| `debug` | ✅ | ✅ | Debug logging |

### Session Options

| Option | Anthropic SDK | fourmis-agents | Notes |
|--------|--------------|----------------|-------|
| `sessionId` | ✅ | ✅ | Specific session UUID |
| `continue` | ✅ | ✅ | Continue most recent |
| `resume` | ✅ | ✅ | Resume by session ID |
| `resumeSessionAt` | ✅ | ✅ | Resume to specific message |
| `forkSession` | ✅ | ✅ | Fork resumed session |
| `persistSession` | ✅ | ✅ | Save to disk |
| `enableFileCheckpointing` | ✅ | ✅ | Track file changes |

### Agent/Subagent Options

| Option | Anthropic SDK | fourmis-agents | Notes |
|--------|--------------|----------------|-------|
| `agent` | ✅ | ✅ | Named agent for main thread |
| `agents` | ✅ Record<name, def> | ✅ | Subagent definitions |
| Agent `description` | ✅ | ✅ | When to use this agent |
| Agent `prompt` | ✅ | ✅ | System prompt |
| Agent `tools` | ✅ | ✅ | Tool restrictions |
| Agent `model` | ✅ sonnet/opus/haiku/inherit | ✅ Any model string | Not locked to Claude models |
| Agent `mcpServers` | ✅ | ✅ | Per-agent MCP |
| Agent `maxTurns` | ✅ | ✅ | Per-agent limits |

### MCP Options

| Option | Anthropic SDK | fourmis-agents | Notes |
|--------|--------------|----------------|-------|
| `mcpServers` | ✅ Record<name, config> | ✅ | MCP server configs |
| stdio transport | ✅ | ✅ | `{ command, args, env }` |
| SSE transport | ✅ | ✅ | `{ type: 'sse', url }` |
| HTTP transport | ✅ | ✅ | `{ type: 'http', url }` |
| SDK (in-process) | ✅ | ✅ | `createMcpServer()` |
| `strictMcpConfig` | ✅ | ✅ | Strict validation |

### Hook Options

| Option | Anthropic SDK | fourmis-agents | Notes |
|--------|--------------|----------------|-------|
| `hooks` | ✅ 15 event types | ✅ | Event callbacks |
| PreToolUse | ✅ | ✅ | Before tool execution |
| PostToolUse | ✅ | ✅ | After tool execution |
| PostToolUseFailure | ✅ | ✅ | After failed tool |
| Notification | ✅ | ✅ | System notifications |
| UserPromptSubmit | ✅ | ✅ | User sends prompt |
| SessionStart | ✅ | ✅ | Session begins |
| SessionEnd | ✅ | ✅ | Session ends |
| Stop | ✅ | ✅ | Agent stopping |
| SubagentStart | ✅ | ✅ | Subagent spawned |
| SubagentStop | ✅ | ✅ | Subagent finished |
| PreCompact | ✅ | ✅ | Before compaction |
| PermissionRequest | ✅ | ✅ | Permission requested |
| Setup | ✅ | ✅ | Initial setup |
| TeammateIdle | ✅ | ✅ | Teammate is idle |
| TaskCompleted | ✅ | ✅ | Background task done |

### Sandbox Options

| Option | Anthropic SDK | fourmis-agents | Notes |
|--------|--------------|----------------|-------|
| `sandbox.enabled` | ✅ | ✅ | Enable sandboxing |
| Network allow/deny | ✅ | ✅ | Domain whitelist |
| Unix sockets | ✅ | ✅ | Socket allowlist |
| Excluded commands | ✅ | ✅ | Bypass list |

### Process Options (Anthropic-specific, NOT in fourmis-agents)

| Option | Anthropic SDK | fourmis-agents | Notes |
|--------|--------------|----------------|-------|
| `executable` | ✅ node/bun/deno | ❌ N/A | No subprocess |
| `executableArgs` | ✅ | ❌ N/A | No subprocess |
| `pathToClaudeCodeExecutable` | ✅ | ❌ N/A | No subprocess |
| `spawnClaudeCodeProcess` | ✅ | ❌ N/A | No subprocess |
| `settingSources` | ✅ | ❌ N/A | No .claude settings |
| `plugins` | ✅ | 🔄 Consider later | Plugin system |

---

## 5. Built-in Tools

### Anthropic SDK built-in tools (via Claude Code subprocess)

| Tool | fourmis-agents | Implementation |
|------|----------------|----------------|
| **Bash** | ✅ | `Bun.$` or `Bun.spawn()` |
| **Read** (FileRead) | ✅ | `Bun.file().text()` with line numbers |
| **Write** (FileWrite) | ✅ | `Bun.write()` |
| **Edit** (FileEdit) | ✅ | String replacement with uniqueness check |
| **Glob** | ✅ | `Bun.Glob` or fast-glob |
| **Grep** | ✅ | ripgrep subprocess or JS regex |
| **WebSearch** | ✅ | Provider's web search or Brave/Tavily API |
| **WebFetch** | ✅ | `fetch()` + HTML-to-markdown |
| **TodoWrite** | ✅ | In-memory task list, exposed to LLM |
| **Task** (Agent/subagent) | ✅ | In-process subagent spawn |
| **TaskOutput** | ✅ | Read background task output |
| **TaskStop** | ✅ | Stop background task |
| **NotebookEdit** | 🔄 Phase 2 | Jupyter notebook editing |
| **AskUserQuestion** | ✅ | Multi-choice user interaction |
| **ExitPlanMode** | ✅ | Plan mode management |
| **Config** | ⏭️ Skip | Claude-specific settings |
| **ListMcpResources** | ✅ | MCP resource listing |
| **ReadMcpResource** | ✅ | MCP resource reading |

---

## 6. Deep Agent Features

### Context Compaction

| Feature | Anthropic SDK | fourmis-agents |
|---------|--------------|----------------|
| Auto-trigger at ~95% | ✅ (internal) | ✅ Configurable threshold |
| Offload large tool results to filesystem | ✅ (internal) | ✅ >20k tokens → file |
| Truncate old tool inputs | ✅ (internal) | ✅ At 85% capacity |
| LLM-based summarization fallback | ✅ (internal) | ✅ Structured summary |
| `compact_boundary` event | ✅ | ✅ |
| `PreCompact` hook | ✅ | ✅ |
| Manual compaction trigger | ✅ | ✅ `query.compact()` |

### Session Management

| Feature | Anthropic SDK | fourmis-agents |
|---------|--------------|----------------|
| Session persistence to disk | ✅ ~/.claude/projects/ | ✅ ~/.fourmis-agents/sessions/ |
| Resume by session ID | ✅ | ✅ |
| Continue most recent | ✅ | ✅ |
| Fork session | ✅ | ✅ |
| File checkpointing + rewind | ✅ | ✅ |
| Message replay on resume | ✅ | ✅ |

### Subagent System

| Feature | Anthropic SDK | fourmis-agents |
|---------|--------------|----------------|
| Define agents with description/prompt/tools | ✅ | ✅ |
| Per-agent model selection | ✅ (sonnet/opus/haiku) | ✅ Any model+provider |
| Background tasks | ✅ run_in_background | ✅ |
| Task output polling | ✅ TaskOutput tool | ✅ |
| Context isolation | ✅ Separate subprocess | ✅ Separate conversation |
| Per-agent MCP servers | ✅ | ✅ |
| Per-agent tool restrictions | ✅ | ✅ |

---

## 7. Provider-Specific Considerations

### What each provider brings/lacks

| Capability | Anthropic | OpenAI | Google | Ollama |
|-----------|-----------|--------|--------|--------|
| Tool calling | ✅ Native | ✅ Native | ✅ Native | ✅ Most models |
| Streaming | ✅ SSE | ✅ SSE | ✅ SSE | ✅ Streaming |
| Extended thinking | ✅ | ✅ (reasoning) | ✅ (thinking) | ❌ |
| Structured output | ✅ | ✅ | ✅ | 🔄 Partial |
| Web search | ✅ Built-in | ✅ Built-in | ✅ Grounding | ❌ |
| Cost tracking | ✅ Per-token pricing | ✅ Per-token pricing | ✅ Per-token pricing | ❌ Free/local |
| Max context | 200K (1M beta) | 128K-1M | 1M-2M | Model-dependent |
| Computer use | ✅ | ✅ | ❌ | ❌ |

### Cost Calculation Strategy

Each provider adapter must implement:
```ts
interface ProviderAdapter {
  // ...
  calculateCost(usage: TokenUsage): number;  // USD cost from token counts
  getContextWindow(model: string): number;   // Max tokens for compaction threshold
}
```

Pricing tables maintained per-provider, updated via config or fetched from API.

---

## 8. What fourmis-agents adds BEYOND the Anthropic SDK

| Feature | Notes |
|---------|-------|
| **Multi-provider** | Core differentiator |
| **Provider registry** | Register custom providers |
| **Per-agent provider** | Different agents can use different providers |
| **Cross-provider subagents** | Orchestrator on OpenAI, workers on Anthropic |
| **No subprocess overhead** | <100ms vs ~12s startup |
| **Transparent agent loop** | Customizable execution cycle |
| **Configurable compaction** | Tune thresholds, strategies |
| **Bun-native** | Optimized for Bun runtime |
| **Lightweight** | No 11MB CLI binary bundled |
