/**
 * Subagent types.
 */

export type AgentDefinition = {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, import("../mcp/types.ts").McpServerConfig>;
  criticalSystemReminder_EXPERIMENTAL?: string;
  skills?: string[];
  model?: string;
  /** fourmis-exclusive: use a different provider per agent */
  provider?: string;
  maxTurns?: number;
};

export type BackgroundTask = {
  id: string;
  agentType: string;
  status: "running" | "completed" | "failed" | "stopped";
  result?: string;
  error?: string;
  abortController: AbortController;
  promise: Promise<void>;
};
