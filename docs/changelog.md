# Changelog

All notable changes to the ADO TestForge MCP server are documented here.

---

## 2026-04-14 — Reliable File Link Generation

### Fixed: Generated markdown links now open reliably in Cursor

- **Root cause:** `toFileUri()` used manual `encodeURIComponent` + `file://` (double-slash) instead of proper `file:///` (triple-slash) URLs. Paths containing spaces (e.g., "MCP TC PREP"), `#`, `%`, or parentheses produced broken links.
- **Fix:** Replaced with `pathToFileURL()` from Node's `url` module via new shared utility `src/helpers/file-links.ts`.
- **Structured output:** `save_tc_draft`, `save_tc_clone_preview`, and `push_tc_draft_to_ado` now return structured fields: `fileName`, `absolutePath`, `workspaceRelativePath`, `fileUrl`.
- **Sibling document links:** Generated markdown includes relative links to Solution Design Summary and QA Cheat Sheet only when those files exist on disk. Missing siblings are omitted (no broken links).
- **Logging:** All draft saves log the absolute path, file URL, and relative link targets to stderr for debugging.
- **Tests:** Added 26 regression tests covering paths with spaces, `#`, `%`, `()`, nested folders, sibling file existence checks, and markdown formatter link integration.
- **Files changed:** `src/helpers/file-links.ts` (new), `src/tools/tc-drafts.ts`, `src/helpers/tc-draft-formatter.ts`, `src/__tests__/file-links.test.ts` (new), `src/__tests__/tc-draft-formatter-links.test.ts` (new), `docs/implementation.md`, `docs/changelog.md`, `package.json`

---

## 2026-04-14 — Test Coverage Insights (replaces Coverage Validation Checklist)

### Enhanced Coverage Section in Drafts

- **`coverageValidationChecklist`** (simple string array) replaced by **`testCoverageInsights`** (structured object array) across schema, formatter, parser, prompts, and skill.
- Each scenario is now classified with: `covered` (true/false), `P/N` (Positive/Negative), `F/NF` (Functional/Non-Functional), `Priority` (High/Medium/Low), and optional `Notes`.
- The formatter **auto-computes** a Coverage Summary: total scenarios, covered count, coverage %, P vs N distribution, F vs NF distribution.
- 7-column table with emoji indicators (✅/❌ covered, 🟢/🔴 P/N, 🔵/🟣 F/NF, 🔴/🟡/🟢 priority) for universal rendering across all markdown viewers.
- **Files changed:** `src/helpers/tc-draft-formatter.ts`, `src/helpers/tc-draft-parser.ts`, `src/tools/tc-drafts.ts`, `src/prompts/index.ts`, `.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md`

---

## 2026-04-06 — Test Plan ID Now Optional in Draft Stage

### Simplified Draft Workflow

- **`save_tc_draft`** — `planId` parameter is now **optional**. You can draft test cases with just the User Story ID.
- **`draft_test_cases`** command — Now only asks for User Story ID (no longer asks for Test Plan ID).
- **Auto-derivation** — When pushing a draft to ADO via `push_tc_draft_to_ado`, if the draft has no `planId`, the system automatically:
  1. Calls `ensureSuiteHierarchyForUs(userStoryId)` to derive the Test Plan ID from the User Story's AreaPath (via `testPlanMapping` in config)
  2. Creates the suite hierarchy (sprint > parent > US folders)
  3. Creates the test cases with the correct plan context

### Benefits

- **Less repetition**: When drafting multiple User Stories in the same area/sprint, you no longer need to provide the same Test Plan ID repeatedly
- **Cleaner workflow**: Draft stage is purely about test case logic; plan resolution happens automatically during push
- **Backwards compatible**: If you provide `planId` during draft, it will be used; if not, it's derived automatically

### How It Works

The draft markdown now shows `Plan ID | To be derived` when planId is not provided. When you push the draft to ADO, the system uses the `testPlanMapping` configuration to match the User Story's AreaPath to the correct test plan, ensuring test cases are created in the right plan automatically.

---

## 2026-03-08 — Consolidated Installer and Rename

### Single MCP Entry

