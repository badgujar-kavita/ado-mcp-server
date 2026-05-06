---
name: Draft ↔ ADO Round-Trip Fidelity (Tables, Custom Sections, In-Place Write-Back)
overview: "Fix two related defects that cause loss of reviewer-authored content during qa-publish. (1) Any custom Markdown section or row a reviewer adds to the draft (Test Data rows, per-TC specific prereq blocks, Coverage Checklist, reviewer notes, emoji tables) is silently stripped because qa_publish_push round-trips the file through parser → TcDraftData → formatter → disk, and the in-memory shape doesn't capture free-form sections. (2) Markdown tables in the draft's Pre-requisite / Persona / Test Data blocks flatten to bullet lists when pushed to ADO because buildPrerequisitesHtml only emits <ul>/<ol>, never <table>. ADO's rich-text field accepts <table> fine (proven by a manual paste to TC 1391478) — our code just doesn't emit it. Fix A: in-place write-back on push (regex-based mutation of title + status; preserves every other byte of the draft file). Fix B: emit <table> HTML for persona / pre-requisite / test data when building the ADO prereq field. Tests round-trip a fixture draft and diff the result."
todos:
  - id: phase0-lock-decisions
    content: "Phase 0: Lock decisions — in-place write-back approach (Option A from design discussion); keep TcDraftData shape unchanged; emit <table> with inline styles in HTML builder; no new slash commands or tools"
    status: pending
  - id: phase1-inplace-writeback
    content: "Phase 1a: Add applyPostPushEditsInPlace() helper in tc-drafts.ts — two targeted regex operations: flip Status DRAFT→APPROVED in the header table; append (ADO #N) to each TC title line. No parsing, no reformatting."
    status: pending
  - id: phase1-publish-rewire
    content: "Phase 1b: Rewire qa_publish_push success path to call applyPostPushEditsInPlace() instead of formatTcDraftToMarkdown(). Keep the parse→push flow for ADO writes; only change what gets written back to disk."
    status: pending
  - id: phase1-repush-path
    content: "Phase 1c: Ensure repush path (draft already has ADO IDs) also uses in-place write-back — updates are idempotent (re-applying same ID suffix is a no-op)."
    status: pending
  - id: phase2-table-parser
    content: "Phase 2a: Extend tc-draft-parser to capture Persona and Pre-requisite tables as structured rows (preserve original cell text, not flattened strings). Add optional `_raw` pass-through on TcDraftData for the prereq table so the builder can detect structured vs flat input."
    status: pending
  - id: phase2-table-builder
    content: "Phase 2b: Extend buildPrerequisitesHtml to emit <table> HTML with inline styles (border, padding, thead/tbody) when the source was a Markdown table. Fall back to <ul>/<ol> bullets when source was flat (existing behavior)."
    status: pending
  - id: phase2-format-html-helper
    content: "Phase 2c: Add helper buildAdoTable(rows: string[][], headers: string[]) in src/helpers/format-html.ts with inline-style HTML matching what ADO rich-text renders cleanly (same shape verified against manual paste on TC 1391478)."
    status: pending
  - id: phase3-tests-writeback
    content: "Phase 3a: Fixture test — write a draft with Test Data rows, per-TC specific Pre-requisite blocks, Coverage Checklist, reviewer Notes section; mock-push; re-read; diff — all reviewer content must survive byte-for-byte (except Status DRAFT→APPROVED and ADO IDs appended)."
    status: pending
  - id: phase3-tests-tables
    content: "Phase 3b: Fixture test — draft with a Persona table and a Pre-requisite table; push to mock ADO; verify emitted prereq HTML contains <table>, <thead>, <tbody>, <tr>, <td> tags with inline styles and preserves all rows + headers."
    status: pending
  - id: phase3-tests-idempotent
    content: "Phase 3c: Idempotency test — push, then re-push the same file; confirm no duplicate (ADO #N) suffixes and Status stays APPROVED."
    status: pending
  - id: phase4-docs
    content: "Phase 4: Update docs/changelog.md (Fixed entry), docs/repush-workflow.md (note that custom sections are now preserved), docs/examples/cursor-rules/GUIDE.md (note that tables in drafts survive to ADO)."
    status: pending
  - id: phase5-deploy
    content: "Phase 5: npm run build, npm test, npm run build:dist, commit."
    status: pending
isProject: true
---

# Draft ↔ ADO Round-Trip Fidelity

