/**
 * Skills module — SKILL.md discovery, loading, and prompt injection.
 */

export {
  loadSkills,
  loadSkillsFromDir,
  formatSkillsForPrompt,
} from "./skills.ts";

export type {
  Skill,
  SkillFrontmatter,
  SkillDiagnostic,
  LoadSkillsResult,
  LoadSkillsFromDirOptions,
  LoadSkillsOptions,
} from "./skills.ts";

export { parseFrontmatter, stripFrontmatter } from "./frontmatter.ts";
export type { ParsedFrontmatter } from "./frontmatter.ts";
