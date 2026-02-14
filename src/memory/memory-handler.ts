/**
 * Memory handler — file-based memory storage with path traversal protection.
 *
 * Implements all 6 memory tool operations:
 *   - view: Show directory contents or file contents
 *   - create: Create a new file
 *   - str_replace: Replace text in a file
 *   - insert: Insert text at a specific line
 *   - delete: Delete a file or directory
 *   - rename: Rename/move a file or directory
 *
 * All paths are sandboxed within the configured memory directory.
 */

import { readdir, stat, readFile, writeFile, rm, rename, mkdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { existsSync } from "node:fs";

export type MemoryCommand =
  | { command: "view"; path: string; view_range?: number[] }
  | { command: "create"; path: string; file_text: string }
  | { command: "str_replace"; path: string; old_str: string; new_str: string }
  | { command: "insert"; path: string; insert_line: number; insert_text: string }
  | { command: "delete"; path: string }
  | { command: "rename"; old_path: string; new_path: string };

/**
 * Create a memory handler bound to a specific directory.
 * All operations are sandboxed within this directory.
 */
export function createMemoryHandler(memoryDir: string) {
  // Ensure the directory exists
  const absMemoryDir = resolve(memoryDir);

  /**
   * Resolve a logical path (e.g. /memories/foo.txt) to an absolute filesystem path.
   * Validates that the resolved path stays within the memory directory.
   */
  function resolvePath(logicalPath: string): string {
    // Strip the /memories prefix if present, or just use as-is
    let cleaned = logicalPath;
    if (cleaned.startsWith("/memories")) {
      cleaned = cleaned.slice("/memories".length);
    }
    if (cleaned.startsWith("/")) {
      cleaned = cleaned.slice(1);
    }

    // Reject traversal patterns
    if (cleaned.includes("..") || cleaned.includes("%2e") || cleaned.includes("%2E")) {
      throw new Error(`Path traversal detected: ${logicalPath}`);
    }

    const absPath = cleaned === "" ? absMemoryDir : resolve(absMemoryDir, cleaned);

    // Verify the resolved path is within the memory directory
    const rel = relative(absMemoryDir, absPath);
    if (rel.startsWith("..") || resolve(absPath) !== absPath && !absPath.startsWith(absMemoryDir)) {
      throw new Error(`Path traversal detected: ${logicalPath}`);
    }

    return absPath;
  }

  /**
   * Format a path back to the logical /memories/ prefix form.
   */
  function toLogicalPath(absPath: string): string {
    const rel = relative(absMemoryDir, absPath);
    return rel === "" ? "/memories" : `/memories/${rel}`;
  }

  /**
   * Format a file size in human-readable form.
   */
  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  }

  /**
   * List directory contents up to 2 levels deep.
   */
  async function listDir(dirPath: string, depth: number = 0): Promise<string[]> {
    const lines: string[] = [];
    const dirStat = await stat(dirPath);
    if (depth === 0) {
      lines.push(`${formatSize(dirStat.size)}\t${toLogicalPath(dirPath)}`);
    }

    if (depth >= 2) return lines;

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const entryPath = join(dirPath, entry.name);
        const entryStat = await stat(entryPath);
        lines.push(`${formatSize(entryStat.size)}\t${toLogicalPath(entryPath)}`);
        if (entry.isDirectory()) {
          const subLines = await listDir(entryPath, depth + 1);
          // Skip the first line (dir itself) for nested dirs
          lines.push(...subLines.slice(depth === 0 ? 0 : 0));
        }
      }
    } catch {
      // Permission error or similar — just return what we have
    }

    return lines;
  }

  /**
   * Format file contents with line numbers (cat -n style).
   * Line numbers are 6-char right-aligned, followed by a tab.
   */
  function formatFileContent(content: string, viewRange?: number[]): string {
    const lines = content.split("\n");

    if (lines.length > 999_999) {
      throw new Error(`File exceeds maximum line limit of 999,999 lines.`);
    }

    let start = 0;
    let end = lines.length;

    if (viewRange && viewRange.length >= 2) {
      start = Math.max(0, viewRange[0] - 1); // Convert to 0-indexed
      end = Math.min(lines.length, viewRange[1]);
    }

    const formatted: string[] = [];
    for (let i = start; i < end; i++) {
      const lineNum = String(i + 1).padStart(6, " ");
      formatted.push(`${lineNum}\t${lines[i]}`);
    }

    return formatted.join("\n");
  }

  // ─── Command Handlers ──────────────────────────────────────────────────────

  async function handleView(cmd: Extract<MemoryCommand, { command: "view" }>): Promise<string> {
    const absPath = resolvePath(cmd.path);

    if (!existsSync(absPath)) {
      return `The path ${cmd.path} does not exist. Please provide a valid path.`;
    }

    const s = await stat(absPath);

    if (s.isDirectory()) {
      const lines = await listDir(absPath);
      return `Here're the files and directories up to 2 levels deep in ${cmd.path}, excluding hidden items and node_modules:\n${lines.join("\n")}`;
    }

    // File
    const content = await readFile(absPath, "utf-8");
    const formatted = formatFileContent(content, cmd.view_range);
    return `Here's the content of ${cmd.path} with line numbers:\n${formatted}`;
  }

  async function handleCreate(cmd: Extract<MemoryCommand, { command: "create" }>): Promise<string> {
    const absPath = resolvePath(cmd.path);

    if (existsSync(absPath)) {
      return `Error: File ${cmd.path} already exists`;
    }

    // Ensure parent directory exists
    const parentDir = resolve(absPath, "..");
    await mkdir(parentDir, { recursive: true });

    await writeFile(absPath, cmd.file_text, "utf-8");
    return `File created successfully at: ${cmd.path}`;
  }

  async function handleStrReplace(cmd: Extract<MemoryCommand, { command: "str_replace" }>): Promise<string> {
    const absPath = resolvePath(cmd.path);

    if (!existsSync(absPath)) {
      return `Error: The path ${cmd.path} does not exist. Please provide a valid path.`;
    }

    const s = await stat(absPath);
    if (s.isDirectory()) {
      return `Error: The path ${cmd.path} does not exist. Please provide a valid path.`;
    }

    const content = await readFile(absPath, "utf-8");

    // Check for occurrences
    const lines = content.split("\n");
    const matchingLines: number[] = [];
    let searchPos = 0;
    let occurrences = 0;

    while (true) {
      const idx = content.indexOf(cmd.old_str, searchPos);
      if (idx === -1) break;
      occurrences++;
      // Find line number
      const lineNum = content.substring(0, idx).split("\n").length;
      matchingLines.push(lineNum);
      searchPos = idx + cmd.old_str.length;
    }

    if (occurrences === 0) {
      return `No replacement was performed, old_str \`${cmd.old_str}\` did not appear verbatim in ${cmd.path}.`;
    }

    if (occurrences > 1) {
      return `No replacement was performed. Multiple occurrences of old_str \`${cmd.old_str}\` in lines: ${matchingLines.join(", ")}. Please ensure it is unique`;
    }

    // Single occurrence — do the replacement
    const newContent = content.replace(cmd.old_str, cmd.new_str);
    await writeFile(absPath, newContent, "utf-8");

    // Show a snippet around the replacement
    const newLines = newContent.split("\n");
    const replaceLine = matchingLines[0];
    const snippetStart = Math.max(0, replaceLine - 3);
    const snippetEnd = Math.min(newLines.length, replaceLine + 3);
    const snippet = newLines
      .slice(snippetStart, snippetEnd)
      .map((line, i) => `${String(snippetStart + i + 1).padStart(6, " ")}\t${line}`)
      .join("\n");

    return `The memory file has been edited.\n${snippet}`;
  }

  async function handleInsert(cmd: Extract<MemoryCommand, { command: "insert" }>): Promise<string> {
    const absPath = resolvePath(cmd.path);

    if (!existsSync(absPath)) {
      return `Error: The path ${cmd.path} does not exist`;
    }

    const s = await stat(absPath);
    if (s.isDirectory()) {
      return `Error: The path ${cmd.path} does not exist`;
    }

    const content = await readFile(absPath, "utf-8");
    const lines = content.split("\n");

    if (cmd.insert_line < 0 || cmd.insert_line > lines.length) {
      return `Error: Invalid \`insert_line\` parameter: ${cmd.insert_line}. It should be within the range of lines of the file: [0, ${lines.length}]`;
    }

    // Insert at the specified line
    const insertLines = cmd.insert_text.split("\n");
    lines.splice(cmd.insert_line, 0, ...insertLines);

    await writeFile(absPath, lines.join("\n"), "utf-8");
    return `The file ${cmd.path} has been edited.`;
  }

  async function handleDelete(cmd: Extract<MemoryCommand, { command: "delete" }>): Promise<string> {
    const absPath = resolvePath(cmd.path);

    if (!existsSync(absPath)) {
      return `Error: The path ${cmd.path} does not exist`;
    }

    await rm(absPath, { recursive: true, force: true });
    return `Successfully deleted ${cmd.path}`;
  }

  async function handleRename(cmd: Extract<MemoryCommand, { command: "rename" }>): Promise<string> {
    const oldAbs = resolvePath(cmd.old_path);
    const newAbs = resolvePath(cmd.new_path);

    if (!existsSync(oldAbs)) {
      return `Error: The path ${cmd.old_path} does not exist`;
    }

    if (existsSync(newAbs)) {
      return `Error: The destination ${cmd.new_path} already exists`;
    }

    // Ensure parent directory of destination exists
    const parentDir = resolve(newAbs, "..");
    await mkdir(parentDir, { recursive: true });

    await rename(oldAbs, newAbs);
    return `Successfully renamed ${cmd.old_path} to ${cmd.new_path}`;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Execute a memory command and return the result string.
   */
  async function execute(cmd: MemoryCommand): Promise<string> {
    // Ensure memory directory exists
    if (!existsSync(absMemoryDir)) {
      await mkdir(absMemoryDir, { recursive: true });
    }

    switch (cmd.command) {
      case "view":
        return handleView(cmd);
      case "create":
        return handleCreate(cmd);
      case "str_replace":
        return handleStrReplace(cmd);
      case "insert":
        return handleInsert(cmd);
      case "delete":
        return handleDelete(cmd);
      case "rename":
        return handleRename(cmd);
      default:
        return `Error: Unknown command: ${(cmd as any).command}`;
    }
  }

  return { execute, resolvePath, toLogicalPath };
}
