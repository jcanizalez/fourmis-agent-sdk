# Claude SDK Alignment Report

## 1. Audit Metadata

- Date: 2026-02-16
- Target project: `fourmis-agent-sdk`
- Goal: determine whether Fourmis is aligned with Anthropic Claude Agent SDK and list what must be updated for implementation.

### Claude SDK artifacts used

1. GitHub repo clone (latest tag metadata):
   - Path: `/Users/jcanizalez/Dev/fourmis/_external/claude-agent-sdk-typescript`
   - Tag: `v0.2.44`
   - Commit: `d683f48`
   - Note: repo contains changelog/docs, not full distributable SDK source.
2. Downloaded SDK package snapshot for deep type/runtime inspection:
   - Path: `/Users/jcanizalez/Dev/fourmis/_external/claude-agent-sdk-snapshots/claude-agent-sdk-0.2.38`
   - Includes: `sdk.d.ts`, `sdk-tools.d.ts`, `sdk.mjs`, `cli.js`
3. Project-installed package used for cross-check:
   - Path: `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk`
   - Version: `0.2.38` (from package.json)

### Constraint observed

- Direct `npm pack @anthropic-ai/claude-agent-sdk@latest` failed in this environment due DNS/network restriction to `registry.npmjs.org`.
- To keep the review exhaustive, this report combines:
  - full API/runtime inspection from the downloaded `0.2.38` package
  - version drift analysis from `v0.2.44` changelog.

## 2. Executive Summary

Fourmis is **partially compatible** with Claude SDK concepts but **not API-aligned**.

### Implementation Update (2026-02-16, Phase 1 in progress)

- Decision: **no backward compatibility layer** for legacy Fourmis messages.
- Implemented:
  1. `AgentMessage` is now Claude-envelope-only (`SDKMessage` union).
  2. `agent-loop.ts` now emits only Claude-style events:
     - `system/init`
     - `assistant`
     - `user` (for tool results)
     - `stream_event` (when enabled)
     - `result` (`success` and Claude error subtypes)
  3. Legacy output option removed (`messageFormat` removed).
  4. Streaming option renamed to Claude terminology (`includePartialMessages`).
  5. Query control methods from Phase 1 are wired in `query.ts`/`api.ts` with explicit stubs for not-yet-implemented controls.
  6. Test and compare harnesses were migrated to consume Claude envelopes.

Remaining for full parity is still tracked in Phases 2-4 below.

### Critical blockers (must fix before claiming parity)

1. Message protocol mismatch (`init/text/tool_use/...` vs Claude `system/assistant/user/result/...` envelopes).
2. `Query` control surface mismatch (Claude has many control methods not present in Fourmis).
3. `Options` surface mismatch (many Claude options missing or semantically different).
4. Built-in tool surface mismatch (Claude tool schema is much broader than Fourmis).
5. Hook event/schema mismatch (missing events and output contracts).
6. MCP status/control mismatch (missing statuses, fields, dynamic control methods).

### High-level parity estimate

- Core loop concepts (prompt, tools, permissions, sessions): present.
- Claude SDK API compatibility (types + runtime contract): not yet aligned.

## 3. Baseline Surfaces Compared

### Claude SDK reference points

- `sdk.d.ts`:
  - `Options`: around lines `449-854`
  - `Query` methods: around lines `988-1119`
  - `SDKMessage` union and message shapes: around lines `1181-1661`
  - Hook events include `Setup`, `TeammateIdle`, `TaskCompleted`: line `254`
- `sdk-tools.d.ts`:
  - Tool input union and interfaces: lines `11+`

### Fourmis reference points

- Options and messages: `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/types.ts`
- Query wrapper: `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/query.ts`
- Agent event emission: `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/agent-loop.ts`
- Hooks: `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/hooks.ts`
- Tools:
  - registry/presets: `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/tools/index.ts`, `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/tools/presets.ts`
  - MCP tools: `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/tools/mcp-resources.ts`
