# Built-in Tools: fourmis-agents

Every tool that the Anthropic Agent SDK provides via Claude Code subprocess, reimplemented natively for multi-provider use.

---

## Tool Definition Format

Each tool is defined with a JSON Schema input and an execute function:

```ts
interface ToolImplementation {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;         // Doesn't modify anything
    destructiveHint?: boolean;       // Can delete/overwrite data
    idempotentHint?: boolean;        // Same input → same result
    openWorldHint?: boolean;         // Interacts with external systems
  };
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}

interface ToolContext {
  cwd: string;                      // Working directory
  signal: AbortSignal;              // Cancellation
  sessionId: string;
  permissions: PermissionManager;
  onProgress?: (elapsed: number) => void;  // Heartbeat for long ops
  env?: Record<string, string>;
}

type ToolResult = {
  content: string;                  // Text result (shown to LLM)
  isError?: boolean;
  metadata?: Record<string, unknown>;
};
```

---

## Tool Presets

```ts
const PRESETS = {
  // Full coding agent (equivalent to claude_code preset)
  coding: [
    "Bash", "Read", "Write", "Edit", "Glob", "Grep",
    "WebSearch", "WebFetch", "TodoWrite",
    "Task", "TaskOutput", "TaskStop",
    "AskUserQuestion", "ExitPlanMode",
  ],

  // Read-only agent (safe, no modifications)
  readonly: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],

  // Minimal editing (no shell, no web)
  minimal: ["Read", "Write", "Edit", "Glob", "Grep"],

  // Research agent (web + files, no editing)
  research: ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"],
};
```

---

## Core Tools

### 1. Bash

Execute shell commands with timeout and output capture.

```ts
// Input schema (matches Anthropic SDK's BashInput)
{
  command: string;              // Required: command to execute
  description?: string;         // What this command does
  timeout?: number;             // Timeout in ms (default: 120000, max: 600000)
  run_in_background?: boolean;  // Run async, return task ID
}
```

**Implementation notes:**
- Uses `Bun.spawn()` for subprocess execution
- Captures stdout + stderr (combined, up to 30000 chars)
- Supports background execution via async task system
- Respects sandbox settings (domain allowlist, command blocklist)
- Working directory set to `ctx.cwd`
- Emits `tool_progress` heartbeats every 5s for long-running commands

### 2. Read

Read file contents with line numbers.

```ts
{
  file_path: string;           // Absolute path (required)
  offset?: number;             // Start line (1-indexed)
  limit?: number;              // Max lines to read (default: 2000)
  pages?: string;              // PDF page range: "1-5", "3", "10-20"
}
```

**Implementation notes:**
- Uses `Bun.file().text()` for reading
- Adds line numbers in `cat -n` format: `     1\tcontent`
- Truncates lines longer than 2000 chars
- Supports PDF via pdf-parse (lazy loaded)
- Supports images (returns base64 for multimodal models)
- Supports `.ipynb` notebooks (renders cells with outputs)

### 3. Write

Write content to a file.

```ts
{
  file_path: string;           // Absolute path (required)
  content: string;             // File content (required)
}
```

**Implementation notes:**
- Uses `Bun.write()`
- Creates parent directories if needed (`mkdir -p`)
- Permission check: requires "allow" for new files, "acceptEdits" mode auto-allows
- Tracks file state for checkpointing (if enabled)

### 4. Edit

Replace text in a file with uniqueness validation.

```ts
{
  file_path: string;           // Absolute path (required)
  old_string: string;          // Text to find (must be unique in file)
  new_string: string;          // Replacement text (must differ from old_string)
  replace_all?: boolean;       // Replace all occurrences (default: false)
}
```

**Implementation notes:**
- Reads file, validates `old_string` exists and is unique (unless `replace_all`)
- Fails with descriptive error if not unique (suggests adding context)
- Preserves file permissions and encoding
- Tracks file state for checkpointing

### 5. Glob

Find files matching a pattern.

```ts
{
  pattern: string;             // Glob pattern: "**/*.ts", "src/**/*.{js,jsx}"
  path?: string;               // Base directory (default: cwd)
}
```

**Implementation notes:**
- Uses `Bun.Glob` or `fast-glob`
- Returns paths sorted by modification time (most recent first)
- Respects `.gitignore` patterns
- Read-only, no permission check needed

### 6. Grep

Search file contents with regex.

```ts
{
  pattern: string;             // Regex pattern (required)
  path?: string;               // File or directory to search (default: cwd)
  glob?: string;               // Filter files: "*.ts", "*.{js,jsx}"
  type?: string;               // File type shortcut: "js", "py", "rust"
  output_mode?: "content" | "files_with_matches" | "count";
  context?: number;            // Lines before and after (-C)
  "-B"?: number;               // Lines before
  "-A"?: number;               // Lines after
  "-n"?: boolean;              // Show line numbers (default: true)
  "-i"?: boolean;              // Case insensitive
  head_limit?: number;         // Max results
  offset?: number;             // Skip first N results
  multiline?: boolean;         // Allow patterns to span lines
}
```

**Implementation notes:**
- Uses bundled ripgrep binary (preferred) or JS regex fallback
- Default output_mode: `files_with_matches`
- Respects `.gitignore`
- Read-only, no permission check needed

---

## Web Tools

### 7. WebSearch

Search the web.

```ts
{
  query: string;               // Search query (required)
  allowed_domains?: string[];  // Only include results from these domains
  blocked_domains?: string[];  // Exclude results from these domains
}
```