- **Consolidated:** `setup-ado-testforge` merged into `ado-testforge`. Now there's only one MCP entry.
- **Install command:** `/ado-testforge/install` (was `/setup-ado-testforge/install`)
- **Smart mode detection:** Server shows install command when not ready, full tools when ready.

### Enhanced Prerequisite Checks

The install command now checks:
- Google Drive desktop app (warning if not detected)
- Node.js v18+ (required)
- Folder structure validity (required)

### Breaking: Server and Credentials Rename

- **MCP servers:** `mars-ado` → `ado-testforge` (single entry, no separate installer)
- **Slash commands:** `/mars-ado/*` → `/ado-testforge/*`
- **Credentials path:** `~/.mars-ado-mcp/` → `~/.ado-testforge-mcp/`
- **Package name:** `mars-ado-mcp` → `ado-testforge-mcp`

**Migration for existing users:** Copy your credentials to the new path, or run `/ado-testforge/install` to create a fresh template and re-enter your PAT/org/project. Restart Cursor or reload MCP after migration.

---

## 2026-02-25 — Clone and Enhance Test Cases

### New Command and Tools

- **`/ado-testforge/clone_and_enhance_test_cases`** — Clone test cases from a source User Story to a target User Story. Reads source TCs, analyzes target US + Solution Design, classifies each TC (Clone As-Is / Minor Update / Enhanced), generates preview, creates in ADO only after explicit APPROVED.
- **`list_test_cases_linked_to_user_story`** — Get test case IDs linked to a User Story via Tests/Tested By relation. Use before cloning.
- **`save_tc_clone_preview`** — Save clone preview to `tc-drafts/Clone_US_X_to_US_Y_preview.md`. User reviews and responds APPROVED / MODIFY / CANCEL.

### Suite Hierarchy

- **`ensure_suite_hierarchy_for_us`** — Now returns `planId` in the result (used by clone flow for save_tc_draft).

---

## 2026-02-25 — Create/Update Suite: User Story ID Only; Auto-Derive Plan & Sprint

### New Tool: ensure_suite_hierarchy_for_us

- Takes **only User Story ID**. Derives test plan from US AreaPath (via `testPlanMapping`) and sprint from Iteration (e.g. SFTPM_24 → 24).
- Creates folders if missing; updates naming if existing suite has wrong format (e.g. `||` → `|`).

### Config: testPlanMapping

- **`conventions.config.json`** → `suiteStructure.testPlanMapping`: Array of `{ planId, areaPathContains }`. First match wins. Example: DHub/D-HUB → GPT_D-HUB (1066479), EHub/E-HUB → GPT_E-HUB. Configure plan IDs for your project.

### Prompt Updates

- **`create_test_suite`** and **`update_test_suite`** now ask only for User Story ID and use `ensure_suite_hierarchy_for_us`.
- **`/ado-testforge/ensure_suite_hierarchy_for_us`** — New slash command for the same flow.

---

## 2026-02-25 — Create, Update, and Delete Test Suite Commands

### New Tools and Slash Commands

- **`create_test_suite`** — Create a new test suite under a parent. Uses find-or-create logic; returns existing suite if one with the same name already exists under that parent.
- **`update_test_suite`** — Update an existing test suite. Supports partial updates: `name`, `parentSuiteId`, `queryString` (for dynamic suites).
- **`delete_test_suite`** — Delete a test suite. Test cases in the suite are not deleted—only their association with the suite is removed.
- **Slash commands:** `/ado-testforge/create_test_suite`, `/ado-testforge/update_test_suite`, `/ado-testforge/delete_test_suite`

---

## 2026-02-25 — Formatting: Prerequisites, Persona Sub-bullets, Test Steps

### Prerequisite for Test & Test Steps Formatting

- **Problem:** Draft markdown (`**bold**`, bullets, "A. X B. Y" lists) displayed as raw text in ADO.
- **Fix:** Added `src/helpers/format-html.ts` with shared formatters:
  - `formatContentForHtml()`: escapes HTML, converts `**bold**` to `<strong>`, newlines to `<br>`, "A./B." and "- " list patterns to `<ol>`/`<ul>`
  - `formatStepContent()`: same for test step Action/Expected Result
