/**
 * NotebookEdit tool.
 * Edits code/markdown cell content in a .ipynb notebook.
 */

import { readFile, writeFile } from "node:fs/promises";
import type { ToolImplementation, ToolResult, ToolContext } from "./registry.ts";

type NotebookCell = {
  cell_type?: string;
  id?: string;
  source?: string[];
};

type Notebook = {
  cells?: NotebookCell[];
  [key: string]: unknown;
};

function toSourceLines(text: string): string[] {
  const lines = text.split("\n");
  return lines.map((line, idx) => (idx < lines.length - 1 ? `${line}\n` : line));
}

export const NotebookEditTool: ToolImplementation = {
  name: "NotebookEdit",
  description: "Edit a specific Jupyter notebook cell by id or index.",
  inputSchema: {
    type: "object",
    properties: {
      notebook_path: { type: "string", description: "Path to .ipynb file." },
      cell_id: { type: "string", description: "Cell id to edit." },
      cell_index: { type: "number", description: "Cell index to edit if id is not provided." },
      new_source: { type: "string", description: "New cell source content." },
    },
    required: ["notebook_path", "new_source"],
  },

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const {
      notebook_path,
      cell_id,
      cell_index,
      new_source,
    } = (input ?? {}) as {
      notebook_path?: string;
      cell_id?: string;
      cell_index?: number;
      new_source?: string;
    };

    if (!notebook_path) return { content: "Error: notebook_path is required", isError: true };
    if (new_source === undefined) return { content: "Error: new_source is required", isError: true };

    const filePath = notebook_path.startsWith("/") ? notebook_path : `${ctx.cwd}/${notebook_path}`;

    try {
      const raw = await readFile(filePath, "utf-8");
      const notebook = JSON.parse(raw) as Notebook;

      if (!Array.isArray(notebook.cells)) {
        return { content: "Error: notebook has no cells array", isError: true };
      }

      let targetIndex = -1;
      if (cell_id) {
        targetIndex = notebook.cells.findIndex((c) => c.id === cell_id);
      } else if (typeof cell_index === "number") {
        targetIndex = cell_index;
      } else {
        targetIndex = 0;
      }

      if (targetIndex < 0 || targetIndex >= notebook.cells.length) {
        return {
          content: `Error: cell not found (id=${cell_id ?? "n/a"}, index=${String(cell_index ?? "n/a")})`,
          isError: true,
        };
      }

      const cell = notebook.cells[targetIndex];
      cell.source = toSourceLines(new_source);

      await writeFile(filePath, JSON.stringify(notebook, null, 2) + "\n", "utf-8");

      return {
        content: `Updated notebook cell ${targetIndex} in ${filePath}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error editing notebook: ${message}`, isError: true };
    }
  },
};