**Priority:** Medium-High — addresses two production defects impacting reviewer-authored content. Top-of-mind for QA leads who add custom sections.
**Estimated Effort:** 1-2 days
**Scope:** Draft parser/formatter + publish write-back path + prerequisite HTML builder. No changes to suite management, credentials, or tool surface.

---

## Problem Statement

### Defect 1 — Custom Markdown content silently stripped on publish

Today, `qa_publish_push` follows this sequence on success:
1. Reads `US_<id>_test_cases.md`
2. Parses via `parseTcDraftFromMarkdown` → produces `TcDraftData`
3. Pushes TCs to ADO → gets `adoWorkItemId` per TC
4. Re-serializes via `formatTcDraftToMarkdown(updatedData)` → writes back to disk

Step 4 is the problem. `TcDraftData` only captures parser-known fields (title, status, version, persona rows, pre-requisite rows, test data string, story summary, per-TC metadata + steps). **Anything else a reviewer added — custom sections, extra tables, Coverage Checklists, per-TC "Pre-requisite (specific to this TC)" blocks, reviewer Notes, emoji coverage matrices — is lost** because it was never in `TcDraftData` to begin with.

This hit US 1370221 directly: the per-TC Pre-requisite blocks (flag settings per TC) and the Test Data table rows were stripped by the push write-back.

### Defect 2 — Markdown tables flatten to bullet lists when pushed to ADO

`buildPrerequisitesHtml` in `src/helpers/prerequisites.ts` renders:
- Persona → `<ul>`/`<li>` nested bullets
- Pre-requisite → `<ol>`/`<li>` numbered list
- Test Data → inline text

ADO's rich-text field **accepts `<table>` with inline styles perfectly** (verified by inspecting TC 1391478 where a manual paste of a table HTML from markdownlivepreview.dev rendered correctly — `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>` all preserved). Our builder simply chooses not to emit tables, collapsing the draft's tabular structure into flat lists. Reviewers see clean tables locally; devs/QAs see flat bullet lists in ADO.

---

## Design Decisions — Locked Before Implementation

| Decision | Choice | Rationale |
|---|---|---|
| Write-back strategy | **In-place (Option A)** — regex-flip Status + append `(ADO #N)` to TC title lines; do NOT re-serialize | Preserves any custom content. Zero schema expansion. Robust to future tenant additions. Smallest code delta. |
| TcDraftData shape | **Unchanged** | In-place write-back doesn't need new fields. Future features may extend, but not this plan. |
| Prereq HTML tables | **Emit `<table>` with inline styles** when draft source was a Markdown table | ADO accepts it (proven by TC 1391478). Matches what reviewer sees locally. |
| Fallback behavior | **Keep existing `<ul>`/`<ol>` flattening** when source was flat text (not a table) | Backward compat — existing drafts without tables still work. |
| Idempotency | Re-push must be safe; appending `(ADO #N)` when already present is a no-op | Prevents duplicate suffixes on repush. Regex detects existing suffix. |
| Write-back scope | ONLY title + status flip; never touch description/prereq/steps/personas on disk | In-place means in-place. No "helpful" reformatting. |
| Tenant-added sections | **Preserved verbatim** — not tracked as structured fields, just bytes | Matches the `extend-with-cursor-rules` philosophy: tenants add whatever they need, MCP doesn't police structure. |
| Rollback | `git revert` of the commit — files on disk are human-readable markdown, no schema migration | Standard safety. |

---

## Phase 0 — Lock the Decisions

Review the table above. No code changes until Phase 0 is signed off. Specifically confirm:

1. **Write-back strategy** — Option A (in-place regex) wins over Option B (parser expansion) and Option C (passthrough sections). See discussion note in doc history.
2. **Table emission rule** — emit `<table>` with inline styles only when draft source was tabular; flat text stays as bullets.
3. **No tool renames, no new slash commands, no new config keys** — pure bug fix.

---

## Phase 1 — In-Place Write-Back on Publish

### 1a. Add `applyPostPushEditsInPlace()` helper

**Location:** `src/tools/tc-drafts.ts` (same file as `qa_publish_push`)

**Signature:**
```typescript
function applyPostPushEditsInPlace(
  originalMd: string,
  testCaseAdoIds: Array<{ tcNumber: number; adoId: number }>,
): { updatedMd: string; statusFlipped: boolean; titlesUpdated: number };
```

