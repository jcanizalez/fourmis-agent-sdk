/**
 * Config tool.
 * Reads/writes Claude-style settings JSON files.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { ToolImplementation, ToolResult, ToolContext } from "./registry.ts";

type Scope = "local" | "project";

function scopePath(cwd: string, scope: Scope): string {
  if (scope === "project") return join(cwd, ".claude", "settings.json");
  return join(cwd, ".claude", "settings.local.json");
}

function setByPath(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const keys = keyPath.split(".").filter(Boolean);
  if (keys.length === 0) return;

  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = current[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

function getByPath(obj: Record<string, unknown>, keyPath: string): unknown {
  const keys = keyPath.split(".").filter(Boolean);
  let current: unknown = obj;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export const ConfigTool: ToolImplementation = {
  name: "Config",
  description: "Read or update .claude settings values.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["get", "set", "list"],
      },
      key: {
        type: "string",
        description: "Dot-path key (for get/set).",
      },
      value: {
        description: "Value for set action.",
      },
      scope: {
        type: "string",
        enum: ["local", "project"],
      },
    },
    required: ["action"],
  },

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const {
      action,
      key,
      value,
      scope = "local",
    } = (input ?? {}) as {
      action?: "get" | "set" | "list";
      key?: string;
      value?: unknown;
      scope?: Scope;
    };

    if (!action) {
      return { content: "Error: action is required", isError: true };
    }

    const filePath = scopePath(ctx.cwd, scope);

    let data: Record<string, unknown> = {};
    try {
      const raw = await readFile(filePath, "utf-8");
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      data = {};
    }

    if (action === "list") {
      return { content: JSON.stringify(data, null, 2) };
    }

    if (!key) {
      return { content: "Error: key is required for get/set", isError: true };
    }

    if (action === "get") {
      const out = getByPath(data, key);
      return { content: out === undefined ? "undefined" : JSON.stringify(out, null, 2) };
    }

    setByPath(data, key, value);

    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
      return { content: `Updated ${key} in ${filePath}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error writing config: ${message}`, isError: true };
    }
  },
};
