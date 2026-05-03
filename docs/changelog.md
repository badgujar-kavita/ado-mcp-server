# Changelog

All notable changes to the ADO TestForge MCP server are documented here.

---

## 2026-05-03 — Full-context work-item payload + embedded image support

### Feature

`get_user_story` now returns a richer UserStoryContext so draft generation can incorporate every populated custom field, every linked Confluence page, and (optionally) the actual pixel contents of ADO / Confluence attachments.

**New response fields** (all additive; pre-existing fields preserved):

- `namedFields: Record<ref, { label, html, plainText }>` — primary rich-text fields (Title, Description, AcceptanceCriteria, Solution Notes + any `additionalContextFields` configured in conventions.config.json, e.g. `Custom.ImpactAssessment`, `Custom.ReferenceDocumentation`).
- `allFields: Record<ref, unknown>` — every populated ADO field on the work item, system-noise filtered by default (28 bookkeeping fields dropped: `ChangedDate`, `Watermark`, `BoardColumn`, etc.). Teams can extend the filter via `allFields.omitExtraRefs` or disable via `allFields.passThrough: false`.
- `fetchedConfluencePages: FetchedConfluencePage[]` — EVERY Confluence link found in any scanned field is fetched (not just the first). Each page entry includes `{ pageId, title, url, body, sourceField, images }` and contributes to a combined image cap.
- `unfetchedLinks: UnfetchedLink[]` — SharePoint, Figma, LucidChart, GoogleDrive, cross-instance Confluence, auth-failed, link-budget, and time-budget links are all surfaced with `{ url, type, sourceField, reason, workaround }` so the agent can tell the user to paste content manually before drafting.
- `embeddedImages: EmbeddedImage[]` — `<img>` tags in rich-text fields are parsed, resolved to ADO attachment URLs, fetched via PAT, size-guarded, and surfaced with full metadata (`{ source, sourceField, originalUrl, filename, mimeType, bytes, altText, skipped? }`). The same pipeline runs on Confluence page `<ac:image>` / `<img>` refs (`fetchedConfluencePages[].images`).

**New MCP image content parts** (ship-dark, opt-in):

When `images.returnMcpImageParts: true` is set in `conventions.config.json`, `get_user_story` returns the actual image bytes as MCP image content parts alongside the text JSON — Cursor, Claude Desktop, and other vision-capable MCP clients render them as vision input so the agent can see wireframes, screenshots, and diagrams directly. Default is `false` so the existing response shape is unchanged until teams opt in. A `maxTotalBytesPerResponse` cap (default 4 MiB) protects the Claude context window; overflowed images are marked `skipped: "response-budget"` with `originalUrl` still clickable.

**Prompt + skill updates:**

- `draft_test_cases` step 2a: swapped the old "description / AC / Solution Design content" terminology for "primary inputs are `namedFields[*].plainText` and `fetchedConfluencePages[].body`." Legacy top-level fields remain equivalent.
- `draft_test_cases` steps 2d + 2e (new): documents how to consume every new payload field, and mandates surfacing `unfetchedLinks` to the user BEFORE generating a draft (safety rule).
- `create_test_cases` step 3: cross-references 2d–2e so the no-draft branch follows the same consumption rules.
- `clone_and_enhance_test_cases` step 4: same cross-reference.
- `get_user_story` slash command: now asks the agent to produce a structured 6-section summary (primary / namedFields / Confluence pages / images / unfetchedLinks / allFields).
- `draft-test-cases-salesforce-tpm/SKILL.md`: new "Context Inputs" section documenting the priority order (namedFields → fetchedConfluencePages → images → allFields → unfetchedLinks) with concrete test-design-relevant signals per field.
- `test-case-asset-manager/SKILL.md`: new "Optional: attachments/ subfolder" section describing the on-disk layout when `images.saveLocally: true` is enabled.

### Configuration (new blocks in conventions.config.json)

