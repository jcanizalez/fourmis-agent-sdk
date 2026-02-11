/**
 * Task manager — tracks background subagent tasks.
 */

import type { BackgroundTask } from "./types.ts";

export class TaskManager {
  private tasks = new Map<string, BackgroundTask>();

  register(task: BackgroundTask): void {
    this.tasks.set(task.id, task);
  }

  get(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  stop(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status !== "running") return false;
    task.abortController.abort();
    task.status = "stopped";
    return true;
  }

  async getOutput(id: string, block: boolean, timeoutMs: number): Promise<string> {
    const task = this.tasks.get(id);
    if (!task) {
      return `Task "${id}" not found.`;
    }

    if (task.status !== "running") {
      return this.formatOutput(task);
    }

    if (!block) {
      return `Task "${id}" is still running.`;
    }

    // Block until done or timeout
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    await Promise.race([task.promise, timeoutPromise]);

    if (task.status === "running") {
      return `Task "${id}" is still running (timed out after ${timeoutMs}ms).`;
    }

    return this.formatOutput(task);
  }

  list(): BackgroundTask[] {
    return [...this.tasks.values()];
  }

  private formatOutput(task: BackgroundTask): string {
    if (task.status === "failed") {
      return `Task "${task.id}" failed: ${task.error ?? "unknown error"}`;
    }
    if (task.status === "stopped") {
      return `Task "${task.id}" was stopped.`;
    }
    return task.result ?? `Task "${task.id}" completed with no output.`;
  }
}
