/**
 * WebSearch tool.
 * Uses DuckDuckGo HTML endpoint for lightweight public web search.
 */

import type { ToolImplementation, ToolResult } from "./registry.ts";

const SEARCH_ENDPOINT = "https://duckduckgo.com/html/";

function stripTags(input: string): string {
  return input
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export const WebSearchTool: ToolImplementation = {
  name: "WebSearch",
  description: "Searches the web and returns top result links.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query.",
      },
      max_results: {
        type: "number",
        description: "Maximum results to return (default 5).",
      },
    },
    required: ["query"],
  },

  async execute(input: unknown): Promise<ToolResult> {
    const { query, max_results } = (input ?? {}) as {
      query?: string;
      max_results?: number;
    };

    if (!query) {
      return { content: "Error: query is required", isError: true };
    }

    const limit = Math.max(1, Math.min(20, max_results ?? 5));

    try {
      const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          "user-agent": "fourmis-agent-sdk/1.0",
        },
      });

      if (!res.ok) {
        return {
          content: `Error searching web: ${res.status} ${res.statusText}`,
          isError: true,
        };
      }

      const html = await res.text();
      const matches = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];

      if (matches.length === 0) {
        return { content: "No search results found." };
      }

      const lines: string[] = [];
      for (let i = 0; i < Math.min(limit, matches.length); i++) {
        const href = stripTags(matches[i][1]);
        const title = stripTags(matches[i][2]);
        lines.push(`${i + 1}. ${title}\n   ${href}`);
      }

      return { content: lines.join("\n") };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error searching web: ${message}`, isError: true };
    }
  },
};
