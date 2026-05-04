# Changelog

All notable changes to the ADO TestForge MCP server are documented here.

---

## Unreleased

### Suite Tool Consolidation

- **`qa_suite_setup_auto`** renamed to **`qa_suite_setup`** with optional `planId` and `sprintNumber` overrides for manual control.
- Structured ask-responses for plan/sprint resolution failures (returns `needs-input` status instead of throwing).
- Parent-title fetch failures now produce `warnings[]` instead of silent fallback.
- New config knob: `suiteStructure.tcTitlePrefix` — customizes the WIQL title prefix (default `"TC"`).
- Suite name case-corrections surface as `warnings[]` in the hierarchy result.

---

## 2026-05-04 — Consent rule delivery fix + ask-template tightening

### Fix

The `## What counts as consent` section in AGENTS.md was not reaching Cursor because `AGENTS.md` wasn't included in `dist-package/`. The rule text shipped to git but not to end users.

- `build-dist.mjs`: now copies `AGENTS.md` from repo root into `dist-package/` so the Vercel tarball installer places it at `~/.ado-testforge-mcp/AGENTS.md`. Cursor reads from this directory at session start, so the rule now actually reaches the agent.
- `src/prompts/index.ts`: tightened ask-templates in `create_test_cases` (steps 4-5) and `clone_and_enhance_test_cases` (if applicable). The "type YES to push" prompt now explicitly includes "no to cancel" per the consent rule's minimum re-ask form. The agent is also pointed at AGENTS.md for the full rule.
- `src/prompts/shared-contracts.ts`: `CONFIRM_BEFORE_ACT_CONTRACT` tightened to require ask-templates include both yes AND no as equal options, and to cross-reference the consent rule.
- `src/tools/tc-drafts.ts`: duplicate-TC preflight A/B/C menu — verified C (Cancel) is explicit.

### Motivation

Real-session transcript: user ran `/qa-publish`, agent asked "type YES to push" (without explicit no option), user replied with frustration ("are you that dumb seriously"), agent proceeded anyway and invoked `qa_draft_save`. Two problems compounded:
1. The agent wasn't reading AGENTS.md because it wasn't bundled.
2. Even if it had, the ask-template violated the minimum form, giving the agent no clear "this is the cancel path" signal.

Both addressed here.

### Verification (manual)

After reload:
1. Trigger `/qa-publish` on a US that has a draft pending review.
2. When the agent asks "reply YES to push / no to cancel", reply with frustration ("are you dumb", "seriously?").
3. Expected: agent re-asks with yes/no, does NOT call qa_draft_save or qa_publish_push.
4. If it still proceeds, the rule needs more teeth — log and report.

### Backward compatibility

Text-only changes. No tool or schema change. 150 tests still pass.

---

## 2026-05-04 — Consent vocabulary rule (frustration-is-not-consent)

### Change

New `## What counts as consent` section in `AGENTS.md` — a mechanical tool-gating check to prevent the agent from treating user frustration, sarcasm, rhetorical questions, or self-directed replies as authorization to proceed.

**Motivation:** a real-session transcript showed the agent responding to `"are you dumb"` by editing frontmatter and invoking the publish tool — zero explicit consent given, but the agent's helpfulness bias converted frustration into action. The existing rules (User-initiated invocation, Observed state, Editorial vs mechanical) pattern-match specific violations; they don't generalize to novel ambiguous inputs.

**The rule:** before invoking any tool, ask — *Does the user's most recent message contain an affirmative token that grants this specific action?* If yes, act. If no, re-ask, don't proceed. Affirmative tokens enumerated (yes/go ahead/do it/...), negative tokens enumerated (no/cancel/stop/...), and ambiguous replies — frustration, self-directed, questions-back, silence — are explicitly NOT consent.

**Scope — deliberately narrow:**
- Gates tool invocations (MCP tools + host-IDE Edit/Write/Read/Bash).
- Does NOT govern conversational tone — warmth, apology, empathy are whatever the underlying model naturally does.
- Does NOT change any tool contract or slash-command flow.

### Files updated

- `AGENTS.md`: new `## What counts as consent` section (~40 lines) between `User-initiated invocation` and `Response style`. Cross-reference added from the User-initiated section.
- `docs/proposals/consent-vocabulary.md` (new): full proposal for the record, adapted from jira-mcp-server-v2's equivalent.
- `src/prompts/contracts.test.ts`: 3 new phrase-pin tests so key rule phrasing survives future refactors.

### Backward compatibility

Prompt-rule only. No schema, tool, or response-shape change. 147 tests pass plus 3 new.

### Verification (manual, since LLM behaviour isn't CI-testable)

Two scripted probes post-merge:
1. Trigger the ask-template (any action tool that pauses for approval), reply `"are you dumb"` — expected: agent re-asks with yes/no prompt.
2. Same trigger, reply `"myself"` — expected: agent stands down ("I'll stand by").

If either fails, the rule text needs strengthening.

---

## 2026-05-04 — Parameterize Permission Set Group label; fix stale persona-field doc snippets

### Change