- **Persona sub-bullets:** TPM Roles, Profile, PSG now render as nested `<ul><li>` under each persona.
- **TO BE TESTED FOR / Pre-requisite:** Items containing " • " or "; " are split into separate list items (fixes single-line display).
- **Tables:** Reverted to lists (`<ol>`, `<ul>`). Added `docs/prerequisite-field-table-compatibility.md` for field compatibility and future table format.

## 2026-02-26 — Revert Tables to Lists; Table Compatibility Doc

### Reverted: Pre-requisite and TO BE TESTED FOR to Lists

- **Change:** Restored `<ol>` and `<ul>` rendering (bullets) instead of HTML tables. Tables were not rendering well in ADO.
- **New doc:** `docs/prerequisite-field-table-compatibility.md` — documents field table compatibility and tc_draft JSON format for future table support.

---

## 2026-02-26 — Formatting Fixes: Parser, <br> Normalization, Repush

### Parser Fixes (tc-draft-parser.ts)

- **Pre-requisite vs TO BE TESTED FOR:** Parser now extracts each section separately. Previously, `preConditions` incorrectly included rows from the TO BE TESTED FOR table.
- **TO BE TESTED FOR rows:** Parser now extracts ALL rows from the TO BE TESTED FOR table (previously only the first row was parsed).

### formatContentForHtml — Literal <br> Normalization

- **Problem:** When draft content had literal `<br>` (e.g. "A. X<br>B. Y"), it displayed as raw text in ADO.
- **Fix:** Normalize `<br>` and `<br/>` to newlines before processing, so `convertListPatterns` can detect and convert "A./B." to proper lists. Same behavior as `formatStepContent`.

### Repush Support (push_tc_draft_to_ado)

- **New parameter:** `repush: true` — When draft is APPROVED and user revised it, call with `repush: true` to **update** existing test cases instead of creating new ones.
- **Flow:** Parses draft → for each TC with `adoWorkItemId`, calls `updateTestCaseFromParams` (applies full formatting) → no new work items created.
- **Benefit:** Revise draft, run create_test_cases with repush → formatting applied every time.

### expandListItems — Don't Split on Semicolons Inside Parentheses

- **Problem:** "LOA thresholds configured per Sales Org (e.g., L1 0-25,000; L2 25,001-50,000; L3 50,001-250,000)" was split into 3 items because of semicolons.
- **Fix:** `splitListItemSafely` only splits on " • " or "; " when outside parentheses/brackets. Semicolons inside "(e.g., ...)" stay as one item.
- **Files:** `src/helpers/format-html.ts`, `src/helpers/prerequisites.ts`, `src/helpers/steps-builder.ts`, docs

---

## 2025-02-25 — Draft Test Cases QA Architect Skill

### New Skill: draft-test-cases-salesforce-tpm

- **Location:** `.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md`
- **Purpose:** QA architect methodology for drafting test cases from User Story + Confluence Solution Design
- **Steps:** Analyze US (extract functional behavior, field updates, status transitions, config dependency, etc.); use Confluence SD (extract business rules, config variables, conditional flows; ignore code/implementation); validate coverage matrix (market variations, trigger fields, status scenarios, config logics, backward compatibility); add Functionality Process Flow and Test Coverage Insights at draft start; generate complete test cases
- **Reference:** `config-summary-examples.md` for Pre-requisite config summary templates

### Draft Structure Enhancements

- **save_tc_draft:** Optional `functionalityProcessFlow` (mermaid/process diagram) and `testCoverageInsights` (classified coverage scenarios with auto-computed summary) added at draft start
- **Prompts:** `draft_test_cases` and `create_test_cases` (when creating draft) now reference the QA architect skill
- **Files:** `src/helpers/tc-draft-formatter.ts`, `src/helpers/tc-draft-parser.ts`, `src/tools/tc-drafts.ts`, `src/prompts/index.ts`

---

## 2025-02-25 — Prerequisite Format (Match ADO Manual Format)

### HTML Formatting

- **Persona, Pre-requisite, TO BE TESTED FOR, Test Data:** Use `<br>` (not `<br/>`) for line breaks. Add space after colon in section labels: `<strong>Persona:</strong> </div>`.
- **Reference:** Test suite 1314422, TC 1314399 (manually formatted by user).
- **File:** `src/helpers/prerequisites.ts`, `docs/prerequisite-formatting-instruction.md`