- `additionalContextFields: []` — additional custom fields beyond the primary allowlist that should be surfaced as `namedFields`. Each entry is `{ adoFieldRef, label, fetchLinks, fetchImages }`. Seeded defaults point at `Custom.ImpactAssessment` and `Custom.ReferenceDocumentation` — override per project as needed.
- `allFields: { passThrough, omitSystemNoise, omitExtraRefs }` — controls the `allFields` pass-through behavior.
- `images: { enabled, maxPerUserStory (20), maxBytesPerImage (2 MiB), maxTotalBytesPerResponse (4 MiB), minBytesToKeep (4 KiB), downscaleLongSidePx (1600), downscaleQuality (85), mimeAllowlist, inlineSvgAsText, returnMcpImageParts (false — ship-dark), saveLocally (false), savePathTemplate }` — all image guardrails.
- `context: { maxConfluencePagesPerUserStory (10), maxTotalFetchSeconds (45) }` — budgets so pathological work items don't stall the tool call.

### Bug fixes along the way

- ADO attachment URLs with the project GUID (instead of project name) in the path now fetch correctly. Previously produced a double-project URL and 404'd.
- Confluence `listAttachments` and `fetchAttachmentBinary` now retry via `api.atlassian.com` on 401 (same fallback that `getPageContent` already had). Scoped tokens that couldn't fetch attachments now work. Note: binary download additionally requires `read:attachment.download:confluence` scope on the API token — if missing, images surface as `skipped: "fetch-failed"` rather than being silently dropped.
- Distribution bundle externalizes `jimp` and `node-html-parser` so `gifwrap`'s `require("fs")` doesn't break the ESM bundle at startup. `dist-package/package.json` declares these deps; the installer runs `npm install` to resolve them at install time.

### Files Updated

- **New helpers:** `src/helpers/basic-auth.ts`, `src/helpers/strip-html.ts`, `src/helpers/ado-attachments.ts`, `src/helpers/confluence-attachments.ts`, `src/helpers/image-downscale.ts`
- **Extended:** `src/types.ts`, `src/config.ts`, `conventions.config.json`, `src/ado-client.ts` (`getBinary()`), `src/confluence-client.ts` (`listAttachments`, `fetchAttachmentBinary`, `getPageContentRaw`, 401→api.atlassian.com fallback), `src/helpers/confluence-url.ts` (`extractAllLinks`, `categorizeLink`, `extractConfluencePageIdFromUrl`), `src/tools/work-items.ts` (`extractUserStoryContext` rewrite, `buildGetUserStoryResponse` packing), `src/prompts/index.ts`, `.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md`, `.cursor/skills/test-case-asset-manager/SKILL.md`, `build-dist.mjs`, `package.json` (+jimp, +node-html-parser).
- **Tests:** ~110 new `node:test` unit tests covering link extraction, binary fetch, attachment parsing, downscale, guardrails, response-budget packing, 401 fallbacks, and the full context build.

### Backward Compatibility

- Every pre-existing `UserStoryContext` field preserved (`title`, `description`, `acceptanceCriteria`, `areaPath`, `iterationPath`, `state`, `parentId`, `parentTitle`, `relations`).
- `solutionDesignUrl` and `solutionDesignContent` kept as deprecated aliases; populated from the FIRST fetched Confluence page so legacy consumers continue to work.
- `get_user_story` response shape stays `[text]` by default (`returnMcpImageParts: false`). Flip in config to get `[text, image, image, …]`.
- New config blocks are all optional; absence restores pre-refactor behavior.

---

## 2026-05-03 — Removed Google Drive distribution path

### Change

- Distribution is now exclusively via Vercel tarball (see `docs/distribution-guide.md`). The Google Drive deploy path has been retired.
- `deploy.mjs` and `.deploy-path` files removed; `GDRIVE_DEPLOY_PATH` is no longer read anywhere.
- `bin/bootstrap.mjs`'s `checkGoogleDrive()` check removed — no more warnings about a missing Google Drive desktop app.
- All plan and rule references to Google Drive as a distribution target have been cleaned up. (Google Drive remains a supported **external-link type** for links pasted into work items — that is unrelated to distribution.)

---

## 2026-05-03 — Clickable ADO Work Item Links in Tool Responses

### Feature

Tool responses now include browsable ADO URLs (`https://dev.azure.com/{org}/{project}/_workitems/edit/{id}`) so the agent can render clickable links in chat instead of bare `ADO #1234` text.