Follow-up to the `roles` / `personaRolesLabel` rename. The `PSG` column and list-item label is now controlled by a new configurable `personaPsgLabel` field under `prerequisiteDefaults`, same pattern as `personaRolesLabel`. Default is `"Permission Set Group"`; teams that use the abbreviation `PSG` (or a different construct entirely — Permission Set, Public Group, Role) set it explicitly.

- **New optional `prerequisiteDefaults.personaPsgLabel`** — controls the label displayed next to `PersonaConfig.psg` in generated HTML prerequisites and draft markdown. Defaults to `"Permission Set Group"`.
- **The shipped `conventions.config.json` now sets `personaPsgLabel: "PSG"`** so the project's existing output is byte-identical.
- **No field rename.** The config key `psg` on persona entries stays the same — only the DISPLAY label is parameterized.

Also fixed stale doc snippets that missed the `roles` rename:
- `docs/implementation.md`: the sample `conventions.config.json` block now shows `roles` instead of `tpmRoles`, and includes the two label fields.
- `docs/prerequisite-formatting-instruction.md`: generic HTML example uses placeholder-label wording so non-TPM teams don't see a literal "TPM Roles" in their reference doc.

### Files Updated

- `src/types.ts` — `personaPsgLabel?` added to `prerequisiteDefaults`; JSDoc on `PersonaConfig.psg`.
- `src/config.ts` — Zod schema for the new optional field.
- `src/helpers/prerequisites.ts` — reads `personaPsgLabel` from config, default `"Permission Set Group"`; hardcoded `"PSG"` removed from the HTML render.
- `src/helpers/tc-draft-formatter.ts` — column header reads the new label from config.
- `conventions.config.json` — `personaPsgLabel: "PSG"` added.
- `docs/implementation.md`, `docs/prerequisite-formatting-instruction.md` — stale snippets fixed.

### Backward Compatibility

- Config schema: purely additive. Configs without `personaPsgLabel` default to `"Permission Set Group"` — the ONLY consequence for an unconfigured team is the label changes from hardcoded `"PSG"` to the spelled-out default. No behavior change.
- `PersonaConfig.psg` field is unchanged. Any existing config loads untouched.
- This project's rendered test case output is byte-identical thanks to the explicit `personaPsgLabel: "PSG"` override.

---

## 2026-05-04 — Soften customer-specific examples in docs and tool descriptions

### Change

Removed the last set of TPM-customer-specific vocabulary (`GPT_D-HUB`, `SFTPM_24`, `SFTPM_14`) from architecture descriptions in user-facing docs, tool description strings, and error messages. This is a doc/text cleanup; there is no behavior change.

**What this fixes:** a non-TPM team running the MCP was seeing "GPT_D-HUB" and "SFTPM_24" references in generic architecture docs, in tool descriptions (when inspecting tools via `list_tools`), and in error messages when config was missing. These now read as generic `{Plan Name}` / `Sprint_<number>` placeholders, so the docs and tool surface are team-neutral.

- `docs/implementation.md`: architecture descriptions use `{Plan Name}` and `Sprint_<number>` placeholders; worked examples stay concrete but are now explicitly tagged as "per `conventions.config.json`".
- `docs/testing-guide.md`: `list_test_plans` example and sample API responses use generic names.
- Tool descriptions in `src/tools/test-plans.ts` and `src/tools/test-suites.ts` (see parallel source-code commit) no longer reference specific plan names.
- Error message in `src/helpers/suite-structure.ts` (`resolvePlanIdFromAreaPath`) no longer suggests specific plan names to add.

### Intentional non-changes

- Historical changelog entries are unchanged — they describe what shipped at a given date.
- The user's `conventions.config.json` sprint prefix (`SFTPM_`) is an intentional per-team setting, not hardcoding.
- TPM-specific reference docs (`test-case-writing-style-reference.md`, prerequisite formatting guides, tc-style guide) are labeled as illustrative examples for this project and are intentionally not genericized.
- `docs/test-case-pattern-analysis-gpt-dhub.md` was replaced by `docs/test-case-pattern-analysis.md` — a generic, illustrative-only version with fictional TC IDs and persona labels, plus an "Adapt to a real project" appendix.

### Backward Compatibility

No schema or behavior change. Text edits only.

---

## 2026-05-03 — Generic persona role label + example-text cleanup

### Change

Removed customer-specific hardcoding from two places so non-TPM teams can use the MCP out of the box without seeing TPM vocabulary in their generated test cases.

- **`PersonaConfig.tpmRoles` → `PersonaConfig.roles`** — the field on persona entries in `conventions.config.json` is now generic. Old configs using `tpmRoles` continue to load unchanged: Zod preprocesses the object and maps `tpmRoles` → `roles` transparently.
- **New optional `prerequisiteDefaults.personaRolesLabel`** — controls the display label rendered in generated test cases (HTML prerequisite block and draft markdown column header). Defaults to `"Roles"`. Teams with project-specific terminology set it explicitly (e.g. `"TPM Roles"`, `"Okta Groups"`).
- **The shipped `conventions.config.json` now sets `personaRolesLabel: "TPM Roles"`** so the project's existing test case output is unchanged byte-for-byte.
- **Example text swaps:** tool description and error message in `resolveSprintFromIteration` / `ensure_suite_hierarchy` now show `Sprint_12` instead of `SFTPM_24` as the iteration-path example. Real logic still reads the sprint prefix from `suiteStructure.sprintPrefix`; only the human-readable text changed.