- MCP client/types:
  - `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/mcp/client.ts`
  - `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/mcp/types.ts`
- Permissions/settings/sessions:
  - `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/permissions.ts`
  - `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/settings.ts`
  - `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/utils/session-store.ts`

## 4. Detailed Gap Report

## G1. Message Envelope Is Not Claude-Compatible

### Current Fourmis

- Emits:
  - `init`, `text`, `tool_use`, `tool_result`, `stream`, `result`, `status`
  - defined in `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/types.ts` lines `107-186`
  - produced in `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/agent-loop.ts` lines `111-459`

### Claude SDK contract

- `SDKMessage` union includes:
  - `system` (`init`, `status`, `compact_boundary`, hook events, files persisted, task notifications)
  - `assistant`, `user`, `stream_event`, `result`, `tool_progress`, `tool_use_summary`, `auth_status`
  - see `sdk.d.ts` around lines `1181-1661`

### Required update

1. Replace/augment Fourmis message model to produce Claude envelopes directly.
2. Maintain compatibility layer if legacy Fourmis messages must remain (dual-mode output flag).
3. Align field names (`session_id`, `duration_ms`, `total_cost_usd`, etc.).

### Files to update

- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/types.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/agent-loop.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/query.ts`
- tests under `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/tests/`

## G2. Query Interface Missing Control Methods

### Current Fourmis

- `Query` only has iterator methods + `interrupt()` + `close()`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/types.ts` lines `308-314`

### Claude SDK methods missing

- `setPermissionMode`
- `setModel`
- `setMaxThinkingTokens`
- `initializationResult`
- `supportedCommands`
- `supportedModels`
- `mcpServerStatus`
- `accountInfo`
- `rewindFiles`
- `reconnectMcpServer`
- `toggleMcpServer`
- `setMcpServers`
- `streamInput`
- source: `sdk.d.ts` lines `988-1119`

### Required update

1. Extend `Query` type and runtime object to implement the control API.
2. Introduce control channel abstraction (internal command bus) for in-process provider loops.
3. For features not yet technically possible, return explicit typed errors, not silent no-ops.

### Files to update

- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/types.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/query.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/api.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/agent-loop.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/mcp/client.ts`

## G3. Query Options Surface Is Incomplete

### Present in Fourmis

- `provider`, `apiKey`, `baseUrl`, `model`, `cwd`, `systemPrompt`, `appendSystemPrompt`, `maxTurns`, `maxBudgetUsd`, `maxThinkingTokens`, tools/permissions/session fields, `includeStreamEvents`, hooks, MCP, agents, skills, memory, `debug`, `signal`, `env`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/types.ts` lines `227-304`

### Missing from Claude `Options` (major)

- `abortController` (only `signal` exists in Fourmis)
- `additionalDirectories`
- `agent` (main-thread agent selection)
- process controls: `executable`, `executableArgs`, `pathToClaudeCodeExecutable`, `extraArgs`, `spawnClaudeCodeProcess`, `stderr`, `debugFile`
- `fallbackModel`
- `enableFileCheckpointing`
- `betas`
- `includePartialMessages`
- `thinking` object + `effort`
- `outputFormat`
- `allowDangerouslySkipPermissions`
- `permissionPromptToolName`
- `plugins`
- `resumeSessionAt`
- `sandbox`
- `strictMcpConfig`
- source: `sdk.d.ts` lines `449-854`

### Required update

1. Add missing option types to Fourmis `QueryOptions`.
2. Mark Claude-specific options as supported/unsupported explicitly in runtime validation.
3. Implement a compatibility normalization layer:
   - map `abortController` to internal signal
   - map `includePartialMessages` to stream event mode
   - normalize `systemPrompt` preset object.

### Files to update

- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/types.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/api.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/query.ts`

## G4. Thinking Controls Not Fully Wired

### Current Fourmis

- `maxThinkingTokens` exists in type only; not passed into provider requests.
- `agentLoop` provider call does not pass thinking budget.
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/types.ts` line `240`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/agent-loop.ts` lines `159-166`

### Claude contract

- supports `thinking`, `effort`, and deprecated `maxThinkingTokens`
- query control method `setMaxThinkingTokens`
- source: `sdk.d.ts` lines `617-646`, `1029`

### Required update

1. Thread thinking config through `api.ts` -> `agent-loop.ts` -> provider adapter.
2. Add adaptive/disabled/enabled modes.
3. Add query-time and runtime control changes (`setMaxThinkingTokens`).

### Files to update

- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/types.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/api.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/agent-loop.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/providers/types.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/providers/anthropic.ts`

## G5. Structured Output Contract Missing

### Current Fourmis

- Anthropic provider claims `structured_output` support in feature flags.
- normalized content/types do not carry structured output result contract.
- no `outputFormat` option, no `structured_output` result payload.
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/providers/anthropic.ts` lines `220-231`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/types.ts`

### Claude contract

- `outputFormat` option (`json_schema`)
- result includes optional `structured_output`
- structured-output retry error subtype exists
- source: `sdk.d.ts` lines `688`, `1486`, `1516`

### Required update

1. Add `outputFormat` input type.
2. Pass schema to provider and validate output.
3. Include structured output in result envelope.
4. Add `error_max_structured_output_retries` handling.

## G6. Error/Result Schema Mismatch

### Current Fourmis

- error subtypes: `error_execution`, `error_max_turns`, `error_max_budget`
- result fields use camelCase and omit `is_error`, `stop_reason`, `permission_denials`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/types.ts` lines `147-170`

### Claude contract

- error subtypes include:
  - `error_during_execution`
  - `error_max_turns`
  - `error_max_budget_usd`
  - `error_max_structured_output_retries`
- result fields include:
  - `is_error`, `stop_reason`, `permission_denials`, `structured_output`
- source: `sdk.d.ts` lines `1484-1519`

### Required update

1. Align subtype names and result field naming.
2. Track permission denials in loop and surface them.
3. Include stop reason from provider done events.

## G7. Hooks: Missing Events and Output Semantics

### Current Fourmis

- Hook events stop at:
  - `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PermissionRequest`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/hooks.ts` lines `19-32`

### Claude contract differences

- Additional events:
  - `Setup`, `TeammateIdle`, `TaskCompleted`
- Hook matcher supports `timeout`
- Output contract includes broader fields:
  - `continue`, `suppressOutput`, `decision`, `reason`, `hookSpecificOutput`, etc.
- source: `sdk.d.ts` lines `254`, `266-271`, `1821-1829`

### Required update

1. Add missing event names and typed inputs.
2. Add timeout handling per matcher.
3. Expand output merge logic to support Claude semantics.
4. Add hook progress/response system messages where applicable.

## G8. Built-in Tool Catalog Is Incomplete

### Current Fourmis built-ins

- `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/tools/index.ts` lines `24-31`
- presets in `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/tools/presets.ts` lines `5-9`

### Claude tool schema includes additional tool inputs

- `ExitPlanMode`
- `NotebookEdit`
- `WebFetch`
- `WebSearch`
- `AskUserQuestion`
- `TodoWrite`
- `Config`
- plus MCP resource tools and task tools
- source: `sdk-tools.d.ts` `ToolInputSchemas` lines `11-30`

### Required update

1. Add missing tool implementations or supported stubs with clear errors.
2. Ensure `tools` option semantics match Claude (array or preset object).
3. Add tool-name compatibility tests against SDK schema.

## G9. Tool Input Schema Drift (Existing Tools)

### Notable mismatches

1. `Read`:
   - Claude supports `pages` for PDF reads.
   - Fourmis `Read` schema does not include `pages`.
