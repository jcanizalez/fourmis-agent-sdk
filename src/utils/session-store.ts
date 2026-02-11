/**
 * Session persistence — JSONL read/write compatible with Claude SDK format.
 *
 * Sessions are stored as one JSON object per line in:
 *   ~/.claude/projects/{sanitized-cwd}/{sessionId}.jsonl
 *
 * Path sanitization matches Claude SDK: replace `/` and `.` with `-`.
 *   /root/.fourmis/workspaces/doremi → -root--fourmis-workspaces-doremi
 */

import { readFileSync, appendFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { NormalizedMessage, NormalizedContent } from "../providers/types.ts";
import { uuid as makeUuid } from "../types.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * JSONL entry — compatible with Claude SDK session format.
 *
 * Claude SDK entries include additional fields (isSidechain, userType, version,
 * gitBranch, permissionMode, message.model, message.usage, requestId, etc.)
 * that we include for compatibility. When loading, we only need type + message.
 */
export type SessionEntry = {
  type: "user" | "assistant";
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  cwd: string;
  isSidechain: boolean;
  userType: string;
  message: {
    role: string;
    content: NormalizedContent[] | string;
    model?: string;
  };
  permissionMode?: string;
};

// ─── Path helpers ───────────────────────────────────────────────────────────

/**
 * Sanitize a cwd path to a directory name, matching Claude SDK convention.
 * Replaces `/` and `.` with `-`.
 *   /root/dev/fourmis → -root-dev-fourmis
 *   /root/.fourmis/workspaces/doremi → -root--fourmis-workspaces-doremi
 */
export function sanitizeCwd(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

/**
 * Returns the sessions directory for a given cwd.
 * Path: ~/.claude/projects/{sanitized-cwd}/
 */
export function sessionsDir(cwd: string): string {
  return join(homedir(), ".claude", "projects", sanitizeCwd(cwd));
}

/**
 * Ensure the sessions directory exists.
 */
function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

// ─── Write ──────────────────────────────────────────────────────────────────

/**
 * Append a single JSONL entry to the session file.
 */
export function logMessage(
  dir: string,
  sessionId: string,
  entry: SessionEntry,
): void {
  ensureDir(dir);
  const filePath = join(dir, `${sessionId}.jsonl`);
  appendFileSync(filePath, JSON.stringify(entry) + "\n");
}

/**
 * Create a session logger function for use in the agent loop.
 * Returns a function that logs messages and returns the entry UUID.
 */
export function createSessionLogger(
  cwd: string,
  sessionId: string,
  model?: string,
): (role: "user" | "assistant", content: NormalizedContent[] | string, parentUuid: string | null) => string {
  const dir = sessionsDir(cwd);
  let lastUuid: string | null = null;

  return (role, content, parentUuid) => {
    const entryUuid = makeUuid();

    // Normalize user text content to array form (matching Claude SDK)
    let normalizedContent = content;
    if (role === "user" && typeof content === "string") {
      normalizedContent = [{ type: "text" as const, text: content }];
    }

    const entry: SessionEntry = {
      type: role,
      uuid: entryUuid,
      parentUuid: parentUuid ?? lastUuid,
      sessionId,
      timestamp: new Date().toISOString(),
      cwd,
      isSidechain: false,
      userType: "external",
      message: {
        role,
        content: normalizedContent,
        ...(role === "assistant" && model ? { model } : {}),
      },
      ...(role === "user" ? { permissionMode: "default" } : {}),
    };

    logMessage(dir, sessionId, entry);
    lastUuid = entryUuid;
    return entryUuid;
  };
}

// ─── Read ───────────────────────────────────────────────────────────────────

/**
 * Find the most recent session file in the sessions directory for a cwd.
 * Returns the sessionId (filename without .jsonl) or null.
 */
export function findLatestSession(cwd: string): string | null {
  const dir = sessionsDir(cwd);
  try {
    const files = readdirSync(dir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => {
        const filePath = join(dir, f);
        try {
          return { name: f, mtime: statSync(filePath).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((f): f is { name: string; mtime: number } => f !== null)
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;
    return files[0].name.replace(/\.jsonl$/, "");
  } catch {
    return null;
  }
}

/**
 * Load messages from a session JSONL file and reconstruct NormalizedMessage[].
 * Skips non-message entries (file-history-snapshot, queue-operation, system, progress).
 */
export function loadSessionMessages(
  cwd: string,
  sessionId: string,
): NormalizedMessage[] {
  const dir = sessionsDir(cwd);
  const filePath = join(dir, `${sessionId}.jsonl`);

  let lines: string[];
  try {
    lines = readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }

  const messages: NormalizedMessage[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;

      // Only process user and assistant message entries
      if (entry.type !== "user" && entry.type !== "assistant") continue;

      // Skip meta messages (Claude SDK uses these for internal bookkeeping)
      if (entry.isMeta === true) continue;

      const message = entry.message as { role: string; content: unknown } | undefined;
      if (!message) continue;

      const role = entry.type === "user" ? "user" : "assistant";
      let content: NormalizedContent[] | string;

      if (typeof message.content === "string") {
        content = message.content;
      } else if (Array.isArray(message.content)) {
        // Filter to only content types we can replay (text, tool_use, tool_result)
        // Skip thinking blocks, etc.
        content = (message.content as Record<string, unknown>[])
          .filter(c => c.type === "text" || c.type === "tool_use" || c.type === "tool_result")
          .map(c => c as NormalizedContent);
      } else {
        continue;
      }

      messages.push({ role, content } as NormalizedMessage);
    } catch {
      // Skip malformed lines
    }
  }

  return messages;
}
