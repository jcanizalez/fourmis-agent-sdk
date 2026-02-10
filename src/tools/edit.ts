/**
 * Edit tool — exact string replacement in files.
 */

import type { ToolImplementation, ToolResult, ToolContext } from "./registry.ts";

export const EditTool: ToolImplementation = {
  name: "Edit",
  description:
    "Performs exact string replacements in files. The old_string must be unique in the file " +
    "unless replace_all is true. Use this for precise edits to existing files.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the file to edit",
      },
      old_string: {
        type: "string",
        description: "The exact text to find and replace",
      },
      new_string: {
        type: "string",
        description: "The replacement text",
      },
      replace_all: {
        type: "boolean",
        description: "Replace all occurrences (default: false)",
        default: false,
      },
    },
    required: ["file_path", "old_string", "new_string"],
  },

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { file_path, old_string, new_string, replace_all = false } = input as {
      file_path: string;
      old_string: string;
      new_string: string;
      replace_all?: boolean;
    };

    if (!file_path) {
      return { content: "Error: file_path is required", isError: true };
    }
    if (old_string === undefined) {
      return { content: "Error: old_string is required", isError: true };
    }
    if (new_string === undefined) {
      return { content: "Error: new_string is required", isError: true };
    }
    if (old_string === new_string) {
      return { content: "Error: old_string and new_string are identical", isError: true };
    }

    const resolvedPath = file_path.startsWith("/") ? file_path : `${ctx.cwd}/${file_path}`;

    try {
      const file = Bun.file(resolvedPath);
      const exists = await file.exists();

      if (!exists) {
        return { content: `Error: File not found: ${resolvedPath}`, isError: true };
      }

      const content = await file.text();

      // Count occurrences
      let count = 0;
      let searchFrom = 0;
      while (true) {
        const idx = content.indexOf(old_string, searchFrom);
        if (idx === -1) break;
        count++;
        searchFrom = idx + old_string.length;
      }

      if (count === 0) {
        // Show helpful context
        const preview = old_string.length > 100
          ? old_string.slice(0, 100) + "..."
          : old_string;
        return {
          content: `Error: old_string not found in ${resolvedPath}. Searched for:\n${preview}`,
          isError: true,
        };
      }

      if (count > 1 && !replace_all) {
        return {
          content: `Error: old_string appears ${count} times in the file. Use replace_all: true to replace all occurrences, or provide a longer string with more context to make it unique.`,
          isError: true,
        };
      }

      // Perform replacement
      let newContent: string;
      if (replace_all) {
        newContent = content.replaceAll(old_string, new_string);
      } else {
        const idx = content.indexOf(old_string);
        newContent = content.slice(0, idx) + new_string + content.slice(idx + old_string.length);
      }

      await Bun.write(resolvedPath, newContent);

      const replacements = replace_all ? count : 1;
      return {
        content: `Successfully replaced ${replacements} occurrence${replacements > 1 ? "s" : ""} in ${resolvedPath}`,
        metadata: { path: resolvedPath, replacements },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error editing file: ${message}`, isError: true };
    }
  },
};
