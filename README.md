# fourmis-agents

> The open-source, multi-provider equivalent of the Anthropic Agent SDK.

A TypeScript library that gives you deep coding agents on **any LLM provider** — same `query()` API, same streaming events, same tool capabilities — but not locked to Claude.

## Why?

The [Anthropic Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) is excellent but:
- **Claude-only** — spawns a Claude Code subprocess, no other providers
- **Opaque** — the agent loop runs inside the subprocess, you can't customize it
- **~12s startup overhead** per query (subprocess spawn)

`fourmis-agents` provides the same capabilities with:
- **Any provider** — OpenAI, Anthropic (direct API), Google, Ollama, local models
- **Transparent agent loop** — you control the execution cycle
- **No subprocess overhead** — direct API calls
- **Deep agent features** — planning, context compression, subagents (not just a simple tool loop)

## Quick Start

```ts
import { query } from "fourmis-agents";

const conversation = query({
  prompt: "Fix the failing tests in src/auth/",
  options: {
    provider: "openai",
    model: "gpt-5.2",
    cwd: "./my-project",
    tools: "coding",  // preset: Bash, Read, Write, Edit, Glob, Grep
    maxTurns: 20,
  },
});

for await (const msg of conversation) {
  if (msg.type === "text") console.log(msg.text);
  if (msg.type === "tool_use") console.log(`Using ${msg.name}...`);
  if (msg.type === "result") console.log(`Done! Cost: $${msg.costUsd}`);
}
```

## Comparison

| Feature | Anthropic Agent SDK | fourmis-agents |
|---------|-------------------|----------------|
| Providers | Claude only | Any (OpenAI, Anthropic, Google, Ollama...) |
| Architecture | Subprocess (Claude Code CLI) | Direct API + in-process tool loop |
| Built-in tools | Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch | Same set, implemented natively |
| Subagents | Via Task tool (subprocess) | Via Task tool (in-process, lighter) |
| Context compaction | Automatic (~95% capacity) | Automatic (offload → truncate → summarize) |
| Planning | TodoWrite tool | TodoWrite tool |
| MCP support | stdio, SSE, HTTP, SDK (in-process) | Same 4 transports |
| Sessions | Persist/resume/fork | Persist/resume/fork |
| Hooks | 15 event types | Same hook system |
| Permissions | 6 modes + canUseTool callback | Same |
| Streaming | AsyncGenerator<SDKMessage> | AsyncGenerator<AgentMessage> |
| Startup overhead | ~12s (subprocess spawn) | <100ms (direct API) |
| Structured output | JSON schema | JSON schema |
| Cost tracking | total_cost_usd in result | Per-provider cost calculation |
| Runtime | Node.js | Bun-first, Node.js compatible |

## Status

🚧 **Planning phase** — See [ARCHITECTURE.md](./ARCHITECTURE.md) and [CAPABILITIES.md](./CAPABILITIES.md) for the design.