### Pre-condition Content Rules

- **Bracket hints:** Support `[Config should be setup/available]` and `[Config should be setup]` in prerequisites.
- **Narrative-style:** Allow narrative when describing scenario setup (e.g. "Tactic Template without X config OR Tactic for which no mapping exists").
- **File:** `conventions.config.json`, `src/prompts/index.ts`, `docs/test-case-writing-style-reference.md`

---

## 2025-02-25 — Drafted By + Deferred JSON

### Drafted By (OS Username)

- **Header field:** `save_tc_draft` now adds **Drafted By** to the markdown header table using the system username (macOS: `os.userInfo().username` or `USER`; Windows: `USERNAME`).
- **File:** `src/helpers/system-username.ts`, `src/helpers/tc-draft-formatter.ts`

### Deferred JSON Until Push

- **save_tc_draft:** Writes only `.md`; no JSON until push. Avoids JSON drift during multiple revisions.
- **list_tc_drafts:** Lists `.md` files; parses header for US ID, title, status, version.
- **get_tc_draft:** Returns markdown only; no version-sync validation (no JSON).
- **push_tc_draft_to_ado:** Reads `.md` only, parses via `parseTcDraftFromMarkdown`, creates TCs in ADO, then generates JSON with correct mappings for audit/reference.
- **File:** `src/helpers/tc-draft-parser.ts`, `src/tools/tc-drafts.ts`

---

## 2025-02-25 — TC Draft Storage (No Hardcoded Path)

### User Chooses Where Drafts Are Stored

- **No hardcoded default path** — Removed `~/.ado-testforge-mcp/tc-drafts` as default.
- **workspaceRoot:** When user has a folder open, drafts go to `workspaceRoot/tc-drafts/` (created if missing).
- **draftsPath:** When user specifies a location ("save to X", "create under folder Y"), use this exact path.
- **tc_drafts_path / TC_DRAFTS_PATH:** Optional user config; no longer a fallback to homedir.
- **Tools updated:** All four tc-draft tools accept `workspaceRoot` and `draftsPath`. If neither is provided and no config is set, tools return a clear error asking the user to open a folder or specify location.

### Version Sync Validation (Option C)

- **get_tc_draft:** If .md and .json versions differ, appends a warning and suggests calling `save_tc_draft` to sync.
- **push_tc_draft_to_ado:** Rejects with error if .md and .json versions differ; user must call `save_tc_draft` first.
- **save_tc_draft:** Always writes both .md and .json in sync (unchanged).

---

## 2025-02-25 — Deployment: Prerequisites, Tools, Title Limit, Styling

### Commands Added

#### `delete_test_cases`

- **File:** `src/prompts/index.ts`
- **Purpose:** Delete multiple test cases by ID. Asks for comma-separated or list of IDs, confirms, warns about Recycle Bin (restorable within 30 days), calls `delete_test_case` for each, reports success/failure per ID.

---

## 2025-02-25 — Deployment: Prerequisites, Tools, Title Limit, Styling (continued)

### Code Fixes

#### Prerequisites HTML (ADO-Compatible)

- **File:** `src/helpers/prerequisites.ts`
- **Change:** Replaced `<b>` and `<br/>` with ADO-compatible HTML structure.
- **Details:**
  - **Persona:** `<div><strong>Persona:</strong></div><ul><li>...</li></ul>`
  - **Pre-requisite:** `<div><strong>Pre-requisite:</strong></div><ol><li>...</li></ol>`
  - **TO BE TESTED FOR:** `<div><strong>TO BE TESTED FOR:</strong></div><ul><li>...</li></ul>`
  - **Test Data:** `<div><strong>Test Data:</strong></div><div>N/A</div>`
- **Reference:** `docs/prerequisite-formatting-instruction.md`

---

### Tool Enhancements

#### `update_test_case`

- **File:** `src/tools/test-cases.ts`
- **New parameters:**
  - `prerequisites` — Structured object `{ personas, preConditions, toBeTested, testData }`; when provided, call `buildPrerequisitesHtml()` and write to `prerequisiteFieldRef`
  - `areaPath` — Updated area path
  - `iterationPath` — Updated iteration path
