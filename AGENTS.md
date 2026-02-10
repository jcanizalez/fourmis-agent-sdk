# Agents & Subagents: fourmis-agents

How the agent/subagent system works — matching the Anthropic Agent SDK's patterns but with cross-provider support.

---

## Agent Definitions

Define named agents with their own system prompts, tools, models, and even providers:

```ts
query({
  prompt: "Refactor the auth module and review the changes",
  options: {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",

    // Main agent uses all defined agents as subagent pool
    agents: {
      "code-reviewer": {
        description: "Reviews code for best practices, security issues, and style",
        prompt: "You are a senior code reviewer. Focus on...",
        tools: ["Read", "Glob", "Grep"],       // Read-only tools
        model: "gpt-5.2-mini",                  // Cheaper model for review
        provider: "openai",                      // Different provider!
        maxTurns: 10,
      },
      "test-writer": {
        description: "Writes unit and integration tests for code changes",
        prompt: "You are a test engineer. Write thorough tests...",
        tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
        model: "claude-sonnet-4-5-20250929",     // Same as parent
        // provider omitted → inherits from parent
        maxTurns: 15,
      },
      "researcher": {
        description: "Researches APIs, documentation, and best practices",
        prompt: "You are a research assistant...",
        tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
        model: "gemini-2.5-flash",
        provider: "google",                      // Yet another provider
        maxTurns: 8,
      },
    },
  },
});
```

### AgentDefinition Type

```ts
type AgentDefinition = {
  description: string;           // When to use this agent (shown to parent LLM)
  prompt: string;                // System prompt for the agent
  tools?: string[];              // Allowed tools (inherits from parent if omitted)
  disallowedTools?: string[];    // Tools to block
  model?: string;                // Model override (inherits if omitted)
  provider?: string;             // Provider override (inherits if omitted)
  mcpServers?: McpServerSpec[];  // Agent-specific MCP servers
  maxTurns?: number;             // Turn limit for this agent
};
```

---

## How Subagents Are Invoked

The parent LLM calls the **Task** tool to spawn subagents:

```json
{
  "name": "Task",
  "input": {
    "description": "Review auth module changes",
    "prompt": "Review all files in src/auth/ for security issues...",
    "subagent_type": "code-reviewer",
    "run_in_background": false,
    "max_turns": 10
  }
}
```

### Task Tool Input

```ts
type TaskInput = {
  description: string;           // Short summary (3-5 words)
  prompt: string;                // Detailed instructions for the subagent
  subagent_type: string;         // Agent name from agents config
  model?: string;                // Override agent's default model
  run_in_background?: boolean;   // Run async (default: false)
  max_turns?: number;            // Override agent's default turn limit
};
```

---

## Execution Model

### Foreground Subagents

```
Parent Agent
  │
  ├── [tool_use] Task: "Review auth code"
  │     │
  │     ├── Create isolated conversation
  │     ├── Resolve provider adapter (may differ from parent)
  │     ├── Run agent loop with subagent's config
  │     ├── Return result text to parent
  │     │
  │     └── [tool_result] "Found 3 security issues: 1) SQL injection in..."
  │
  ├── [text] "Based on the review, I'll fix these issues..."
  └── ...continues
```

- Blocks the parent until complete
- Result text is returned as tool output
- Subagent has its own context window (no context pollution)

### Background Subagents

```
Parent Agent
  │
  ├── [tool_use] Task: { ..., run_in_background: true }
  │     └── [tool_result] "Task task_abc123 started in background"
  │
  ├── [text] "I've started the review in the background. Meanwhile..."
  ├── ...continues working on other things...
  │
  ├── [tool_use] TaskOutput: { task_id: "task_abc123", block: true }
  │     └── [tool_result] "Review complete. Found 3 issues..."
  │
  └── [text] "The background review found..."
```

- Returns immediately with a task ID
- Runs in parallel (separate async context)
- Parent can poll with `TaskOutput` or stop with `TaskStop`
- `task_notification` event emitted when background task completes

---

## Cross-Provider Subagents

