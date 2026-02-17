# Architecture: fourmis-agents-sdk

## Overview

`fourmis-agents-sdk` is organized in layered components from provider SDKs up to the public `query()` API.

```
┌──────────────────────────────────────────────────────────┐
│ Layer 5: Public API                                      │
│ query(), Query controls, provider/tool/MCP exports       │
├──────────────────────────────────────────────────────────┤
│ Layer 4: Agent Loop                                      │
│ prompt -> provider -> tool calls -> execution -> repeat  │
│ hooks, permissions, subagents, memory, budgets           │
├──────────────────────────────────────────────────────────┤
│ Layer 3: Tool and Runtime Integration                    │
│ built-in tools, MCP tools/resources, Task tools          │
├──────────────────────────────────────────────────────────┤
│ Layer 2: Provider Adapters                               │
│ Anthropic/OpenAI/Gemini normalization                    │
├──────────────────────────────────────────────────────────┤
│ Layer 1: Provider SDKs / HTTP APIs                       │
│ @anthropic-ai/sdk, openai, @google/genai, OAuth endpoints│
└──────────────────────────────────────────────────────────┘
```

## Layer 1: Provider SDKs / APIs

- Anthropic: `@anthropic-ai/sdk`
- OpenAI: `openai`
- Gemini: `@google/genai` plus OAuth HTTP mode

Fourmis executes these directly (no mandatory subprocess model for host query execution).

## Layer 2: Provider Adapters

Adapters implement a common interface (`ProviderAdapter`) to normalize:

- message exchange
- tool-call shape
- streaming chunks
- usage/cost accounting
- feature capability checks

Key files:
- `src/providers/types.ts`
- `src/providers/anthropic.ts`
- `src/providers/openai.ts`
- `src/providers/gemini.ts`
- `src/providers/registry.ts`

Provider registry is lazy and extensible via `registerProvider()`.

## Layer 3: Tool and Runtime Integration

### Tool Registry

`ToolRegistry` provides registration, definition export, and execution dispatch.

Key file:
- `src/tools/registry.ts`

### Built-in Tools

Current built-ins:

- `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`
- `NotebookEdit`, `WebFetch`, `WebSearch`
- `TodoWrite`, `Config`, `AskUserQuestion`, `ExitPlanMode`

Preset resolution defaults to `claude_code` and can also accept explicit arrays.

Key files:
- `src/tools/index.ts`
- `src/tools/presets.ts`
- `src/tools/*.ts`

### MCP Integration

`McpClientManager` connects configured servers and projects tools as namespaced tool IDs (`mcp__<server>__<tool>`), plus resource tools:

- `mcp__list_resources`
- `mcp__read_resource`

Key files:
- `src/mcp/client.ts`
- `src/mcp/server.ts`
- `src/mcp/types.ts`
- `src/tools/mcp-resources.ts`

### Subagents

Subagent definitions are injected into runtime and surfaced through `Task`, `TaskOutput`, `TaskStop` tools.

Key files:
- `src/agents/types.ts`
- `src/agents/task-manager.ts`
- `src/agents/tools.ts`

## Layer 4: Agent Loop

`agent-loop.ts` is the core execution engine and emits Claude-compatible envelopes.

Main flow:

1. Initialize session/system state.
2. Send conversation to selected provider adapter.
3. Collect `assistant` text/tool-use blocks.
4. Apply hooks (`PreToolUse` etc.) and permission decisions.
5. Execute tool calls through registry.
6. Append tool results as `user` content.
7. Repeat until completion or a terminal condition.
8. Emit terminal `result` (`success` or error subtype).

Terminal controls/limits:

- `maxTurns`
- `maxBudgetUsd`
- abort signal
- structured output retry bounds

Related files:
- `src/agent-loop.ts`
- `src/permissions.ts`
- `src/hooks.ts`
- `src/settings.ts`
- `src/utils/session-store.ts`
- `src/memory/*`
- `src/skills/*`

## Layer 5: Public API

### `query()`

`query()` builds runtime state and returns a `Query` (async iterable + controls).

Controls include:

- `interrupt()`, `close()`
- `setPermissionMode()`, `setModel()`, `setMaxThinkingTokens()`
- `supportedModels()`, `supportedCommands()`, `initializationResult()`
- MCP runtime controls (`mcpServerStatus`, `toggleMcpServer`, `setMcpServers`, ...)

Key files:
- `src/api.ts`
- `src/query.ts`
- `src/index.ts`

## Message Contract

Fourmis emits Claude-style `SDKMessage` unions (`AgentMessage`) with core envelopes:

- `system` (`init`, `status`, hook/task metadata)
- `assistant` (text/tool_use blocks)
- `user` (tool_result blocks)
- `stream_event`
- `tool_progress`, `tool_use_summary`
- `result` (`success` or error subtype)

Key file:
- `src/types.ts`

## Compatibility Harness Architecture

`tests/compat` provides strict side-by-side regression checks against `@anthropic-ai/claude-agent-sdk`.

Components:

- scenario definitions: `tests/compat/scenarios.ts`
- pair runner + trace normalization: `tests/compat/harness.ts`
- assertion engine (sdk + parity): `tests/compat/assertions.ts`
- report/artifact writer: `tests/compat/report.ts`
- orchestrator entrypoint: `tests/compat/run-compat.ts`

Artifacts:

- per-run `summary.json`
- human-readable `report.md`
- per-scenario normalized traces for both SDKs

## Updated Repository Map

```
fourmis-agent-sdk/
├── src/
│   ├── api.ts
│   ├── agent-loop.ts
│   ├── hooks.ts
│   ├── index.ts
│   ├── permissions.ts
│   ├── query.ts
│   ├── settings.ts
│   ├── types.ts
│   ├── agents/
│   ├── auth/
│   ├── mcp/
│   ├── memory/
│   ├── providers/
│   ├── skills/
│   ├── tools/
│   └── utils/
├── tests/
│   ├── agents/
│   ├── auth/
│   ├── compat/
│   ├── mcp/
│   ├── providers/
│   ├── tools/
│   ├── agent-loop.test.ts
│   ├── hooks.test.ts
│   └── integration.test.ts
├── README.md
└── ARCHITECTURE.md
```