**Algorithm:**
```
1. Flip Status DRAFT → APPROVED
   - Match: /^\|\s*\*\*Status\*\*\s*\|\s*DRAFT\s*\|$/m
   - Replace with: "| **Status** | APPROVED |"
   - If already APPROVED, skip (idempotent)

2. For each TC:
   - Match TC title line: /^\*\*TC_<usid>_<padded-tcnum> -> .+?\*\*$/m
     (Captured lines start with "**TC_" and end with "**")
   - If title already ends with " (ADO #N)" — skip (idempotent)
   - Otherwise append " (ADO #<id>)" before the closing **
     Example: "**TC_1370221_01 -> ... -> ... (ADO #1391476)**"

3. Return updated markdown + diagnostic counts
```

**Edge cases handled:**
- Title with multiple arrows — regex anchors on `**TC_<usid>_<nn> -> ` prefix
- Title spanning multiple lines — regex requires `**` on start + end of same line; if the TC title is multiline (unusual), falls back to warning and leaves that TC's title untouched
- Status appears multiple times (shouldn't, but defensive) — replaces only in the header table block (before first `##` heading)

### 1b. Rewire `qa_publish_push` success path

**Location:** `src/tools/tc-drafts.ts` around lines 560–600 (current write-back block)

**Before:**
```typescript
// … after successful push, all TCs have adoWorkItemId
const updatedData = { ...data, status: "APPROVED", testCases: data.testCases.map((tc, i) => ({ ...tc, adoWorkItemId: results[i].id })) };
const newMd = formatTcDraftToMarkdown(updatedData);
writeFileSync(mdPath, newMd, "utf-8");
```

**After:**
```typescript
// … after successful push
const { updatedMd, statusFlipped, titlesUpdated } = applyPostPushEditsInPlace(
  mdContent, // original file bytes, already in memory from line 463
  results.map((r, i) => ({ tcNumber: data.testCases[i].tcNumber, adoId: r.id })),
);
writeFileSync(mdPath, updatedMd, "utf-8");
// Log: `Status flipped: ${statusFlipped}; ${titlesUpdated}/${results.length} TC titles updated`
```

The parse → push pipeline for ADO mutations stays unchanged. Only the write-back to local disk is different.

### 1c. Repush path

Repush (`repush: true`) means TCs already have `(ADO #N)` suffixes and status is `APPROVED`. The regex-based helper is idempotent:
- Status regex: matches only `DRAFT` — no-op on `APPROVED`
- TC title regex: detects existing `(ADO #N)` suffix and skips

No special casing needed — call `applyPostPushEditsInPlace` with the same signature. On repush, both `statusFlipped` and `titlesUpdated` return 0.

**Verification in tests:** push twice in succession; second push produces identical file content to first push's output.

---

## Phase 2 — Preserve Tables in Pre-requisite HTML

### 2a. Parser: capture table structure

**Location:** `src/helpers/tc-draft-parser.ts`

**Current parser** at `parsePreReqSection` (~line 180) extracts each `| N | Condition |` row and stores as a flat string in `preConditions: string[]`.

**New behavior:** Detect when the Pre-requisite section is a Markdown table (which it always is in the current template) vs. free-form text. Preserve the header row and all data rows as cell arrays:
```typescript
interface StructuredPrereqTable {
  headers: string[];
  rows: string[][];
}
```

Store both:
- `preConditions: string[]` — for backward compat (existing tests and consumers expect this)
- `preConditionsRaw: StructuredPrereqTable | null` — the new structured capture, populated only when source was tabular

Same for Persona section: add `personasRaw: StructuredPersonaTable | null` to `TcDraftData`.

### 2b. Builder: emit `<table>` HTML when structured input is present

**Location:** `src/helpers/prerequisites.ts`

**Change `renderPreConditions()`:**
```typescript
// When input includes `preConditionsRaw` (the new field), render a <table>.
// Fall back to existing <ol>/<li> rendering when preConditionsRaw is null.
function renderPreConditions(
  label: string,
  extras: string[] | null | undefined,
  defaults: string[],
  structured?: StructuredPrereqTable | null, // NEW
): string {
  if (structured && structured.rows.length > 0) {
    return renderPreConditionsTable(label, structured);
  }
  // … existing flat rendering
}
```

Same for `renderPersonas()`.

### 2c. HTML table helper

**Location:** `src/helpers/format-html.ts` (already exists for HTML helpers)

Add:
```typescript
/**
 * Emit an ADO-compatible HTML table.
 * Inline styles verified against TC 1391478 — ADO's rich-text editor preserves them.
 */
export function buildAdoTable(rows: string[][], headers: string[]): string {
  const tableStyle =
    "box-sizing:border-box;border-collapse:collapse;margin:1rem 0;" +
    "border:0px solid;font-size:0.875rem;font-family:Inter, sans-serif;";
  const thStyle =
    "box-sizing:border-box;border:1px solid rgb(209, 213, 219);" +
    "padding:10px 14px;text-align:left;color:rgb(55, 65, 81);font-weight:600;" +
    "background-color:rgb(248, 249, 250);";
  const tdStyle =
    "box-sizing:border-box;border:1px solid rgb(209, 213, 219);" +
    "padding:8px 14px;color:rgb(75, 85, 99);";

  let html = `<table style="${tableStyle}"><thead><tr>`;
  for (const h of headers) html += `<th style="${thStyle}">${formatContentForHtml(h)}</th>`;
  html += "</tr></thead><tbody>";
  for (const row of rows) {
    html += "<tr>";
    for (const cell of row) html += `<td style="${tdStyle}">${formatContentForHtml(cell)}</td>`;
    html += "</tr>";
  }
  return html + "</tbody></table>";
}
```

All styles are inline — ADO strips `<style>` blocks but preserves inline `style=""`.

---

## Phase 3 — Tests

**Framework:** `node:test` (already in repo).

### 3a. Fixture round-trip test

**File:** `src/tools/tc-drafts-roundtrip.test.ts` (new)

**Scenario:** write a fixture markdown file with:
- Standard header + Persona table + Pre-requisite table
- Test Data table with 3 rows
- A custom `## Reviewer Notes` section the formatter doesn't know about
- A Coverage Checklist table
- Per-TC `### Pre-requisite (specific to this TC)` blocks for 2 TCs
- 3 TCs with standard structure

Mock the push path (don't hit ADO). Call `applyPostPushEditsInPlace(originalMd, [ids])` directly. Assert:
- Status flipped DRAFT → APPROVED
- Every TC title has `(ADO #N)` appended
- **All other bytes identical** — Reviewer Notes, Coverage Checklist, Test Data rows, per-TC prereq blocks ALL survive verbatim

### 3b. Prereq HTML table emission test

**File:** `src/helpers/prerequisites.test.ts` (extend existing if present, or new)

**Scenario:**
- Input 1: `TcDraftData` with `preConditionsRaw` populated (structured table)
  - Expect output HTML to contain `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>` with inline styles
  - Verify all rows + headers present
- Input 2: `TcDraftData` with flat `preConditions: string[]` only (preConditionsRaw null)
  - Expect output HTML to use `<ol>`/`<li>` (existing behavior, backward compat)

### 3c. Idempotency test

Call `applyPostPushEditsInPlace` twice on the same input:
- First call: Status flipped, titles updated
- Second call on the output: returns identical bytes; `statusFlipped: false`, `titlesUpdated: 0`

### 3d. Existing tests must not regress

Run the full existing suite (`npm test`). All 166+ tests continue to pass. Any test that relied on `formatTcDraftToMarkdown` producing a specific output for publish should be updated — but the formatter itself is unchanged, only the publish path stops calling it.

---

## Phase 4 — Docs

### 4a. `docs/changelog.md` — Fixed entry

Under `## Unreleased`:

```markdown
### Fixed — Draft Round-Trip Fidelity

- **Custom sections in drafts are now preserved on publish.** Previously, any content added by reviewers outside the core schema (Test Data rows, per-TC `### Pre-requisite (specific to this TC)` blocks, Coverage Checklists, Reviewer Notes, emoji tables) was silently stripped because `qa_publish_push` re-serialized the markdown via the parser+formatter pipeline. The publish path now uses in-place write-back: only `Status: DRAFT → APPROVED` and per-TC `(ADO #N)` suffixes are mutated via regex. Every other byte of the draft file is preserved.
- **Markdown tables in draft prereqs now render as HTML tables in ADO.** The Pre-requisite and Persona sections were being flattened to bullet lists when pushed to ADO. ADO's rich-text field accepts `<table>` with inline styles (verified by manual-paste test on TC 1391478). The builder now emits `<table>` HTML when the draft source was a Markdown table; falls back to existing `<ul>`/`<ol>` rendering when input is flat.
- Idempotent on repush — re-running publish produces identical file output; no duplicate `(ADO #N)` suffixes.
```

### 4b. `docs/repush-workflow.md`

Add a short note: *"As of this release, custom sections and per-TC blocks you add to the draft are preserved on publish. You no longer need to re-add Test Data rows or per-TC Pre-requisite blocks after push."*

### 4c. `docs/examples/cursor-rules/GUIDE.md`

Under the "Gotchas" / "What rules CAN do" section, add: *"Rich Markdown content (tables, custom section headings, reviewer-authored blocks) is preserved through the draft → publish round-trip. Tables in Persona and Pre-requisite sections render as HTML tables in ADO."*

---

## Phase 5 — Deploy

```bash
npm run build
npm test
npm run build:dist
```

Commit. No schema migration. No credentials change. No tool surface change.

---

## Guardrails (Cross-Cutting)

| Concern | Rule |
|---|---|
| Zero regression on existing drafts | Parse+format pipeline still intact for reading/listing drafts; only the publish write-back changes |
| Backward compat for non-table drafts | Flat prereq input still renders as `<ol>`/`<li>` — bullet list behavior preserved |
| ADO push unchanged | The ADO payload is a separate concern from write-back; Phase 2 changes the HTML shape going TO ADO; Phase 1 changes what goes BACK TO DISK after push |
| File preservation | `applyPostPushEditsInPlace` never rewrites sections it doesn't target; custom content passes through |
| Idempotency | Re-push is safe — regex checks for existing `(ADO #N)` before appending |
| Logging | Diagnostic counts returned by `applyPostPushEditsInPlace` logged on publish completion — if expected titles don't update, user is told so they can investigate |

---

## Risks + Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Regex fails on exotic TC titles (e.g., literal `**` in summary) | Title not updated, user confused | Log diagnostic count; if `titlesUpdated < results.length`, surface warning with which TCs didn't match |
| Tenants manually editing the draft during push | Race condition — write-back overwrites user edits | Out of scope; publish is expected to be user-initiated and serial |
| ADO `<table>` rendering varies by ADO version | Table looks different in self-hosted ADO vs Cloud | Inline styles are conservative (matches what markdownlivepreview output looks like in ADO Cloud); falls back gracefully if ADO strips any style — table structure still renders |
| Regex on Status matches user-written `DRAFT` in prose | Unlikely (anchored to table row pattern) | Anchored regex `/^\|\s*\*\*Status\*\*\s*\|\s*DRAFT\s*\|$/m` specifically matches the header table row, not arbitrary prose |
| In-place edit misses TCs when draft has been manually restructured | User-facing | Log diagnostic; user can re-run or re-push explicitly |

---

## Files Changed Across All Phases

| File | Change |
|---|---|
| `src/tools/tc-drafts.ts` | New `applyPostPushEditsInPlace()` function; rewire `qa_publish_push` success path |
| `src/helpers/tc-draft-parser.ts` | Capture structured Persona + Pre-requisite tables; populate `personasRaw` and `preConditionsRaw` in `TcDraftData` |
| `src/types.ts` or wherever `TcDraftData` lives | Add optional `personasRaw` and `preConditionsRaw` fields (non-breaking; absent from existing drafts) |
| `src/helpers/prerequisites.ts` | Extend `renderPersonas` and `renderPreConditions` to emit `<table>` when structured input present |
| `src/helpers/format-html.ts` | Add `buildAdoTable()` helper |
| `src/tools/tc-drafts-roundtrip.test.ts` | NEW — round-trip fidelity test with custom sections |
| `src/helpers/prerequisites.test.ts` | New tests for table HTML emission |
| `docs/changelog.md` | Fixed entry |
| `docs/repush-workflow.md` | Custom-section preservation note |
| `docs/examples/cursor-rules/GUIDE.md` | Table round-trip note in Gotchas |
| `npm run build:dist` | Per workspace rule |

---

## Success Criteria

Plan is **done** when:

1. A draft with Test Data rows, per-TC Pre-requisite blocks, Coverage Checklist, and reviewer Notes is pushed via `qa_publish_push` and all custom content survives byte-for-byte (only Status flips + `(ADO #N)` suffixes are added).
2. A draft with a Markdown Persona table and Markdown Pre-requisite table is pushed, and the emitted ADO prereq HTML contains `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>` with inline styles. ADO renders the table cleanly.
3. Re-push is idempotent — no duplicate `(ADO #N)`, no duplicated Status flips.
4. All 166+ existing tests pass. New tests added per Phase 3 all pass.
5. Zero changes to tool surface, config schema, credentials, or slash commands.
