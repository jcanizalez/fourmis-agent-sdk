# Roadmap: fourmis-agents

## Phase 1: Foundation (MVP)

**Goal:** A working `query()` that can run a coding agent on OpenAI or Anthropic (direct API).

### 1.1 Core Types & Public API
- [ ] Define all public types (`AgentMessage`, `QueryOptions`, `Query`, etc.)
- [ ] Implement `query()` entry point
- [ ] Implement `Query` class (AsyncGenerator + control methods)

### 1.2 Provider Adapters (2 providers)
- [ ] `ProviderAdapter` interface
- [ ] Provider registry
- [ ] **Anthropic adapter** (direct API via `@anthropic-ai/sdk`)
- [ ] **OpenAI adapter** (via `openai` package)
- [ ] Message format normalization (Anthropic ↔ OpenAI)
- [ ] Tool calling format normalization
- [ ] Streaming normalization
- [ ] Token usage + cost tracking

### 1.3 Basic Agent Loop
- [ ] Prompt → LLM → tool calls → execute → repeat cycle
- [ ] Turn counting and budget limits
- [ ] Stop conditions (no tool calls, max turns, max budget)
- [ ] Error handling and recovery

### 1.4 Core Tools (6 tools)
- [ ] **Bash** — shell execution with timeout, output capture
- [ ] **Read** — file reading with line numbers, offset/limit
- [ ] **Write** — file writing with safety checks
- [ ] **Edit** — string replacement with uniqueness validation
- [ ] **Glob** — file pattern matching
- [ ] **Grep** — regex search with context lines

### 1.5 Permission System
- [ ] `canUseTool` callback support
- [ ] Permission modes: `default`, `acceptEdits`, `bypassPermissions`
- [ ] Tool allow/disallow lists

### 1.6 Tests
- [ ] Agent loop unit tests (mock provider)
- [ ] Tool unit tests (each tool)
- [ ] Integration test: run a simple coding task on OpenAI
- [ ] Integration test: run a simple coding task on Anthropic

**Deliverable:** `bun add fourmis-agents` works, `query()` can fix a bug using OpenAI or Anthropic.

---

## Phase 2: Deep Agent Features

**Goal:** Match Claude Code's context management and subagent capabilities.

### 2.1 Context Compaction
- [ ] Token estimation (tiktoken or fast approximation)
- [ ] Phase 1: Offload large tool results to filesystem (>20k tokens)
- [ ] Phase 2: Truncate old tool inputs at 85% capacity
- [ ] Phase 3: LLM-based summarization fallback
- [ ] `compact_boundary` event emission
- [ ] `PreCompact` hook
- [ ] Configurable thresholds
- [ ] Manual compaction via `query.compact()`

### 2.2 Session Management
- [ ] Session persistence to disk (JSON)
- [ ] Resume by session ID
- [ ] Continue most recent session
- [ ] Fork session
- [ ] File checkpointing (track file changes per message)
- [ ] `rewindFiles()` support
- [ ] Message replay on resume

### 2.3 Subagent System
- [ ] `Task` tool implementation
- [ ] `TaskOutput` tool
- [ ] `TaskStop` tool
- [ ] Background task execution (async)
- [ ] Per-agent model and provider selection
- [ ] Context isolation between agents
- [ ] `SubagentStart` / `SubagentStop` hooks

### 2.4 Planning Tools
- [ ] `TodoWrite` tool
- [ ] `AskUserQuestion` tool
- [ ] `ExitPlanMode` tool

### 2.5 Additional Tools
- [ ] **WebSearch** — Brave/Tavily API or provider built-in
- [ ] **WebFetch** — URL fetch + HTML→markdown
- [ ] **NotebookEdit** — Jupyter notebook cell editing

**Deliverable:** fourmis-agents handles long, complex tasks with compaction. Subagents work across providers.

---

## Phase 3: Ecosystem

**Goal:** Full feature parity with Anthropic Agent SDK + multi-provider advantages.

### 3.1 More Providers
- [ ] **Google Gemini adapter** (via `@google/genai`)
- [ ] **Ollama adapter** (local models)
- [ ] **Custom provider API** (user-defined adapters)

### 3.2 MCP Support
- [ ] MCP client (connect to external MCP servers)
- [ ] Stdio transport
- [ ] SSE transport
- [ ] HTTP transport
- [ ] In-process MCP server (`createMcpServer()`)
- [ ] `tool()` helper for defining MCP tools
- [ ] Dynamic MCP management (add/remove/reconnect at runtime)
- [ ] MCP resource listing and reading

### 3.3 Hook System
- [ ] Hook registry with matchers and timeouts
- [ ] All 15 hook events from Anthropic SDK
- [ ] Async hooks with timeout
- [ ] Hook-based permission decisions

### 3.4 Sandbox
- [ ] Command sandboxing for Bash tool
- [ ] Network domain allowlist
- [ ] Excluded commands list

### 3.5 System Prompt
- [ ] Default coding agent system prompt (detailed, with examples)
- [ ] Preset system prompts (`coding`, `readonly`, `planner`)
- [ ] System prompt append mode

### 3.6 Structured Output
- [ ] JSON schema output format
- [ ] Retry on schema validation failure
- [ ] `error_max_structured_output_retries` result

**Deliverable:** Full feature parity. Production-ready library.

---

## Phase 4: Beyond

- [ ] **Provider middleware** — intercept/transform LLM calls (logging, caching, rate limiting)
- [ ] **Cost dashboard** — track spending across providers
- [ ] **Model router** — automatically pick best model per task (cheap for simple, expensive for complex)
- [ ] **Parallel tool execution** — run independent tool calls concurrently
- [ ] **Tool result caching** — cache idempotent tool results (Glob, Grep, Read)
- [ ] **A2A protocol** — agent-to-agent communication across processes
- [ ] **Browser tool** — Playwright-based browser automation
- [ ] **Image tool** — screenshot analysis, image generation

---

## Integration Milestones

| Milestone | fourmis-agents | fourmis integration |
|-----------|---------------|---------------------|
| Phase 1 done | MVP works standalone | Add as `genericProvider` in fourmis |
| Phase 2 done | Deep agent capabilities | Replace Claude subprocess for non-Claude agents |
| Phase 3 done | Full ecosystem | fourmis uses fourmis-agents for all non-Claude agents |
| Phase 4 done | Beyond Anthropic SDK | Optional: use fourmis-agents even for Anthropic (direct API vs subprocess) |
