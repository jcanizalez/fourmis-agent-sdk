/**
 * Agents module — re-exports.
 */

export type { AgentDefinition, BackgroundTask } from "./types.ts";
export { TaskManager } from "./task-manager.ts";
export { createTaskTool, createTaskOutputTool, createTaskStopTool } from "./tools.ts";
export type { AgentContext } from "./tools.ts";
