/**
 * All comparison scenarios.
 */
import type { Scenario } from "../runner.ts";
import { scenario as s01 } from "./01-simple-text.ts";
import { scenario as s02 } from "./02-read-file.ts";
import { scenario as s03 } from "./03-multi-tool.ts";
import { scenario as s04 } from "./04-error-recovery.ts";
import { scenario as s05 } from "./05-budget-limit.ts";

// Note: scenarios 06, 07, 08, 09 are standalone — they run their own
// comparison logic internally rather than using the generic runner.
// Run them directly:
//   bun tests/compare/scenarios/06-permissions.ts
//   bun tests/compare/scenarios/07-hooks.ts
//   bun tests/compare/scenarios/08-mcp.ts
//   bun tests/compare/scenarios/09-subagents.ts

export const scenarios: Scenario[] = [s01, s02, s03, s04, s05];