The killer feature: orchestrate across providers within a single session.

```
┌─────────────────────────────────────────────┐
│  Parent: claude-sonnet-4 (Anthropic)        │
│                                             │
│  "Refactor auth, write tests, research API" │
│                                             │
│  ├── Task → "code-reviewer"                 │
│  │   └── gpt-5.2-mini (OpenAI)             │
│  │       Read-only tools, cheap review       │
│  │                                           │
│  ├── Task → "test-writer"                    │
│  │   └── claude-sonnet-4 (Anthropic)        │
│  │       Full tools, writes test files       │
│  │                                           │
│  └── Task → "researcher" (background)        │
│      └── gemini-2.5-flash (Google)           │
│          Web search, read docs, fast          │
└─────────────────────────────────────────────┘
```

Each subagent:
- Gets its own provider adapter instance
- Has its own context window
- Can use its own MCP servers
- Runs its own agent loop independently
- Returns results as plain text to the parent

---

## Context Isolation

Each subagent gets a **completely isolated** conversation:

```ts
async function executeSubagent(
  agentDef: AgentDefinition,
  input: TaskInput,
  parentContext: ToolContext,
): Promise<ToolResult> {
  // 1. Resolve provider (may differ from parent)
  const provider = agentDef.provider ?? parentContext.provider;
  const adapter = getProviderAdapter(provider);

  // 2. Build isolated message history
  const messages = [
    { role: "user", content: input.prompt },
  ];

  // 3. Build tool set for subagent
  const tools = buildToolRegistry(agentDef.tools ?? parentContext.tools);

  // 4. Run isolated agent loop
  const result = await runAgentLoop({
    adapter,
    model: agentDef.model ?? input.model ?? parentContext.model,
    messages,
    tools,
    systemPrompt: agentDef.prompt,
    maxTurns: input.max_turns ?? agentDef.maxTurns ?? 10,
    cwd: parentContext.cwd,
    sessionId: `${parentContext.sessionId}_sub_${randomUUID()}`,
  });

  // 5. Return result text as tool output
  return {
    content: result.text ?? "Subagent completed without output",
    metadata: {
      turns: result.turns,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
    },
  };
}
```

---

## Main Agent Override

You can also use `agent` to apply an agent definition to the **main** conversation:

```ts
query({
  prompt: "Review this PR",
  options: {
    agent: "code-reviewer",        // Use this agent's config for the main thread
    agents: {
      "code-reviewer": {
        description: "...",
        prompt: "You are a senior code reviewer...",
        tools: ["Read", "Glob", "Grep"],
        model: "claude-sonnet-4-5-20250929",
      },
    },
  },
});
```

This applies the agent's `prompt`, `tools`, `model`, and `provider` to the top-level query.

---

## Agent Events

The host application receives events about subagent lifecycle:

```ts
// Subagent started
{ type: "init", model: "gpt-5.2-mini", provider: "openai", ... }

// Hook events
{ type: "hook", event: "SubagentStart", agentId: "...", agentType: "code-reviewer" }
{ type: "hook", event: "SubagentStop", agentId: "...", agentType: "code-reviewer" }

// Background task notifications
{ type: "task_notification", taskId: "task_abc123", status: "completed", summary: "..." }
```

---

## Comparison with Anthropic Agent SDK

| Feature | Anthropic SDK | fourmis-agents |
|---------|--------------|----------------|
| Agent definitions | ✅ | ✅ |
| Subagent spawning (Task tool) | ✅ subprocess | ✅ in-process |
| Background tasks | ✅ | ✅ |
| Per-agent model | ✅ (sonnet/opus/haiku) | ✅ Any model string |
| Per-agent provider | ❌ Always Claude | ✅ Any provider |
| Context isolation | ✅ Separate subprocess | ✅ Separate conversation |
| Per-agent MCP servers | ✅ | ✅ |
| Per-agent tools | ✅ | ✅ |
| Per-agent turn limits | ✅ | ✅ |
| Cross-provider agents | ❌ | ✅ Unique feature |
| Startup overhead | ~12s per subagent | <100ms |
