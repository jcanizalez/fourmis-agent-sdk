/**
 * Plugin loader — discovers skills and MCP servers from plugin directories.
 *
 * A plugin is a directory that may contain:
 * - skills/         → SKILL.md files (loaded via loadSkillsFromDir)
 * - .mcp.json       → MCP server configurations
 * - hooks/hooks.json → hook definitions (future)
 * - commands/       → slash commands (future)
 * - agents/         → agent definitions (future)
 * - .claude-plugin/plugin.json → manifest with name/version/description
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadSkillsFromDir } from "./skills/index.ts";
import type { Skill, SkillDiagnostic } from "./skills/index.ts";
import type { SdkPluginConfig } from "./types.ts";
import type { McpServerConfig } from "./mcp/types.ts";

export type PluginComponents = {
  skills: Skill[];
  skillDiagnostics: SkillDiagnostic[];
  mcpServers: Record<string, McpServerConfig>;
};

/**
 * Read a plugin's manifest to get its name.
 * Falls back to the directory basename if no manifest exists.
 */
function getPluginName(pluginPath: string): string {
  const manifestPath = join(pluginPath, ".claude-plugin", "plugin.json");
  try {
    const raw = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);
    if (manifest.name && typeof manifest.name === "string") {
      return manifest.name;
    }
  } catch {
    // No manifest or invalid JSON — fall through
  }
  return basename(pluginPath);
}

/**
 * Recursively replace ${CLAUDE_PLUGIN_ROOT} in MCP config values.
 */
function expandPluginRoot(obj: unknown, pluginRoot: string): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginRoot);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => expandPluginRoot(item, pluginRoot));
  }
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = expandPluginRoot(v, pluginRoot);
    }
    return out;
  }
  return obj;
}

/**
 * Load all components from a list of plugins.
 *
 * Scans each plugin directory for:
 * - skills/ → loads SKILL.md files
 * - .mcp.json → reads MCP server configs (with ${CLAUDE_PLUGIN_ROOT} expansion)
 */
export function loadPluginComponents(
  plugins: SdkPluginConfig[] | undefined,
  debug?: boolean,
): PluginComponents {
  const result: PluginComponents = {
    skills: [],
    skillDiagnostics: [],
    mcpServers: {},
  };

  if (!plugins || plugins.length === 0) return result;

  for (const plugin of plugins) {
    if (plugin.type !== "local") continue;

    const pluginPath = plugin.path;
    if (!existsSync(pluginPath)) {
      if (debug) console.warn(`[plugins] plugin path does not exist: ${pluginPath}`);
      continue;
    }

    const pluginName = getPluginName(pluginPath);

    // Skills
    const skillsDir = join(pluginPath, "skills");
    if (existsSync(skillsDir)) {
      const skillsResult = loadSkillsFromDir({
        dir: skillsDir,
        source: `plugin:${pluginName}`,
      });
      result.skills.push(...skillsResult.skills);
      result.skillDiagnostics.push(...skillsResult.diagnostics);

      if (debug && skillsResult.skills.length > 0) {
        console.warn(`[plugins] ${pluginName}: loaded ${skillsResult.skills.length} skill(s)`);
      }
    }

    // MCP servers
    const mcpPath = join(pluginPath, ".mcp.json");
    if (existsSync(mcpPath)) {
      try {
        const raw = readFileSync(mcpPath, "utf-8");
        const mcpConfig = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
        if (mcpConfig.mcpServers) {
          for (const [serverName, serverCfg] of Object.entries(mcpConfig.mcpServers)) {
            const expanded = expandPluginRoot(serverCfg, pluginPath);
            // Namespace to avoid collisions: pluginName__serverName
            const key = `${pluginName}__${serverName}`;
            result.mcpServers[key] = expanded as McpServerConfig;
          }

          if (debug) {
            const count = Object.keys(mcpConfig.mcpServers).length;
            console.warn(`[plugins] ${pluginName}: loaded ${count} MCP server(s)`);
          }
        }
      } catch (err) {
        if (debug) {
          const msg = err instanceof Error ? err.message : "failed to parse .mcp.json";
          console.warn(`[plugins] ${pluginName}: ${msg}`);
        }
      }
    }
  }

  return result;
}