### Files Updated

- `src/types.ts` — `PersonaConfig.roles` (renamed); `ConventionsConfig.prerequisiteDefaults.personaRolesLabel?`.
- `src/config.ts` — Zod schema with backward-compat preprocess for the old `tpmRoles` key.
- `src/helpers/prerequisites.ts` — reads label from config; accesses renamed `.roles` field.
- `src/helpers/tc-draft-formatter.ts` — same.
- `src/helpers/suite-structure.ts` — example in error message.
- `src/tools/test-suites.ts` — example in sprint-number tool description.
- `conventions.config.json` — field rename in 3 personas; `personaRolesLabel: "TPM Roles"` added.

### Backward Compatibility

- **Configs using `tpmRoles`**: keep working. Zod's `preprocess` step converts to `roles` at load time; the user never sees a change.
- **Generated test case output**: byte-identical for this project (label kept as "TPM Roles" via explicit config). Teams that don't set `personaRolesLabel` now see "Roles" instead of a hardcoded "TPM Roles" — the only breaking case is if a team previously relied on the hardcoded label despite not being a TPM project (unlikely).
- **Doc examples** in `docs/implementation.md`, `docs/test-case-writing-style-reference.md`, etc. still reference "TPM Roles" in illustrative blocks — those describe the existing project and are intentionally unchanged.

---

## vX.Y.0 — Hybrid Naming Convention Overhaul

All 23 slash commands and 32 MCP tools have been renamed to a new hybrid
convention:
- **Slash commands:** kebab-case (`/qa-draft`, `/ado-connect`)
- **MCP tools:** snake_case (`qa_draft`, `ado_connect`)
- **Skills:** kebab-case with the `qa-*` family for QA-workflow skills
- **Prefixes:** `ado-*` for raw ADO primitives, `qa-*` for QA lifecycle, `confluence-*` for Confluence

Prompt and tool names stay in 1:1 parity (`qa-draft` prompt ↔ `qa_draft` tool).

Clean rename — the MCP was not yet distributed to external users, so no
backward-compatibility aliases were needed.

### Added
- `/qa-tests` slash command (previously tool-only as `list_test_cases_linked_to_user_story`).

### Renamed — prompts (22 user-facing)
- `configure` → `/ado-connect`
- `check_status` → `/ado-check`
- `list_test_plans` → `/ado-plans`
- `get_user_story` → `/ado-story`
- `get_test_plan` → `/ado-plan`
- `list_test_suites` → `/ado-suites`
- `get_test_suite` → `/ado-suite`
- `list_test_cases` → `/ado-suite-tests`
- `list_work_item_fields` → `/ado-fields`
- `get_confluence_page` → `/confluence-read`
- `draft_test_cases` → `/qa-draft`
- `create_test_cases` → `/qa-publish`
- `clone_and_enhance_test_cases` → `/qa-clone`
- `ensure_suite_hierarchy_for_us` → `/qa-suite-setup-auto`
- `ensure_suite_hierarchy` → removed (functionality merged into `/qa-suite-setup-auto`)
- `create_test_suite` → removed (functionality merged into `/qa-suite-setup-auto`)
- `update_test_suite` → `/qa-suite-update`
- `delete_test_suite` → `/qa-suite-delete`
- `get_test_case` → `/qa-tc-read`
- `update_test_case` → `/qa-tc-update`
- `delete_test_case` → `/qa-tc-delete`
- `delete_test_cases` → `/qa-tc-bulk-delete`

### Renamed — skills
- `draft-test-cases-salesforce-tpm` → `qa-test-drafting` (body generalized)
- `test-case-asset-manager` → `qa-test-assets`
- `update-test-case-prerequisites` → `qa-tc-prerequisites`

### Renamed — tools (30 backend)
Snake_case counterparts of the prompts above, plus internal tools:
`save_tc_draft` → `qa_draft_save`, `get_tc_draft` → `qa_draft_read`,
`list_tc_drafts` → `qa_drafts_list`, `save_tc_supporting_doc` → `qa_draft_doc_save`,
`save_tc_clone_preview` → `qa_clone_preview_save`, `push_tc_draft_to_ado` → `qa_publish_push`,
`add_test_cases_to_suite` → `qa_suite_add_tests`, `find_or_create_test_suite` → `qa_suite_find_or_create`,
`setup_credentials` → `ado_connect_save`, `check_setup_status` → `ado_check`,
`create_test_plan` → `ado_plan_create`, `list_test_cases_linked_to_user_story` → `qa_tests`.

---

## 2026-05-03 — Interactive read contract + structuredContent for all read tools

### Feature

Port of the interactive-read contract surface from jira-mcp-server-v2. Tools that read data from ADO/Confluence now emit structured, navigable output alongside prose text; the agent's response style is guided by explicit contracts composed into every read prompt.