**Implementation notes:**
- Provider hierarchy: (1) model's built-in web search, (2) Brave Search API, (3) Tavily API
- Returns search results with titles, URLs, and snippets
- Configurable via `BRAVE_SEARCH_API_KEY` or `TAVILY_API_KEY`

### 8. WebFetch

Fetch and process web content.

```ts
{
  url: string;                 // URL to fetch (required)
  prompt: string;              // What to extract from the page (required)
}
```

**Implementation notes:**
- Fetches URL content via `fetch()`
- Converts HTML to markdown (using `@mozilla/readability` + `turndown`)
- Processes content with a small/fast model to answer the prompt
- 15-minute cache for repeated URLs
- Follows redirects (reports redirect to user)

---

## Planning Tools

### 9. TodoWrite

Manage a task list for tracking multi-step work.

```ts
{
  todos: Array<{
    content: string;           // Task description (imperative: "Fix the bug")
    status: "pending" | "in_progress" | "completed";
    activeForm: string;        // Present continuous: "Fixing the bug"
  }>;
}
```

**Implementation notes:**
- In-memory task list, exposed to LLM via system prompt injection
- Only one task should be `in_progress` at a time
- Emitted as a structured event for UI rendering

### 10. AskUserQuestion

Ask the user multi-choice questions.

```ts
{
  questions: Array<{
    question: string;
    header: string;            // Short label (max 12 chars)
    options: Array<{ label: string; description: string }>;  // 2-4 options
    multiSelect: boolean;
  }>;  // 1-4 questions
}
```

**Implementation notes:**
- Emits an event that the host application handles
- Blocks until user responds (via callback or streamInput)
- "Other" option always available for free-text input

### 11. ExitPlanMode

Signal that planning is complete and ready for execution.

```ts
{
  allowedPrompts?: Array<{ tool: "Bash"; prompt: string }>;
}
```

---

## Agent Tools

### 12. Task (Subagent)

Spawn a subagent for complex subtasks.

```ts
{
  description: string;        // Short summary (3-5 words)
  prompt: string;             // Detailed task for the subagent
  subagent_type: string;      // Agent name (from agents config)
  model?: string;             // Override model
  run_in_background?: boolean;
  max_turns?: number;
}
```

**Implementation notes:**
- Creates isolated conversation (separate message history)
- Can use different model and even different provider than parent
- Background mode: returns task_id, runs in parallel
- Foreground mode: blocks until subagent completes
- Parent receives summary of subagent's work

### 13. TaskOutput

Read output from a background task.

```ts
{
  task_id: string;             // Task ID from Task tool
  block: boolean;              // Wait for completion (default: true)
  timeout: number;             // Max wait in ms (default: 30000)
}
```

### 14. TaskStop

Stop a running background task.

```ts
{
  task_id: string;             // Task ID to stop
}
```

---

## MCP Tools

### 15. MCP Tool Proxy

When MCP servers are configured, their tools become available to the agent. Each MCP tool is proxied:

```ts
// MCP tool "peekaboo__see" from server "javiers-mac-mini" becomes:
{
  name: "mcp__javiers-mac-mini__peekaboo__see",
  description: "[peekaboo] Captures macOS screen...",  // From MCP server
  inputSchema: { /* from MCP server */ },
  execute: async (input) => {
    return await mcpClient.callTool("javiers-mac-mini", "peekaboo__see", input);
  },
}
```

### 16. ListMcpResources

List available MCP resources.

```ts
{
  server?: string;             // Filter by server name
}
```

### 17. ReadMcpResource

Read an MCP resource by URI.

```ts
{
  server: string;
  uri: string;
}
```

---

## Phase 2 Tools

### 18. NotebookEdit

Edit Jupyter notebook cells.

```ts
{
  notebook_path: string;
  new_source: string;
  cell_type?: "code" | "markdown";
  edit_mode?: "replace" | "insert" | "delete";
  cell_id?: string;
}
```

---

## Tool-to-Provider Mapping

Some tools need provider-specific handling:

| Tool | Provider interaction |
|------|---------------------|
| WebSearch | Can use model's built-in search if available |
| WebFetch | Uses a small model for content processing |
| Task | May call a different provider's API for the subagent |
| TodoWrite | Purely local, no provider interaction |
| Bash | Purely local |
| Read/Write/Edit | Purely local |
| Glob/Grep | Purely local |

---

## System Prompt for Tools

The agent needs a detailed system prompt explaining each tool. This is the equivalent of Claude Code's massive built-in system prompt:

```ts
function buildToolSystemPrompt(tools: string[], context: SystemPromptContext): string {
  const sections: string[] = [];

  sections.push(CORE_IDENTITY);  // "You are an AI coding agent..."
  sections.push(buildToolDescriptions(tools));  // Per-tool usage instructions
  sections.push(CODING_GUIDELINES);  // "Read before writing, minimal changes..."
  sections.push(buildPermissionGuidelines(context.permissionMode));

  if (tools.includes("Bash")) sections.push(BASH_GUIDELINES);
  if (tools.includes("Edit")) sections.push(EDIT_GUIDELINES);
  if (tools.includes("TodoWrite")) sections.push(TODO_GUIDELINES);
  if (tools.includes("Task")) sections.push(SUBAGENT_GUIDELINES);

  return sections.join("\n\n");
}
```

The quality of this system prompt is **critical** — it's what makes the difference between a tool-calling chatbot and a capable coding agent. We should invest heavily here, potentially using Claude Code's prompt structure as inspiration.
