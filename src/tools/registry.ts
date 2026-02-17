/**
 * Tool registry — registration, discovery, and execution.
 */

import type { ToolDefinition } from "../providers/types.ts";

// ─── Tool Types ─────────────────────────────────────────────────────────────

export type ToolResult = {
  content: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
};

export type ToolContext = {
  cwd: string;
  signal: AbortSignal;
  sessionId: string;
  env?: Record<string, string>;
};

export type ToolImplementation = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>;
};

// ─── Tool Registry ──────────────────────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, ToolImplementation>();

  register(tool: ToolImplementation): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  clearByPrefix(prefix: string): void {
    for (const name of this.tools.keys()) {
      if (name.startsWith(prefix)) {
        this.tools.delete(name);
      }
    }
  }

  get(name: string): ToolImplementation | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async execute(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }

    try {
      return await tool.execute(input, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Tool error: ${message}`, isError: true };
    }
  }

  list(): string[] {
    return [...this.tools.keys()];
  }
}