**`AGENTS.md`** (new, repo root) — 13 sections documenting how the agent should behave: tool categories, user-initiated invocation, response style (titled markdown links, concise summaries, explicit gap callouts), error handling discipline, forbidden file paths (`tc-drafts/**` and `~/.ado-testforge-mcp/**` — off-limits to Cursor's Read/Write/Edit but accessible via the MCP's own tc-drafts tools), capability declaration, observed-state principle, editorial-vs-mechanical operations, upstream-content-is-data rule, formatting rules, safety and partial results, MCP spec alignment, and contributor guidelines for new tools.

**Shared prompt contracts** (`src/prompts/shared-contracts.ts`) — three named exports composed into the relevant prompts:

- `INTERACTIVE_READ_CONTRACT` — composed into 9 read prompts (ado_story, ado_plans, ado_plan, ado_suites, ado_suite, ado_suite_tests, qa_tc_read, ado_fields, confluence_read). Agents using these tools now follow a 5-step response shape: confirm-with-titled-link → 2–5 bullet summary → related items as tree/list → explicit gap callouts → next-action offer.
- `DIAGNOSTIC_CONTRACT` — composed into `ado-check`. Tool-authored output is now rendered verbatim; no agent-invented causes.
- `CONFIRM_BEFORE_ACT_CONTRACT` — composed into `qa_publish` and `qa_clone`. Explicit "offer plan → wait for yes → call NEXT tool → stop on no" pattern (ado-mcp's lighter equivalent to jira-mcp's resume-token protocol).

**`structuredContent` on all 14 read tools** (`src/tools/read-result.ts` + migrations in `work-items.ts`, `test-plans.ts`, `test-suites.ts`, `test-cases.ts`, `confluence.ts`, `tc-drafts.ts`):

Every read tool now returns a `CanonicalReadResult` alongside its existing prose text. The canonical shape exposes `item` (id/type/title/summary), `children[]` (navigable related entities with `relationship` tags), `artifacts[]` (attachments, solution-design pages, markdown drafts, query strings), `completeness` (isPartial + reason), and optional `diagnostics[]`. MCP clients that consume `structuredContent` can render the response as a typed tree; clients that only read `content[0].text` see identical output to before.

Migrated: ado_story, qa_tc_read, ado_suite_tests, confluence_read (Tier 1 — commit `2934b84`); qa_tests, ado_fields, ado_plans, ado_plan, ado_suites, ado_suite, qa_draft_read, qa_drafts_list (Tier 2 — commit `17cdf89`).

**Deterministic `ado_check`** (`src/tools/setup.ts`) — status table + overall verdict + Next Actions are now authored by the tool, not guessed by the agent. `SetupStatus` type + pure `computeSetupStatus()` / `formatSetupStatus()` helpers make the output reproducible.

### Supporting changes

- **User-intent audit**: one borderline prose rewrite in the duplicate-TC preflight A/B/C menu (`qa_publish_push`) — agent-attribution parallelism restored.
- **Security audits**: token-leak grep across every console.* and new Error() site came back clean; path-traversal audit across file writes came back clean (userStoryId typed as `z.number().int().positive()`, filenames sanitized, paths always rooted under known-safe prefixes). Recorded in new `docs/decision-log.md`.

### Files Updated

- **New:** `AGENTS.md`, `src/prompts/shared-contracts.ts`, `src/prompts/contracts.test.ts`, `src/tools/read-result.ts`, `src/tools/read-canonical.test.ts`, `src/tools/test-plans.test.ts`, `src/tools/test-suites.test.ts`, `src/tools/tc-drafts.test.ts`, `src/tools/setup.test.ts`, `docs/decision-log.md`.
- **Modified:** `src/prompts/index.ts` (composition), `src/tools/work-items.ts` / `test-cases.ts` / `test-plans.ts` / `test-suites.ts` / `tc-drafts.ts` / `confluence.ts` / `setup.ts` (read-tool migrations + deterministic setup status), `src/tools/work-items.test.ts` (+4 tests).

### Backward Compatibility

- **Prose byte-identity.** All 14 migrated read tools preserve their existing `content[0].text` payload byte-for-byte. Agents that only read prose see zero change.
- **No wire breakage.** `structuredContent` is an additive field on the MCP response shape. Clients that don't know about it ignore it.
- **No action tools migrated.** Write tools (qa_draft_save, qa_publish_push, create/update/delete_*) remain on `server.tool()` and return text only. Phase H's image content parts continue to flow through `ado_story` unchanged.
- **Contracts are additive prose.** Appended to existing prompt bodies; no existing prompt text was rewritten. The composition tests pin this invariant.

---

## 2026-05-03 — Full-context work-item payload + embedded image support

### Feature

`ado_story` now returns a richer UserStoryContext so draft generation can incorporate every populated custom field, every linked Confluence page, and (optionally) the actual pixel contents of ADO / Confluence attachments.

**New response fields** (all additive; pre-existing fields preserved):

