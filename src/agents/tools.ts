/**
 * Subagent tools — Task, TaskOutput, TaskStop.
 */

import type { ToolImplementation } from "../tools/registry.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { resolveToolNames, buildToolRegistry } from "../tools/index.ts";
import type { ProviderAdapter } from "../providers/types.ts";
import type { PermissionManager } from "../permissions.ts";
import type { HookManager } from "../hooks.ts";
import type { AgentDefinition } from "./types.ts";
import type { TaskManager } from "./task-manager.ts";
import { agentLoop } from "../agent-loop.ts";
import type { AgentMessage } from "../types.ts";
import { uuid } from "../types.ts";
import { getProvider } from "../providers/registry.ts";

export type AgentContext = {
  agents: Record<string, AgentDefinition>;
  parentProvider: ProviderAdapter;
  parentModel: string;
  parentPermissions: PermissionManager;
  parentHooks?: HookManager;
  parentCwd: string;
  parentEnv?: Record<string, string>;
  parentDebug?: boolean;
  taskManager: TaskManager;
};

export function createTaskTool(ctx: AgentContext): ToolImplementation {
  return {
    name: "Task",
    description: "Launch a subagent to handle a task. Specify the agent type and a prompt describing what to do.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "A short description of the task (3-5 words).",
        },
        prompt: {
          type: "string",
          description: "The detailed task prompt for the subagent.",
        },
        subagent_type: {
          type: "string",
          description: "The type of agent to use. Must match a registered agent definition.",
        },
        run_in_background: {
          type: "boolean",
          description: "If true, run the task in the background and return a task ID.",
        },
        max_turns: {
          type: "number",
          description: "Maximum number of turns for the subagent.",
        },
      },
      required: ["prompt", "subagent_type"],
    },
    async execute(input: unknown, toolCtx) {
      const {
        prompt,
        subagent_type,
        run_in_background,
        max_turns,
      } = input as {
        description?: string;
        prompt: string;
        subagent_type: string;
        run_in_background?: boolean;
        max_turns?: number;
      };

      const agentDef = ctx.agents[subagent_type];
      if (!agentDef) {
        const available = Object.keys(ctx.agents).join(", ");
        return {
          content: `Unknown agent type "${subagent_type}". Available: ${available || "none"}`,
          isError: true,
        };
      }

      // Fire SubagentStart hook
      if (ctx.parentHooks) {
        await ctx.parentHooks.fire(
          "SubagentStart",
          { event: "SubagentStart", agent_type: subagent_type, session_id: toolCtx.sessionId },
          undefined,
          { signal: toolCtx.signal },
        );
      }

      // Resolve provider (agent can override)
      const provider = agentDef.provider
        ? getProvider(agentDef.provider)
        : ctx.parentProvider;

      // Resolve model (agent can override)
      const model = agentDef.model ?? ctx.parentModel;

      // Build subagent's tool registry
      let subTools: ToolRegistry;
      if (agentDef.tools) {
        subTools = buildToolRegistry(agentDef.tools);
      } else {
        subTools = buildToolRegistry(resolveToolNames("coding"));
      }

      const maxTurns = max_turns ?? agentDef.maxTurns ?? 10;
      const sessionId = uuid();
      const abortController = new AbortController();

      // Link parent signal
      if (toolCtx.signal) {
        toolCtx.signal.addEventListener("abort", () => abortController.abort(), { once: true });
      }

      // Build system prompt from agent definition
      const systemPrompt = `${agentDef.prompt}\n\nYou are a subagent of type "${subagent_type}". ${agentDef.description}`;

      const runAgent = async (): Promise<string> => {
        const messages: AgentMessage[] = [];
        let resultText = "";

        for await (const msg of agentLoop(prompt, {
          provider,
          model,
          systemPrompt,
          tools: subTools,
          permissions: ctx.parentPermissions,
          cwd: ctx.parentCwd,
          sessionId,
          maxTurns,
          maxBudgetUsd: 5,
          includeStreamEvents: false,
          signal: abortController.signal,
          env: ctx.parentEnv,
          debug: ctx.parentDebug,
          hooks: ctx.parentHooks,
        })) {
          messages.push(msg);
          if (msg.type === "text") {
            resultText += msg.text;
          }
          if (msg.type === "result" && msg.subtype === "success") {
            resultText = msg.text ?? resultText;
          }
        }

        return resultText || "Subagent completed with no text output.";
      };

      if (run_in_background) {
        const taskId = uuid();
        const task = {
          id: taskId,
          agentType: subagent_type,
          status: "running" as const,
          abortController,
          promise: (async () => {
            try {
              const result = await runAgent();
              const t = ctx.taskManager.get(taskId);
              if (t && t.status === "running") {
                t.status = "completed";
                t.result = result;
              }
            } catch (err) {
              const t = ctx.taskManager.get(taskId);
              if (t && t.status === "running") {
                t.status = "failed";
                t.error = err instanceof Error ? err.message : String(err);
              }
            }
          })(),
        };
        ctx.taskManager.register(task);

        // Fire SubagentStop will happen when the background task completes
        return {
          content: `Background task started with ID: ${taskId}. Use TaskOutput to check results.`,
        };
      }

      // Foreground execution
      try {
        const result = await runAgent();

        // Fire SubagentStop hook
        if (ctx.parentHooks) {
          await ctx.parentHooks.fire(
            "SubagentStop",
            { event: "SubagentStop", agent_type: subagent_type, session_id: toolCtx.sessionId },
            undefined,
            { signal: toolCtx.signal },
          );
        }

        return { content: result };
      } catch (err) {
        // Fire SubagentStop hook even on error
        if (ctx.parentHooks) {
          await ctx.parentHooks.fire(
            "SubagentStop",
            { event: "SubagentStop", agent_type: subagent_type, session_id: toolCtx.sessionId },
            undefined,
            { signal: toolCtx.signal },
          );
        }

        const message = err instanceof Error ? err.message : String(err);
        return { content: `Subagent error: ${message}`, isError: true };
      }
    },
  };
}

export function createTaskOutputTool(taskManager: TaskManager): ToolImplementation {
  return {
    name: "TaskOutput",
    description: "Get the output from a background task.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The ID of the background task.",
        },
        block: {
          type: "boolean",
          description: "Whether to wait for the task to complete. Default: true.",
        },
        timeout: {
          type: "number",
          description: "Max wait time in milliseconds. Default: 30000.",
        },
      },
      required: ["task_id"],
    },
    async execute(input: unknown) {
      const { task_id, block = true, timeout = 30000 } = input as {
        task_id: string;
        block?: boolean;
        timeout?: number;
      };
      const output = await taskManager.getOutput(task_id, block, timeout);
      return { content: output };
    },
  };
}

export function createTaskStopTool(taskManager: TaskManager): ToolImplementation {
  return {
    name: "TaskStop",
    description: "Stop a running background task.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The ID of the background task to stop.",
        },
      },
      required: ["task_id"],
    },
    async execute(input: unknown) {
      const { task_id } = input as { task_id: string };
      const stopped = taskManager.stop(task_id);
      if (stopped) {
        return { content: `Task "${task_id}" has been stopped.` };
      }
      const task = taskManager.get(task_id);
      if (!task) {
        return { content: `Task "${task_id}" not found.`, isError: true };
      }
      return { content: `Task "${task_id}" is already ${task.status}.` };
    },
  };
}