- **Behavior:** Accepts either `description` (raw HTML) or `prerequisites` (structured). When both are omitted, no prerequisite update is applied.

---

### New Tools (Already Present)

- **`list_work_item_fields`** — List all work item field definitions (reference names, types, readOnly). Optional `expand` param for extension fields.
- **`delete_test_case`** — Delete a test case by ID. Default: move to Recycle Bin. Use `destroy=true` for permanent delete (not recommended).

---

### Commands (Prompts)

| Command | Change |
|---------|--------|
| `update_test_case` | Prompt now mentions: title, description/prerequisites, steps, priority, state, assignedTo, areaPath, iterationPath |
| `delete_test_case` | Prompt now requires confirmation before delete; warns when `destroy=true` is requested |

---

### Rules

#### `.cursor/rules/test-case-draft-formatting.mdc`

- **Globs:** `tc-drafts/**/*.md`, `tc-drafts/**/*.json`
- **Contents:**
  - Draft rules: use workspaceRoot, sync before push, use latest version, numbered lists with `<br>`
  - Prerequisite formatting: ADO-compatible HTML, reference to instruction doc
  - Title limit: ≤ 256 characters
  - Expected result: "should" form
  - Steps format: imperative, `<br>` for numbered lists
  - Reference: `docs/test-case-writing-style-reference.md`

---

### Documentation Added

| File | Purpose |
|------|---------|
| `docs/prerequisite-formatting-instruction.md` | Full instruction for Prerequisite for Test HTML (tags, structure, escaping, troubleshooting) |
| `docs/prerequisite-formatting-ado.md` | User summary for when formatting does not render |
| `docs/test-case-writing-style-reference.md` | Title format, "should" form, steps format, pre-requisite format, admin validation |

---

### Config Changes

#### `conventions.config.json`

- **Added:** `testCaseTitle.maxLength: 256`
- **Purpose:** ADO Work Item Title has a 256-character limit. Titles exceeding this are truncated with ellipsis.

---

### Title Limit & Styling

#### `buildTcTitle` (`src/helpers/tc-title-builder.ts`)

- **Change:** Truncates titles exceeding `maxLength` (default 256) with ellipsis.
- **Config:** Uses `testCaseTitle.maxLength` from conventions.config.json.

#### `draft_test_cases` Prompt

- **Added styling rules:**
  - Ensure all test case titles are ≤ 256 characters.
  - Use "should" form for all expected results (e.g., "you should be able to do so", "X should be updated").
  - Use `<br>` between numbered items in steps/expected results (e.g., "Fields to validate:<br>1. X<br>2. Y").

---

### Implementation Updates

- **`docs/implementation.md`** — Updated Title Convention (256 limit), Prerequisites Section (ADO HTML), Prerequisites Formatter (div/strong/ul/ol/li), references to new docs.
- **`docs/tc-style-guide-and-consistency-strategy.md`** — Added reference to prerequisite formatting docs.

---

### Documentation Added (continued)

| File | Purpose |
|------|---------|
| `docs/repush-workflow.md` | Re-push workflow: delete existing TCs, then push revised draft |
| `README.md` | Project root quick start, main commands, doc links |

### Setup Guide Updates

- **Post-Setup Verification** — Verify 21 tools, delete_test_cases, update_test_case, list_work_item_fields, title limit
- **Rules for tc-drafts** — How to copy test-case-draft-formatting.mdc to a separate workspace; multi-root option

---

### Post-Deployment Checklist

1. **Rebuild** — `npm run build`
2. **Restart MCP** — Restart Cursor or reload ado-testforge in Settings → MCP
3. **Verify tools** — `list_work_item_fields`, `delete_test_case`, `update_test_case` (with prerequisites, areaPath, iterationPath)
4. **Verify commands** — `/ado-testforge/update_test_case`, `/ado-testforge/list_work_item_fields`, `/ado-testforge/delete_test_case`
5. **Verify prerequisite formatting** — Update a test case; confirm HTML renders in ADO
6. **Verify title limit** — Draft a TC with long title; confirm truncation works