- `namedFields: Record<ref, { label, html, plainText }>` — primary rich-text fields (Title, Description, AcceptanceCriteria, Solution Notes + any `additionalContextFields` configured in conventions.config.json, e.g. `Custom.ImpactAssessment`, `Custom.ReferenceDocumentation`).
- `allFields: Record<ref, unknown>` — every populated ADO field on the work item, system-noise filtered by default (28 bookkeeping fields dropped: `ChangedDate`, `Watermark`, `BoardColumn`, etc.). Teams can extend the filter via `allFields.omitExtraRefs` or disable via `allFields.passThrough: false`.
- `fetchedConfluencePages: FetchedConfluencePage[]` — EVERY Confluence link found in any scanned field is fetched (not just the first). Each page entry includes `{ pageId, title, url, body, sourceField, images }` and contributes to a combined image cap.
- `unfetchedLinks: UnfetchedLink[]` — SharePoint, Figma, LucidChart, GoogleDrive, cross-instance Confluence, auth-failed, link-budget, and time-budget links are all surfaced with `{ url, type, sourceField, reason, workaround }` so the agent can tell the user to paste content manually before drafting.
- `embeddedImages: EmbeddedImage[]` — `<img>` tags in rich-text fields are parsed, resolved to ADO attachment URLs, fetched via PAT, size-guarded, and surfaced with full metadata (`{ source, sourceField, originalUrl, filename, mimeType, bytes, altText, skipped? }`). The same pipeline runs on Confluence page `<ac:image>` / `<img>` refs (`fetchedConfluencePages[].images`).

**New MCP image content parts** (ship-dark, opt-in):

When `images.returnMcpImageParts: true` is set in `conventions.config.json`, `ado_story` returns the actual image bytes as MCP image content parts alongside the text JSON — Cursor, Claude Desktop, and other vision-capable MCP clients render them as vision input so the agent can see wireframes, screenshots, and diagrams directly. Default is `false` so the existing response shape is unchanged until teams opt in. A `maxTotalBytesPerResponse` cap (default 4 MiB) protects the Claude context window; overflowed images are marked `skipped: "response-budget"` with `originalUrl` still clickable.

**Prompt + skill updates:**

- `qa_draft` step 2a: swapped the old "description / AC / Solution Design content" terminology for "primary inputs are `namedFields[*].plainText` and `fetchedConfluencePages[].body`." Legacy top-level fields remain equivalent.
- `qa_draft` steps 2d + 2e (new): documents how to consume every new payload field, and mandates surfacing `unfetchedLinks` to the user BEFORE generating a draft (safety rule).
- `qa_publish` step 3: cross-references 2d–2e so the no-draft branch follows the same consumption rules.
- `qa_clone` step 4: same cross-reference.
- `ado_story` slash command: now asks the agent to produce a structured 6-section summary (primary / namedFields / Confluence pages / images / unfetchedLinks / allFields).
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
- **Extended:** `src/types.ts`, `src/config.ts`, `conventions.config.json`, `src/ado-client.ts` (`getBinary()`), `src/confluence-client.ts` (`listAttachments`, `fetchAttachmentBinary`, `getPageContentRaw`, 401→api.atlassian.com fallback), `src/helpers/confluence-url.ts` (`extractAllLinks`, `categorizeLink`, `extractConfluencePageIdFromUrl`), `src/tools/work-items.ts` (`extractUserStoryContext` rewrite, `buildGetUserStoryResponse` packing), `src/prompts/index.ts`, `.cursor/skills/qa-test-drafting/SKILL.md`, `.cursor/skills/qa-test-assets/SKILL.md`, `build-dist.mjs`, `package.json` (+jimp, +node-html-parser).
- **Tests:** ~110 new `node:test` unit tests covering link extraction, binary fetch, attachment parsing, downscale, guardrails, response-budget packing, 401 fallbacks, and the full context build.

### Backward Compatibility