2. `Bash`:
   - Claude supports `run_in_background`, `dangerouslyDisableSandbox`.
   - Fourmis `Bash` lacks these fields.
3. `Task`:
   - Claude `AgentInput` supports `model`, `resume`, `name`, `team_name`, `mode`.
   - Fourmis `Task` schema lacks these.
4. MCP resource tools:
   - Fourmis names are `mcp__list_resources` and `mcp__read_resource`.
   - Claude tool inputs are `ListMcpResourcesInput` and `ReadMcpResourceInput`.

### Files to update

- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/tools/read.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/tools/bash.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/agents/tools.ts`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/tools/mcp-resources.ts`

## G10. MCP Surface Missing Status/Control Parity

### Current Fourmis

- Status type only: `connected | failed | pending | disabled`
- no `needs-auth`, no `serverInfo`, no `config`, no `scope`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/mcp/types.ts` lines `50-55`

### Claude contract

- `McpServerStatus` includes:
  - `needs-auth` status
  - `serverInfo`, `config`, `scope`, tool annotations
- plus `reconnectMcpServer`, `toggleMcpServer`, `setMcpServers` query methods
- source: `sdk.d.ts` lines `325-367`, `1078-1103`

### Required update

1. Expand Fourmis MCP status model.
2. Add runtime methods to reconnect/toggle/set dynamic servers.
3. Preserve compatibility with existing Fourmis MCP manager behavior.

## G11. AgentDefinition Surface Mismatch

### Current Fourmis

- fields: `description`, `prompt`, `tools`, `model`, `provider`, `maxTurns`
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/agents/types.ts` lines `5-13`

### Claude contract

- includes `disallowedTools`, `mcpServers`, `criticalSystemReminder_EXPERIMENTAL`, `skills`, model enum constraints
- source: `sdk.d.ts` lines `33-67`

### Required update

1. Extend agent schema to include Claude fields.
2. Keep Fourmis-specific `provider` as extension, but avoid claiming strict Claude parity for that field.

## G12. Session Replay Is Partial

### Current Fourmis

