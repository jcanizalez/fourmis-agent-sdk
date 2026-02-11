/**
 * Settings manager — loads and persists permissions from .claude/settings*.json files.
 *
 * Supports three file sources:
 * - user:    ~/.claude/settings.json (user-wide)
 * - project: <cwd>/.claude/settings.json (shared with team)
 * - local:   <cwd>/.claude/settings.local.json (personal, gitignored)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
  PermissionsConfig,
  PermissionRuleValue,
  PermissionUpdate,
  PermissionUpdateDestination,
  SettingSource,
} from "./types.ts";

export class SettingsManager {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /** Load permissions from the specified sources and merge them. */
  loadPermissions(sources: SettingSource[]): PermissionsConfig {
    const allAllow: PermissionRuleValue[] = [];
    const allDeny: PermissionRuleValue[] = [];

    for (const source of sources) {
      const path = this.sourceToPath(source);
      const data = this.readJson(path);
      if (!data?.permissions) continue;

      const perms = data.permissions as Record<string, unknown>;

      if (Array.isArray(perms.allow)) {
        for (const rule of perms.allow) {
          if (typeof rule === "string") {
            allAllow.push(this.parseRule(rule));
          }
        }
      }

      if (Array.isArray(perms.deny)) {
        for (const rule of perms.deny) {
          if (typeof rule === "string") {
            allDeny.push(this.parseRule(rule));
          }
        }
      }
    }

    const result: PermissionsConfig = {};
    if (allAllow.length > 0) result.allow = allAllow;
    if (allDeny.length > 0) result.deny = allDeny;
    return result;
  }

  /** Persist a permission update to the appropriate settings file. */
  persistUpdate(update: PermissionUpdate): void {
    const path = this.destinationToPath(update.destination);
    if (!path) return; // session/cliArg — not file-backed

    const data = this.readJson(path) ?? {};
    if (!data.permissions) data.permissions = {};
    const perms = data.permissions as Record<string, unknown>;

    switch (update.type) {
      case "addRules": {
        const key = update.behavior; // "allow" or "deny"
        const existing = Array.isArray(perms[key]) ? (perms[key] as string[]) : [];
        const newRules = update.rules.map((r) => this.serializeRule(r));
        // Deduplicate
        const set = new Set(existing);
        for (const rule of newRules) set.add(rule);
        perms[key] = [...set];
        break;
      }
      case "removeRules": {
        const key = update.behavior;
        if (!Array.isArray(perms[key])) break;
        const toRemove = new Set(update.rules.map((r) => this.serializeRule(r)));
        perms[key] = (perms[key] as string[]).filter((r: string) => !toRemove.has(r));
        break;
      }
      case "replaceRules": {
        const key = update.behavior;
        perms[key] = update.rules.map((r) => this.serializeRule(r));
        break;
      }
      case "setMode": {
        perms.defaultMode = update.mode;
        break;
      }
      // addDirectories / removeDirectories — not persisted to permissions block
      default:
        return;
    }

    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  }

  /** Convert a SettingSource to a file path. */
  private sourceToPath(source: SettingSource): string {
    switch (source) {
      case "user":
        return join(homedir(), ".claude", "settings.json");
      case "project":
        return join(this.cwd, ".claude", "settings.json");
      case "local":
        return join(this.cwd, ".claude", "settings.local.json");
    }
  }

  /** Convert a PermissionUpdateDestination to a file path (or null if not file-backed). */
  private destinationToPath(destination: PermissionUpdateDestination): string | null {
    switch (destination) {
      case "userSettings":
        return join(homedir(), ".claude", "settings.json");
      case "projectSettings":
        return join(this.cwd, ".claude", "settings.json");
      case "localSettings":
        return join(this.cwd, ".claude", "settings.local.json");
      default:
        return null; // session, cliArg
    }
  }

  /** Read and parse a JSON file, returning null if it doesn't exist or is invalid. */
  private readJson(path: string): Record<string, unknown> | null {
    try {
      const content = readFileSync(path, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /** Parse a rule string like "Bash(npm test)" into a PermissionRuleValue. */
  parseRule(s: string): PermissionRuleValue {
    const match = s.match(/^([^(]+)\((.+)\)$/);
    if (match) return { toolName: match[1], ruleContent: match[2] };
    return { toolName: s };
  }

  /** Serialize a PermissionRuleValue into a rule string like "Bash(npm test)". */
  serializeRule(rule: PermissionRuleValue): string {
    return rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName;
  }
}
