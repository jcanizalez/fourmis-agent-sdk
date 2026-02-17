/**
 * WebFetch tool.
 */

import type { ToolImplementation, ToolResult } from "./registry.ts";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 80_000;

export const WebFetchTool: ToolImplementation = {
  name: "WebFetch",
  description: "Fetches a URL and returns response text.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch.",
      },
      prompt: {
        type: "string",
        description: "Optional fetch intent/instructions.",
      },
      timeout_ms: {
        type: "number",
        description: "Timeout in milliseconds (default 20000).",
      },
      max_length: {
        type: "number",
        description: "Maximum output length (default 80000).",
      },
    },
    required: ["url"],
  },

  async execute(input: unknown): Promise<ToolResult> {
    const { url, timeout_ms, max_length } = (input ?? {}) as {
      url?: string;
      timeout_ms?: number;
      max_length?: number;
    };

    if (!url) return { content: "Error: url is required", isError: true };

    const timeout = Math.max(1000, timeout_ms ?? DEFAULT_TIMEOUT_MS);
    const outLimit = Math.max(1000, max_length ?? MAX_OUTPUT);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "user-agent": "fourmis-agent-sdk/1.0",
        },
      });

      const contentType = res.headers.get("content-type") ?? "unknown";
      let body = await res.text();
      if (body.length > outLimit) {
        body = body.slice(0, outLimit) + "\n... (truncated)";
      }

      return {
        content: [
          `Status: ${res.status} ${res.statusText}`,
          `Content-Type: ${contentType}`,
          "",
          body,
        ].join("\n"),
        isError: res.ok ? undefined : true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error fetching URL: ${message}`, isError: true };
    } finally {
      clearTimeout(timer);
    }
  },
};
