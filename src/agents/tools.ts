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
import { loadSessionMessages } from "../utils/session-store.ts";

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
        model: {
          type: "string",
          enum: ["sonnet", "opus", "haiku"],
          description: "Optional model family hint for this subagent.",
        },
        resume: {
          type: "string",
          description: "Optional session ID to resume this subagent from.",
        },
        run_in_background: {
          type: "boolean",
          description: "If true, run the task in the background and return a task ID.",
        },
        max_turns: {
          type: "number",
          description: "Maximum number of turns for the subagent.",
        },
        name: {
          type: "string",
          description: "Optional display name for the spawned subagent.",
        },
        team_name: {
          type: "string",
          description: "Optional team name context for this subagent.",
        },
        mode: {
          type: "string",
          enum: ["acceptEdits", "bypassPermissions", "default", "delegate", "dontAsk", "plan"],
          description: "Permission mode hint for the spawned subagent.",
        },
      },
      required: ["description", "prompt", "subagent_type"],
    },
    async execute(input: unknown, toolCtx) {
      const {
        description,
        prompt,
        subagent_type,
        model: requestedModel,
        resume,
        run_in_background,
        max_turns,
        name,
        team_name,
        mode,
      } = input as {
        description: string;
        prompt: string;
        subagent_type: string;
        model?: "sonnet" | "opus" | "haiku";
        resume?: string;
        run_in_background?: boolean;
        max_turns?: number;
        name?: string;
        team_name?: string;
        mode?: "acceptEdits" | "bypassPermissions" | "default" | "delegate" | "dontAsk" | "plan";
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

      // Resolve model (task input override > agent override > parent)
      const modelAliases: Record<"sonnet" | "opus" | "haiku", string> = {
        sonnet: "claude-sonnet-4-5-20250929",
        opus: "claude-opus-4-5-20251101",
        haiku: "claude-haiku-4-5-20251001",
      };
      const model = requestedModel
        ? modelAliases[requestedModel]
        : (agentDef.model ?? ctx.parentModel);

      // Build subagent's tool registry
      const baseTools = agentDef.tools ?? resolveToolNames({ type: "preset", preset: "claude_code" });
      const subTools: ToolRegistry = buildToolRegistry(baseTools, undefined, agentDef.disallowedTools);

      const maxTurns = max_turns ?? agentDef.maxTurns ?? 10;
      const sessionId = resume ?? uuid();
      const previousMessages = resume ? loadSessionMessages(ctx.parentCwd, resume) : undefined;
      const abortController = new AbortController();

      // Link parent signal
      if (toolCtx.signal) {
        toolCtx.signal.addEventListener("abort", () => abortController.abort(), { once: true });
      }

      // Build system prompt from agent definition
      const systemPromptParts = [
        agentDef.prompt,
        `You are a subagent of type "${subagent_type}". ${agentDef.description}`,
        `Task summary: ${description}`,
      ];
      if (agentDef.criticalSystemReminder_EXPERIMENTAL) {
        systemPromptParts.push(`Critical reminder: ${agentDef.criticalSystemReminder_EXPERIMENTAL}`);
      }
      if (agentDef.skills && agentDef.skills.length > 0) {
        systemPromptParts.push(`Available skills:\n${agentDef.skills.map((s) => `- ${s}`).join("\n")}`);
      }
      if (name) {
        systemPromptParts.push(`Subagent name: ${name}`);
      }
      if (team_name) {
        systemPromptParts.push(`Team context: ${team_name}`);
      }
      if (mode) {
        systemPromptParts.push(`Permission mode hint: ${mode}`);
      }
      const systemPrompt = systemPromptParts.join("\n\n");

      const runAgent = async (): Promise<string> => {
        const messages: AgentMessage[] = [];
        let resultText = "";

        for await (const msg of agentLoop(prompt, {
          provider,
          model,
          modelState: { current: model },
          systemPrompt,
          tools: subTools,
          permissions: ctx.parentPermissions,
          cwd: ctx.parentCwd,
          sessionId,
          maxTurns,
          maxBudgetUsd: 5,
          includePartialMessages: false,
          signal: abortController.signal,
          env: ctx.parentEnv,
          debug: ctx.parentDebug,
          hooks: ctx.parentHooks,
          previousMessages,
        })) {
          messages.push(msg);
          if (msg.type === "assistant") {
            for (const block of msg.message.content) {
              if (block.type === "text") {
                resultText += block.text;
              }
            }
          }
          if (msg.type === "result" && msg.subtype === "success") {
            resultText = msg.result || resultText;
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