- Session loader keeps only `text`, `tool_use`, `tool_result` content types.
- drops richer blocks/events.
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/utils/session-store.ts` lines `197-201`

### Claude implication

- modern sessions include additional metadata/event records.

### Required update

1. Preserve and replay richer message blocks where safe.
2. Keep compatibility for unknown blocks (do not silently discard everything unrecognized).

## G13. Settings Semantics Diverge from Claude

### Current Fourmis

- Settings manager only loads `permissions.allow/deny` from settings files.
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/settings.ts` lines `29-60`
- System prompt loader always reads `CLAUDE.md/AGENTS.md` from cwd.
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/utils/system-prompt.ts` lines `116-125`

### Claude behavior

- `settingSources` controls broader setting loading behavior; project source gating matters for CLAUDE.md semantics.

### Required update

1. Gate project instruction loading based on `settingSources` behavior if parity is required.
2. Expand settings parsing to include additional Claude setting fields used by parity mode.

## G14. Provider Feature Flags Overstate Capability

### Current Fourmis

- Anthropic adapter advertises `image_input`, `pdf_input`, `structured_output`.
- `/Users/jcanizalez/Dev/fourmis/fourmis-agent-sdk/src/providers/anthropic.ts` lines `220-228`
- But normalized message/content model does not support image/pdf blocks in provider-agnostic types.

### Required update

1. Either:
   - implement full typed support for those modalities, or
   - return `false` for unsupported flags to avoid false parity claims.

## G15. Version Drift

### Current state

- Fourmis depends on `@anthropic-ai/claude-agent-sdk` `^0.2.38`.
- latest tag observed: `0.2.44`.
- changelog indicates parity updates each release.

### Required update

1. Upgrade dependency to newest available package.
2. Re-run compatibility snapshots against the upgraded declarations.
3. Keep a pinned parity test against exact SDK version used for comparison.

## 5. Implementation Plan (Phased)

## Phase 0: Compatibility Harness (before refactor)

1. Add script to snapshot Claude SDK API surface (options keys, query methods, message union tags, tool schema names).
2. Add Fourmis snapshot script producing same shape.
3. Add diff test that fails when Fourmis parity mode diverges.

Deliverables:

- `tests/parity/claude-surface.snapshot.json`
- `tests/parity/fourmis-surface.snapshot.json`
- `tests/parity/claude-parity.test.ts`

## Phase 1: Message + Query Control Parity

1. Introduce Claude-compatible message schema in `src/types.ts`.
2. Update `agent-loop.ts` emission to produce Claude envelopes.
3. Extend `Query` object with control methods and stub behavior where needed.
4. Add compatibility option to preserve old Fourmis message shape if required.

## Phase 2: Options + Hook + Result Schema Parity

1. Expand `QueryOptions` to Claude set.
2. Add normalization layer for:
   - `abortController` vs `signal`
   - `systemPrompt` preset object
   - `includePartialMessages`
3. Expand hook event/input/output contracts.
4. Align result/error schemas (`is_error`, `stop_reason`, permission denials, structured output errors).

## Phase 3: Tool and MCP Parity

1. Add missing built-ins or parity wrappers:
   - `ExitPlanMode`, `NotebookEdit`, `WebFetch`, `WebSearch`, `AskUserQuestion`, `TodoWrite`, `Config`
2. Align existing tool input schemas with Claude (`Read.pages`, `Bash.run_in_background`, etc.).
3. Expand MCP status fields and add dynamic control methods.
4. Align MCP resource tool naming strategy for compatibility mode.

## Phase 4: Advanced Session/Settings/Thinking

1. Implement full thinking controls (`thinking`, `effort`, runtime updates).
2. Implement structured output contract (`outputFormat`, `structured_output`).
3. Improve session replay fidelity and settings parity behavior.

## 6. Acceptance Criteria for “Aligned with Claude SDK”

1. Fourmis parity mode accepts Claude `Options` with matching field names and equivalent behavior for supported features.
2. Fourmis `Query` exposes all Claude control methods with correct types and predictable behavior.
3. Message stream shape is Claude-compatible (`SDKMessage` union equivalent).
4. Tool input names/schemas map cleanly to Claude SDK tool definitions.
5. Hook events/outputs include all Claude-supported events and fields.
6. MCP status/control API includes Claude parity fields/methods.
7. CI parity test compares Fourmis vs downloaded Claude SDK declarations and fails on drift.

## 7. Priority Backlog (for implementation)

## P0 (start here)

1. Message schema migration (`src/types.ts`, `src/agent-loop.ts`)
2. Query control methods (`src/query.ts`, `src/api.ts`)
3. Options expansion + normalization (`src/types.ts`, `src/api.ts`)

## P1

1. Hook parity expansion (`src/hooks.ts`)
2. Error/result schema alignment (`src/types.ts`, `src/agent-loop.ts`)
3. MCP status/control parity (`src/mcp/types.ts`, `src/mcp/client.ts`)

## P2

1. Tool schema and missing tool implementations (`src/tools/*`, `src/agents/tools.ts`)
2. Session/settings fidelity (`src/utils/session-store.ts`, `src/settings.ts`, `src/utils/system-prompt.ts`)
3. Thinking/output-format parity (`src/providers/*`, `src/agent-loop.ts`)

## 8. Notes for Next Implementation Session

1. Keep multi-provider architecture; add a **Claude compatibility mode** rather than regressing Fourmis-native features.
2. Prefer additive migration:
   - preserve existing Fourmis API where possible
   - expose Claude-compatible API surface in parallel
   - deprecate only after parity tests stabilize.
3. Keep a strict distinction between:
   - type-level parity (compiles against Claude SDK contracts)
   - behavior parity (runtime semantics + event ordering + tool behavior).