- **New `src/helpers/ado-urls.ts`** — `adoWorkItemUrl(adoClient, id)` helper. Reuses the `AdoClient.baseUrl` already constructed in the constructor; no duplication.
- **`push_tc_draft_to_ado` success message** — TC→ADO mappings now render as markdown links: `TC_1363736_01 → [ADO #1386085](https://dev.azure.com/.../_workitems/edit/1386085)`.
- **`get_tc_draft`** — when the draft has ADO IDs, appends a new **"## ADO Links (agent display — not persisted)"** section to the returned text with clickable links for the User Story and each TC. The file on disk is **untouched** — this is a response-level convenience so the agent has URLs to build tables/summaries from.
- **`list_test_cases_linked_to_user_story`** — response now includes `testCases: [{id, webUrl}]` and `userStoryWebUrl` **alongside** the existing `testCaseIds` field (kept for backward compatibility with the clone-and-enhance flow and any other consumers).
- **`get_test_case`** — adds `webUrl` field to the response (distinct from ADO's native `url` field which is the API endpoint).
- **`get_user_story`** — adds `webUrl` field to the response.
- **`create_test_cases` prompt** — new step (9) instructs the agent to use `webUrl` fields when rendering ADO IDs in chat, and to surface `get_tc_draft`'s "ADO Links" section in draft summaries.

### Why This Shape

The draft markdown on disk is a **round-trip format** — the formatter writes it, the parser reads it back on push/repush. Embedding markdown-link syntax in the persisted draft (e.g. `(ADO #1234)` → `([ADO #1234](url))`) would break the parser's `/\(ADO #(\d+)\)/` regex and cause `repush: true` to fail on every revised draft. Instead, URLs are added only at **response time**: tool output gets URLs, disk content stays in the shape the parser expects. No migration, no backward-compat regex work, no risk to existing drafts.

### Files Updated

- **New:** `src/helpers/ado-urls.ts`
- `src/tools/tc-drafts.ts` — push summary uses markdown links; `get_tc_draft` appends ADO Links section.
- `src/tools/work-items.ts` — `get_user_story` + `list_test_cases_linked_to_user_story` responses include `webUrl`.
- `src/tools/test-cases.ts` — `get_test_case` response includes `webUrl`.
- `src/prompts/index.ts` — agent instruction to use `webUrl` when rendering ADO IDs.

### Backward Compatibility

- `list_test_cases_linked_to_user_story` response keeps `testCaseIds: number[]` alongside the new `testCases` and `userStoryWebUrl` fields. Clone-and-enhance flow unaffected.
- `AdoWorkItem.url` (the native ADO API URL) is preserved in `get_test_case`; the new browsable URL is on a separate `webUrl` field to avoid clobbering.
- Draft markdown format unchanged. Parser unchanged. Old drafts still work.
- `get_tc_draft` output contains all previous content verbatim; new section is **appended** at the end, not injected.

---

## 2026-05-03 — Duplicate Test Case Preflight on Push

### Feature

- **`push_tc_draft_to_ado` now runs a preflight check for existing linked test cases.** When the User Story already has test cases linked via `Microsoft.VSTS.Common.TestedBy` and the draft has no ADO IDs, the tool aborts the insert and returns a counts-based risk message (no listing dump) with three lettered options: **A.** proceed with `insertAnyway: true`, **B.** inspect existing TCs first via `list_test_cases_linked_to_user_story` + `get_test_case`, **C.** cancel. Prevents accidental duplicate creation when a draft is regenerated after a previous push, when TCs were created manually/elsewhere, or when pushing from a different workspace.
- **Counts, not dumps.** The preflight message shows only the count of existing TCs + count of new ones that would be created + a duplicate-risk warning. Full titles/steps are available on demand via the existing investigative tools if the user picks option B. Clean separation: publish prompts are operational, `list_test_cases_linked_to_user_story` + `get_test_case` are investigative.
- **Silent happy path.** If the US has zero linked TCs, the preflight is invisible — push proceeds as before.
- **Network-failure honesty.** If the ADO relations call fails (timeout, 500, etc.), the tool surfaces the error and asks the user to either cancel or pass `insertAnyway: true` if they're confident. Never silently proceeds past a failed check.
- **New `insertAnyway: boolean` parameter** — explicit override. Set `true` only after the user has seen the A/B/C prompt and replied **A**. Default `false`.
- **`create_test_cases` prompt updated** — new step (6) instructs the agent to surface the preflight message verbatim (no re-formatting, no listing), wait for the user's A/B/C reply, and only pass `insertAnyway: true` on A.

### Files Updated

- `src/tools/tc-drafts.ts` — Added `fetchLinkedTestCaseIds()` helper (resolves TestedBy relations on the US); added preflight branch before the insert loop; added `insertAnyway` parameter.
- `src/prompts/index.ts` — Updated `create_test_cases` prompt flow to handle the new preflight response (counts-based, lettered-options).

### Behavior Matrix

| Draft state | Draft has ADO IDs | US has linked TCs in ADO | `repush` | `insertAnyway` | Outcome |
|---|---|---|---|---|---|
| PENDING | no | no | — | — | Insert new TCs (unchanged) |
| PENDING | no | yes | — | false | **Blocked** — list returned; user chooses |
| PENDING | no | yes | — | true | Insert new TCs alongside existing |
| APPROVED | yes | — | true | — | Update existing TCs (unchanged) |
| APPROVED | no | — | true | — | Blocked — repush requires ADO IDs (unchanged) |

### Backward Compatibility

- Existing callers who pass only `userStoryId` / `workspaceRoot` / `draftsPath` / `repush` work identically when the US has no linked TCs in ADO.
- When linked TCs exist on a US being pushed for the first time from a draft, the call now returns `isError: true` with the listing instead of creating duplicates. Callers that want the old behavior can set `insertAnyway: true`.

---

## 2026-04-29 — Per-US Folder Structure for Test Case Drafts

### Feature

- **Drafts now organized per User Story** — Test case drafts are saved in `tc-drafts/US_<id>/` subfolders instead of flat files
- **New `save_tc_supporting_doc` tool** — Save supporting documents (solution_design_summary, qa_cheat_sheet, regression_tests) to the same US folder
- **Auto-generated Supporting Documents links** — Main test cases file includes relative links to solution_design_summary and qa_cheat_sheet
- **Backward-compatible readers** — `get_tc_draft`, `list_tc_drafts`, and `push_tc_draft_to_ado` support both new subfolder layout and legacy flat layout

### Files Updated

- **Tools:**
  - `src/tools/tc-drafts.ts` — Updated `save_tc_draft` to create per-US subfolders, added `save_tc_supporting_doc` tool, updated all read tools for backward compatibility
  
- **Formatter/Parser:**
  - `src/helpers/tc-draft-formatter.ts` — Added "Supporting Documents" section with relative links after metadata
  - `src/helpers/tc-draft-parser.ts` — Made header parsing robust against new sections by anchoring to first H2

- **Prompts:**
  - `src/prompts/index.ts` — Updated `draft_test_cases` and `create_test_cases` to use `save_tc_supporting_doc` for supporting documents

- **Documentation:**
  - `docs/implementation.md` — Documented new folder structure and `save_tc_supporting_doc` tool
  - `docs/testing-guide.md` — Updated tool quick reference
  - `.cursor/rules/test-case-draft-formatting.mdc` — Updated rule 1 wording for new folder structure

### Folder Structure

```
tc-drafts/
└── US_1399001/
    ├── US_1399001_test_cases.md          (main draft, ADO push source)
    ├── US_1399001_solution_design_summary.md  (business logic reference)
    ├── US_1399001_qa_cheat_sheet.md      (execution aid)
    └── US_1399001_test_cases.json        (generated on push)
```

### Backward Compatibility

- Legacy flat drafts (`tc-drafts/US_<id>_test_cases.md`) are still readable and pushable
- `list_tc_drafts` shows both layouts with `(legacy flat)` suffix for old files
- New drafts always use the subfolder structure

---

## 2026-04-27 — Added toBeTested Field to conventions.config.json

### Bug Fix

- **Fixed MCP server crash on initialization** — Added missing `toBeTested` field to `prerequisiteDefaults` in `conventions.config.json`, schema validation, and TypeScript types
- **Root cause:** Cursor's MCP validation requires this field to be present in the config structure
- **Error reported:** "ado-testforge is crashing because your MCP package's config is missing a required field: prerequisiteDefaults.toBeTested"

### Files Updated

- **Configuration:**
  - `conventions.config.json` — Added `"toBeTested": null` to `prerequisiteDefaults` (line 83)
  
- **Schema & Types:**
  - `src/config.ts` — Added `toBeTested: z.union([z.null(), z.array(z.string())])` to prerequisiteDefaults schema validation
  - `src/types.ts` — Added `toBeTested: null | string[]` to `ConventionsConfig.prerequisiteDefaults` interface

- **Documentation:**
  - `docs/implementation.md` — Updated prerequisiteDefaults example to include `"toBeTested": null`
  - `docs/changelog.md` — Documented this fix

### Impact

- **MCP server now initializes successfully** without crashing
- The field is present in config, schema validation, and type definitions for consistency
- The field is not actively used by the codebase logic (no rendering or processing)
- Users can now toggle ado-testforge on/off without errors
- All deployed files updated via `npm run deploy`

---

## 2026-04-24 — Complete toBeTested Field Removal (Schema Fix)

### Critical Bug Fix

- **Fixed ZodError on server startup** — The schema validation in `src/config.ts` was still requiring `toBeTested` field even though it was removed from the codebase on 2026-04-15
- **Root cause:** The 2026-04-15 removal was incomplete; the Zod schema and several TypeScript interfaces were not updated, causing validation failures

### Files Updated

- **Schema & Types:**
  - `src/config.ts` — Removed `toBeTested: z.array(z.string()).nullable()` from prerequisiteDefaults schema
  - `src/types.ts` — Removed `toBeTested` from `Prerequisites` interface and `ConventionsConfig.prerequisiteDefaults`

- **Tool Schemas:**
  - `src/tools/tc-drafts.ts` — Removed `toBeTested` from `PrerequisitesSchema` and `mergePrerequisites()` logic
  - `src/tools/test-cases.ts` — Removed `toBeTested` from `PrerequisitesSchema` and `CreateTestCaseParams` interface

- **Helper Logic:**
  - `src/helpers/tc-draft-formatter.ts` — Removed entire TO BE TESTED FOR section rendering (lines 182-193), removed from TypeScript interfaces
  - `src/helpers/tc-draft-parser.ts` — Removed TO BE TESTED FOR parsing logic (18 lines of parsing code)
  - `src/helpers/prerequisites.ts` — Removed `toBeTested` case from `renderSection()` switch statement

- **Configuration:**
  - `conventions.config.json` — Removed `"toBeTested": null` from prerequisiteDefaults (also reformatted file for readability)

- **Documentation:**
  - `docs/changelog.md` — Updated 2026-04-15 entry to list all files that should have been changed
  - `docs/implementation.md` — Removed `toBeTested` from config examples and prerequisite structure examples
  - `docs/ado-test-case-update-guide.md` — Changed structured prerequisites format from `{ personas?, preConditions, toBeTested, testData }` to `{ personas?, preConditions, testData }`
  - `docs/test-case-writing-style-reference.md` — Updated prerequisite field description
  - `docs/prerequisite-field-table-compatibility.md` — Removed `toBeTested` from all JSON examples and table format proposals
  - `.cursor/skills/update-test-case-prerequisites/SKILL.md` — Updated structure definition and removed from example

### Impact

- **Server now starts successfully** — No more ZodError on startup
- **Prerequisites simplified** — Only Persona, Pre-requisite, and Test Data sections remain
- **Breaking change for drafts created before 2026-04-15** — Old drafts with `toBeTested` will have that field ignored during parsing

---

## v1.1.0 — 2026-04-24 — State-Aware Welcome and Status Updates

- Added first-run detection via `~/.ado-testforge-mcp/.ado-testforge-initialized` so `check_status` shows the full welcome only once per version.
- Added state-aware status output with distinct first-run, returning-user, setup-incomplete, and version-update experiences.
- Added version-aware update summaries in `check_status`, driven by the current package version and top changelog highlights.
- Changed `get_user_story` so Confluence fetch failures are silently skipped and return `solutionDesignContent = null` instead of leaking warning text into the ADO workflow.
- Added deployment backups and rollback notes so `npm run deploy` preserves the previously deployed build before overwrite.

---

## 2026-04-15 — Automation-Friendly Expected Result Patterns

### Enhanced Expected Result Formatting for Automation

- **Structured patterns:** Expected results now follow automation-friendly patterns:
  - `Object.Field should = Value` (field validation)
  - `UI_Element should be state` (UI element validation)
  - `Action should outcome` (action outcome validation)
  - `Message should [not] be displayed` (message/error validation)
  - `Rule Order N: condition → outcome should happen` (rule logic)
- **Automation mapping examples:** Each pattern category includes pseudocode showing how test case text translates to automation assertions
- **Five pattern categories:** Field Validation, UI Element Validation, Ordered Logic/Rules, Access Control, Negative Test Cases
- **Eliminated vague language:** Strict rules against "should work properly", "appropriate access", "should be correct"
- **Writing style rules:** Specific targets, clear operators (=, !=, CONTAINS, IN), measurable states (enabled, disabled, visible), deterministic outcomes (succeed, fail, be assigned)
- **New documentation:** `docs/automation-friendly-test-patterns.md` — comprehensive quick reference guide with:
  - Pattern categories with automation pseudocode mappings
  - Operator, state, and outcome reference tables
  - Decision tree for format selection
  - Bad vs good examples
- **Files updated:** `.cursor/skills/test-case-asset-manager/SKILL.md`, `.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md`, `src/prompts/index.ts`, `.cursor/rules/test-case-draft-formatting.mdc`, `docs/test-case-writing-style-reference.md`, templates

---

## 2026-04-15 — Test Case Asset Management & Folder Structure

### Test Case Asset Manager Skill

- **New skill:** `.cursor/skills/test-case-asset-manager/SKILL.md` — orchestrates folder structure and file organization for test case documentation
- **Folder structure:** Enforces `tc-drafts/US_<ID>/` convention for organizing test case documentation
- **Three-file structure per US:**
  - `US_<ID>_test_cases.md` — Main test case draft with Supporting Documents links
  - `US_<ID>_solution_design_summary.md` — 11-section solution summary
  - `US_<ID>_qa_cheat_sheet.md` — Scannable QA quick reference (40-60 lines max)
- **Enhanced templates:** Four new templates created:
  - `test_cases.template.md` — Test case draft structure with links to supporting documents
  - `solution_summary.template.md` — 11-section structured solution summary
  - `qa_cheat_sheet.template.md` — Decision logic tables, quick maps, setup checklist, debug order
  - `cheat_sheet_review_guide.md` — Review guide for QA cheat sheet quality

### Solution Summary Structure (11 Sections)

1. Purpose & Scope
2. Business Process Overview
3. Decision Logic & Conditional Flows
4. Key Solution Decisions
5. Fields and Configuration (New Custom Fields + New Configurations tables)
6. Setup Prerequisites (Compact Format — table with max 10 rows)
7. Behavior by Scenario
8. QA Impact & Risk Areas
9. Risk Areas & Edge Cases
10. Open Questions / Clarifications Needed
11. QA Reuse Notes
- **Executive QA Snapshot** at the top for quick reference

### QA Cheat Sheet Design Principles

- **Brevity enforced:** Target 40-60 lines max
- **Decision Logic TABLE:** Use Case | Config/Field Values | Conditions | Expected Outcome
- **Quick Maps:** Field/Value Mappings, Category/Type Source (tables, not prose)
- **Setup Checklist:** Max 5 items, no nested bullets
- **Debug Order:** Single list, 6 steps max
- **Regression Triggers:** Table format only
- **Removed redundancies:** No separate Positive/Negative Validations sections

### Prerequisite Writing Standard (MANDATORY Condition-Based Format)

- **Required patterns:**
  - `Object.Field = Value`
  - `Object.Field != NULL`
  - `Object.Field = TRUE/FALSE`
  - `Object.Field CONTAINS Value`
  - `Object.Field IN (Values)`
  - `CustomLabel = Value`
  - `CustomMetadataType.Field = Value`
  - `CustomSetting.Field = Value`
- **Consolidated object types:** Removed semantic variants (ConfigurationObject, TargetObject, AccessObject) — use generic `Object.Field = Value`
- **Vague phrasing softened:** Changed from "NEVER use vague phrasing" to "use only as last resort" when condition-based format is not expressible
- **Fallback:** Minimal vague language (e.g., "Setup or configuration is required") allowed only when specific condition cannot be expressed

### Artifact Cleanliness Standards

All three artifacts (test cases, solution summary, cheat sheet) must be:
1. **Scannable** — QA should understand content in under 2 minutes
2. **Consistent** — Same terminology, same prerequisite format across all files
3. **Minimal** — No filler text, no redundant sections, no over-explanation
4. **Table-first** — Use tables for conditional logic, mappings, decision rules
5. **Technical-precise** — Condition-based prerequisites; vague language only as last resort
6. **Self-contained** — Each artifact stands alone but references others appropriately

### Accuracy Rules

- **Source material only:** User Story / Acceptance Criteria, Confluence Solution Design, Approved documentation, Supporting files (images, Excel, Google Sheets, CSV, PDF), Explicit user clarification
- **No invention:** Do not invent requirements, scope, logic, conditions, or assumptions
- **Partial coverage:** If source only supports part of story scope, state clearly in supporting documents
- **Terminology conflicts:** Prefer latest explicit user clarification

### Integration with Drafting Commands

- **`draft_test_cases` and `create_test_cases` prompts updated:** Now explicitly instruct AI to:
  - Create `tc-drafts/US_<ID>/` folder structure
  - Generate all three files (test cases, solution summary, QA cheat sheet)
  - Apply both skills: `test-case-asset-manager` for folder structure + `draft-test-cases-salesforce-tpm` for content quality
  - Use save_tc_draft for main file, create supporting documents separately
- **Formatting rule updated:** `.cursor/rules/test-case-draft-formatting.mdc` Section 11 references new folder convention

### Files Changed

- **New skill:** `.cursor/skills/test-case-asset-manager/SKILL.md`
- **New templates:** `.cursor/skills/test-case-asset-manager/templates/` (4 files)
- **Updated:** `src/prompts/index.ts`, `.cursor/rules/test-case-draft-formatting.mdc`

---

## 2026-04-15 — Removed TO BE TESTED FOR Section

### Prerequisite Section Simplification

- **TO BE TESTED FOR section permanently removed** from test case drafts due to verbosity and clutter
- **Files updated:**
  - `conventions.config.json` — Removed `toBeTested` from prerequisiteDefaults
  - `src/config.ts` — Removed `toBeTested` from schema validation
  - `src/types.ts` — Removed `toBeTested` from Prerequisites and ConventionsConfig interfaces
  - `src/tools/tc-drafts.ts` — Removed `toBeTested` from PrerequisitesSchema and merge logic
  - `src/tools/test-cases.ts` — Removed `toBeTested` from PrerequisitesSchema and interface
  - `src/helpers/tc-draft-formatter.ts` — Removed TO BE TESTED FOR section rendering
  - `src/helpers/tc-draft-parser.ts` — Removed TO BE TESTED FOR parsing logic
  - `src/helpers/prerequisites.ts` — Removed `toBeTested` case from renderSection
  - `docs/implementation.md` — Removed `toBeTested` references from examples
  - `.cursor/skills/test-case-asset-manager/templates/test_cases.template.md` — Removed TO BE TESTED FOR row
  - `.cursor/rules/test-case-draft-formatting.mdc` — Updated description to remove TO BE TESTED FOR reference
- **Deleted files:**
  - `.cursor/rules/to-be-tested-for-format.mdc` — Rule no longer needed
  - `.cursor/skills/to-be-tested-for-executor-friendly/` — Entire skill directory removed
- **Benefit:** Cleaner, more scannable prerequisite sections focused on essential pre-conditions, personas, and test data

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
  - `prerequisites` — Structured object `{ personas, preConditions, testData }`; when provided, call `buildPrerequisitesHtml()` and write to `prerequisiteFieldRef`
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