- Every pre-existing `UserStoryContext` field preserved (`title`, `description`, `acceptanceCriteria`, `areaPath`, `iterationPath`, `state`, `parentId`, `parentTitle`, `relations`).
- `solutionDesignUrl` and `solutionDesignContent` kept as deprecated aliases; populated from the FIRST fetched Confluence page so legacy consumers continue to work.
- `ado_story` response shape stays `[text]` by default (`returnMcpImageParts: false`). Flip in config to get `[text, image, image, …]`.
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
- **`qa_publish_push` success message** — TC→ADO mappings now render as markdown links: `TC_1363736_01 → [ADO #1386085](https://dev.azure.com/.../_workitems/edit/1386085)`.
- **`qa_draft_read`** — when the draft has ADO IDs, appends a new **"## ADO Links (agent display — not persisted)"** section to the returned text with clickable links for the User Story and each TC. The file on disk is **untouched** — this is a response-level convenience so the agent has URLs to build tables/summaries from.
- **`qa_tests`** — response now includes `testCases: [{id, webUrl}]` and `userStoryWebUrl` **alongside** the existing `testCaseIds` field (kept for backward compatibility with the clone-and-enhance flow and any other consumers).
- **`qa_tc_read`** — adds `webUrl` field to the response (distinct from ADO's native `url` field which is the API endpoint).
- **`ado_story`** — adds `webUrl` field to the response.
- **`qa_publish` prompt** — new step (9) instructs the agent to use `webUrl` fields when rendering ADO IDs in chat, and to surface `qa_draft_read`'s "ADO Links" section in draft summaries.

### Why This Shape

The draft markdown on disk is a **round-trip format** — the formatter writes it, the parser reads it back on push/repush. Embedding markdown-link syntax in the persisted draft (e.g. `(ADO #1234)` → `([ADO #1234](url))`) would break the parser's `/\(ADO #(\d+)\)/` regex and cause `repush: true` to fail on every revised draft. Instead, URLs are added only at **response time**: tool output gets URLs, disk content stays in the shape the parser expects. No migration, no backward-compat regex work, no risk to existing drafts.

### Files Updated

- **New:** `src/helpers/ado-urls.ts`
- `src/tools/tc-drafts.ts` — push summary uses markdown links; `qa_draft_read` appends ADO Links section.
- `src/tools/work-items.ts` — `ado_story` + `qa_tests` responses include `webUrl`.
- `src/tools/test-cases.ts` — `qa_tc_read` response includes `webUrl`.
- `src/prompts/index.ts` — agent instruction to use `webUrl` when rendering ADO IDs.

### Backward Compatibility

- `qa_tests` response keeps `testCaseIds: number[]` alongside the new `testCases` and `userStoryWebUrl` fields. Clone-and-enhance flow unaffected.
- `AdoWorkItem.url` (the native ADO API URL) is preserved in `qa_tc_read`; the new browsable URL is on a separate `webUrl` field to avoid clobbering.
- Draft markdown format unchanged. Parser unchanged. Old drafts still work.
- `qa_draft_read` output contains all previous content verbatim; new section is **appended** at the end, not injected.

---

## 2026-05-03 — Duplicate Test Case Preflight on Push

### Feature

- **`qa_publish_push` now runs a preflight check for existing linked test cases.** When the User Story already has test cases linked via `Microsoft.VSTS.Common.TestedBy` and the draft has no ADO IDs, the tool aborts the insert and returns a counts-based risk message (no listing dump) with three lettered options: **A.** proceed with `insertAnyway: true`, **B.** inspect existing TCs first via `qa_tests` + `qa_tc_read`, **C.** cancel. Prevents accidental duplicate creation when a draft is regenerated after a previous push, when TCs were created manually/elsewhere, or when pushing from a different workspace.
- **Counts, not dumps.** The preflight message shows only the count of existing TCs + count of new ones that would be created + a duplicate-risk warning. Full titles/steps are available on demand via the existing investigative tools if the user picks option B. Clean separation: publish prompts are operational, `qa_tests` + `qa_tc_read` are investigative.
- **Silent happy path.** If the US has zero linked TCs, the preflight is invisible — push proceeds as before.
- **Network-failure honesty.** If the ADO relations call fails (timeout, 500, etc.), the tool surfaces the error and asks the user to either cancel or pass `insertAnyway: true` if they're confident. Never silently proceeds past a failed check.
- **New `insertAnyway: boolean` parameter** — explicit override. Set `true` only after the user has seen the A/B/C prompt and replied **A**. Default `false`.
- **`qa_publish` prompt updated** — new step (6) instructs the agent to surface the preflight message verbatim (no re-formatting, no listing), wait for the user's A/B/C reply, and only pass `insertAnyway: true` on A.

### Files Updated

- `src/tools/tc-drafts.ts` — Added `fetchLinkedTestCaseIds()` helper (resolves TestedBy relations on the US); added preflight branch before the insert loop; added `insertAnyway` parameter.
- `src/prompts/index.ts` — Updated `qa_publish` prompt flow to handle the new preflight response (counts-based, lettered-options).

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
- **New `qa_draft_doc_save` tool** — Save supporting documents (solution_design_summary, qa_cheat_sheet, regression_tests) to the same US folder
- **Auto-generated Supporting Documents links** — Main test cases file includes relative links to solution_design_summary and qa_cheat_sheet
- **Backward-compatible readers** — `qa_draft_read`, `qa_drafts_list`, and `qa_publish_push` support both new subfolder layout and legacy flat layout

### Files Updated

- **Tools:**
  - `src/tools/tc-drafts.ts` — Updated `qa_draft_save` to create per-US subfolders, added `qa_draft_doc_save` tool, updated all read tools for backward compatibility
  
- **Formatter/Parser:**
  - `src/helpers/tc-draft-formatter.ts` — Added "Supporting Documents" section with relative links after metadata
  - `src/helpers/tc-draft-parser.ts` — Made header parsing robust against new sections by anchoring to first H2

- **Prompts:**
  - `src/prompts/index.ts` — Updated `qa_draft` and `qa_publish` to use `qa_draft_doc_save` for supporting documents

- **Documentation:**
  - `docs/implementation.md` — Documented new folder structure and `qa_draft_doc_save` tool
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
- `qa_drafts_list` shows both layouts with `(legacy flat)` suffix for old files
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
  - `.cursor/skills/qa-tc-prerequisites/SKILL.md` — Updated structure definition and removed from example

### Impact

- **Server now starts successfully** — No more ZodError on startup
- **Prerequisites simplified** — Only Persona, Pre-requisite, and Test Data sections remain
- **Breaking change for drafts created before 2026-04-15** — Old drafts with `toBeTested` will have that field ignored during parsing

---

## v1.1.0 — 2026-04-24 — State-Aware Welcome and Status Updates

- Added first-run detection via `~/.ado-testforge-mcp/.ado-testforge-initialized` so `ado-check` shows the full welcome only once per version.
- Added state-aware status output with distinct first-run, returning-user, setup-incomplete, and version-update experiences.
- Added version-aware update summaries in `ado-check`, driven by the current package version and top changelog highlights.
- Changed `ado_story` so Confluence fetch failures are silently skipped and return `solutionDesignContent = null` instead of leaking warning text into the ADO workflow.
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
- **Files updated:** `.cursor/skills/qa-test-assets/SKILL.md`, `.cursor/skills/qa-test-drafting/SKILL.md`, `src/prompts/index.ts`, `.cursor/rules/test-case-draft-formatting.mdc`, `docs/test-case-writing-style-reference.md`, templates

---

## 2026-04-15 — Test Case Asset Management & Folder Structure

### Test Case Asset Manager Skill

- **New skill:** `.cursor/skills/qa-test-assets/SKILL.md` — orchestrates folder structure and file organization for test case documentation
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

- **`qa_draft` and `qa_publish` prompts updated:** Now explicitly instruct AI to:
  - Create `tc-drafts/US_<ID>/` folder structure
  - Generate all three files (test cases, solution summary, QA cheat sheet)
  - Apply both skills: `test-case-asset-manager` for folder structure + `draft-test-cases-salesforce-tpm` for content quality
  - Use qa_draft_save for main file, create supporting documents separately
- **Formatting rule updated:** `.cursor/rules/test-case-draft-formatting.mdc` Section 11 references new folder convention

### Files Changed

- **New skill:** `.cursor/skills/qa-test-assets/SKILL.md`
- **New templates:** `.cursor/skills/qa-test-assets/templates/` (4 files)
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
  - `.cursor/skills/qa-test-assets/templates/test_cases.template.md` — Removed TO BE TESTED FOR row
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
- **Files changed:** `src/helpers/tc-draft-formatter.ts`, `src/helpers/tc-draft-parser.ts`, `src/tools/tc-drafts.ts`, `src/prompts/index.ts`, `.cursor/skills/qa-test-drafting/SKILL.md`

---

## 2026-04-06 — Test Plan ID Now Optional in Draft Stage

### Simplified Draft Workflow

- **`qa_draft_save`** — `planId` parameter is now **optional**. You can draft test cases with just the User Story ID.
- **`qa_draft`** command — Now only asks for User Story ID (no longer asks for Test Plan ID).
- **Auto-derivation** — When pushing a draft to ADO via `qa_publish_push`, if the draft has no `planId`, the system automatically:
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

- **`/ado-testforge/qa-clone`** — Clone test cases from a source User Story to a target User Story. Reads source TCs, analyzes target US + Solution Design, classifies each TC (Clone As-Is / Minor Update / Enhanced), generates preview, creates in ADO only after explicit APPROVED.
- **`qa_tests`** — Get test case IDs linked to a User Story via Tests/Tested By relation. Use before cloning.
- **`qa_clone_preview_save`** — Save clone preview to `tc-drafts/Clone_US_X_to_US_Y_preview.md`. User reviews and responds APPROVED / MODIFY / CANCEL.

### Suite Hierarchy

- **`qa_suite_setup_auto`** — Now returns `planId` in the result (used by clone flow for qa_draft_save).

---

## 2026-02-25 — Create/Update Suite: User Story ID Only; Auto-Derive Plan & Sprint

### New Tool: qa_suite_setup_auto

- Takes **only User Story ID**. Derives test plan from US AreaPath (via `testPlanMapping`) and sprint from Iteration (e.g. SFTPM_24 → 24).
- Creates folders if missing; updates naming if existing suite has wrong format (e.g. `||` → `|`).

### Config: testPlanMapping

- **`conventions.config.json`** → `suiteStructure.testPlanMapping`: Array of `{ planId, areaPathContains }`. First match wins. Example: DHub/D-HUB → GPT_D-HUB (1066479), EHub/E-HUB → GPT_E-HUB. Configure plan IDs for your project.

### Prompt Updates

- **`qa_suite_update`** now asks only for User Story ID and uses `qa_suite_setup_auto`.
- **`/ado-testforge/qa-suite-setup-auto`** — New slash command for the same flow.
- **`qa_suite_create`** removed — its functionality was merged into `qa_suite_setup_auto`.

---

## 2026-02-25 — Create, Update, and Delete Test Suite Commands

### New Tools and Slash Commands

- **`qa_suite_update`** — Update an existing test suite. Supports partial updates: `name`, `parentSuiteId`, `queryString` (for dynamic suites).
- **`qa_suite_delete`** — Delete a test suite. Test cases in the suite are not deleted—only their association with the suite is removed.
- **Slash commands:** `/ado-testforge/qa-suite-update`, `/ado-testforge/qa-suite-delete`

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

### Repush Support (qa_publish_push)

- **New parameter:** `repush: true` — When draft is APPROVED and user revised it, call with `repush: true` to **update** existing test cases instead of creating new ones.
- **Flow:** Parses draft → for each TC with `adoWorkItemId`, calls `updateTestCaseFromParams` (applies full formatting) → no new work items created.
- **Benefit:** Revise draft, run qa_publish with repush → formatting applied every time.

### expandListItems — Don't Split on Semicolons Inside Parentheses

- **Problem:** "LOA thresholds configured per Sales Org (e.g., L1 0-25,000; L2 25,001-50,000; L3 50,001-250,000)" was split into 3 items because of semicolons.
- **Fix:** `splitListItemSafely` only splits on " • " or "; " when outside parentheses/brackets. Semicolons inside "(e.g., ...)" stay as one item.
- **Files:** `src/helpers/format-html.ts`, `src/helpers/prerequisites.ts`, `src/helpers/steps-builder.ts`, docs

---

## 2025-02-25 — Draft Test Cases QA Architect Skill

### New Skill: draft-test-cases-salesforce-tpm

- **Location:** `.cursor/skills/qa-test-drafting/SKILL.md`
- **Purpose:** QA architect methodology for drafting test cases from User Story + Confluence Solution Design
- **Steps:** Analyze US (extract functional behavior, field updates, status transitions, config dependency, etc.); use Confluence SD (extract business rules, config variables, conditional flows; ignore code/implementation); validate coverage matrix (market variations, trigger fields, status scenarios, config logics, backward compatibility); add Functionality Process Flow and Test Coverage Insights at draft start; generate complete test cases
- **Reference:** `config-summary-examples.md` for Pre-requisite config summary templates

### Draft Structure Enhancements

- **qa_draft_save:** Optional `functionalityProcessFlow` (mermaid/process diagram) and `testCoverageInsights` (classified coverage scenarios with auto-computed summary) added at draft start
- **Prompts:** `qa_draft` and `qa_publish` (when creating draft) now reference the QA architect skill
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

- **Header field:** `qa_draft_save` now adds **Drafted By** to the markdown header table using the system username (macOS: `os.userInfo().username` or `USER`; Windows: `USERNAME`).
- **File:** `src/helpers/system-username.ts`, `src/helpers/tc-draft-formatter.ts`

### Deferred JSON Until Push

- **qa_draft_save:** Writes only `.md`; no JSON until push. Avoids JSON drift during multiple revisions.
- **qa_drafts_list:** Lists `.md` files; parses header for US ID, title, status, version.
- **qa_draft_read:** Returns markdown only; no version-sync validation (no JSON).
- **qa_publish_push:** Reads `.md` only, parses via `parseTcDraftFromMarkdown`, creates TCs in ADO, then generates JSON with correct mappings for audit/reference.
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

- **qa_draft_read:** If .md and .json versions differ, appends a warning and suggests calling `qa_draft_save` to sync.
- **qa_publish_push:** Rejects with error if .md and .json versions differ; user must call `qa_draft_save` first.
- **qa_draft_save:** Always writes both .md and .json in sync (unchanged).

---

## 2025-02-25 — Deployment: Prerequisites, Tools, Title Limit, Styling

### Commands Added

#### `qa-tc-bulk-delete`

- **File:** `src/prompts/index.ts`
- **Purpose:** Delete multiple test cases by ID. Asks for comma-separated or list of IDs, confirms, warns about Recycle Bin (restorable within 30 days), calls `qa_tc_delete` for each, reports success/failure per ID.

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

#### `qa_tc_update`

- **File:** `src/tools/test-cases.ts`
- **New parameters:**
  - `prerequisites` — Structured object `{ personas, preConditions, testData }`; when provided, call `buildPrerequisitesHtml()` and write to `prerequisiteFieldRef`
  - `areaPath` — Updated area path
  - `iterationPath` — Updated iteration path
- **Behavior:** Accepts either `description` (raw HTML) or `prerequisites` (structured). When both are omitted, no prerequisite update is applied.

---

### New Tools (Already Present)

- **`ado_fields`** — List all work item field definitions (reference names, types, readOnly). Optional `expand` param for extension fields.
- **`qa_tc_delete`** — Delete a test case by ID. Default: move to Recycle Bin. Use `destroy=true` for permanent delete (not recommended).

---

### Commands (Prompts)

| Command | Change |
|---------|--------|
| `qa_tc_update` | Prompt now mentions: title, description/prerequisites, steps, priority, state, assignedTo, areaPath, iterationPath |
| `qa_tc_delete` | Prompt now requires confirmation before delete; warns when `destroy=true` is requested |

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

#### `qa_draft` Prompt

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

- **Post-Setup Verification** — Verify 21 tools, qa-tc-bulk-delete, qa_tc_update, ado_fields, title limit
- **Rules for tc-drafts** — How to copy test-case-draft-formatting.mdc to a separate workspace; multi-root option

---

### Post-Deployment Checklist

1. **Rebuild** — `npm run build`
2. **Restart MCP** — Restart Cursor or reload ado-testforge in Settings → MCP
3. **Verify tools** — `ado_fields`, `qa_tc_delete`, `qa_tc_update` (with prerequisites, areaPath, iterationPath)
4. **Verify commands** — `/ado-testforge/qa-tc-update`, `/ado-testforge/ado-fields`, `/ado-testforge/qa-tc-delete`
5. **Verify prerequisite formatting** — Update a test case; confirm HTML renders in ADO
6. **Verify title limit** — Draft a TC with long title; confirm truncation works
