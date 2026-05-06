---
name: Close MD ↔ ADO Sync Gaps (Per-TC Prereq, System.Tags Match-Only, Flow Authoring Quality)
overview: "Three targeted improvements to draft→ADO sync. (1) Per-TC Pre-requisite blocks authored as `### Pre-requisite (specific to this TC)` are currently ignored by the parser — ADO receives only the common prereq. Fix: parser recognizes this heading and appends the per-TC rows to the common list in the ADO prereq HTML (additive, not replacing). (2) System.Tags support via match-only policy — before push, query ADO for existing tags, apply only tags that already exist. Never create new tags. Tenants without tag-creation permission (common) stay safe; title-prefix category remains the WIQL-filterable fallback. (3) Functionality Process Flow authoring quality: codify in the qa-test-drafting skill the flow shape that produced the clear US 1370221 output (Mermaid when logic is clean; numbered text blocks with actor→action→state-transition+bracketed variations when Mermaid would lie)."
todos:
  - id: phase0-decisions
    content: "Phase 0: Lock the three decisions — per-TC prereq is additive to common; System.Tags is match-only (never creates); flow authoring is a skill + prompt rule, not code"
    status: pending
  - id: phase1-pertc-parser
    content: "Phase 1a: Extend parser to extract `### Pre-requisite (specific to this TC)` blocks per TC; add `preConditions` and optional `preConditionsTable` to per-TC prerequisites"
    status: pending
  - id: phase1-merge-prereqs
    content: "Phase 1b: Update mergePrerequisites() in createTestCase path to additively combine common + TC-specific preConditions into a single HTML block (common first, then TC-specific)"
    status: pending
  - id: phase1-tests
    content: "Phase 1c: Tests — parser captures per-TC prereq blocks; HTML output shows common rows then TC-specific rows in order; empty per-TC prereq falls through to common only"
    status: pending
  - id: phase2-tags-fetch
    content: "Phase 2a: Add ado_client.listTagsForProject() or cache; fetch once per push batch"
    status: pending
  - id: phase2-tags-config
    content: "Phase 2b: Add optional `**Tags**` row on per-TC metadata table; parser extracts; also auto-extract category prefix from TC title (first arrow segment if known category: Regression/SIT/E2E/etc)"
    status: pending
  - id: phase2-tags-apply
    content: "Phase 2c: On push, match requested tags against fetched ADO tags (case-insensitive); apply matches via System.Tags (semicolon-separated); skip unmatched with a warning; never create new tags"
    status: pending
  - id: phase2-tags-tests
    content: "Phase 2d: Tests — existing tag matches applied; missing tag logs warning and is skipped; tag fetch failure is non-blocking (push continues without tags)"
    status: pending
  - id: phase3-skill-flow-quality
    content: "Phase 3a: Update qa-test-drafting SKILL.md — codify Functionality Process Flow format rules (when to use Mermaid vs numbered text blocks; required elements: actor, action, state transitions, bracketed variations; must end with terminal observable state)"
    status: pending
  - id: phase3-prompt-reinforce
    content: "Phase 3b: Reinforce the flow-quality rule in /qa-draft prompt — explicit reference to skill section and reminder to include terminal state per flow"
    status: pending
  - id: phase4-docs
    content: "Phase 4: Update docs/changelog.md + docs/examples/cursor-rules/GUIDE.md to document per-TC prereq now works + match-only tag policy + flow authoring rules"
    status: pending
  - id: phase5-deploy
    content: "Phase 5: npm run build + npm test + npm run build:dist + commit"
    status: pending
isProject: true
---

# Close MD ↔ ADO Sync Gaps

**Priority:** Medium — impacts draft fidelity and ADO usability
**Effort:** ~Half day
**Scope:** Parser, prereq builder, push tag application, skill authoring

## Problem Statement

Three gaps identified during audit of MD → ADO sync for US 1370221:

### Gap 1 — Per-TC Pre-requisite blocks are silently ignored

Drafts authored by Lead QA contain `### Pre-requisite (specific to this TC)` blocks per TC (e.g. for flag=TRUE vs flag=FALSE TCs in US 1370221). These render correctly in the Markdown file, but the parser only recognizes `**Additional Pre-requisite (TC-specific):**` (see `tc-draft-parser.ts:177`). Result: ADO receives only the common prereq — TC-specific setup is lost.

### Gap 2 — No System.Tags support

Draft title-prefix category (`Regression`, `SIT`, `E2E`) is WIQL-filterable but doesn't populate `System.Tags`. ADO UI filters, dashboards, and boards can't group TCs by category. Tenants would benefit from tag-based grouping but **most environments forbid QA from creating new tags** — any implementation must be match-only.

### Gap 3 — Flow diagram quality is inconsistent across drafts

US 1370221's draft had high-quality flow blocks (actor → action → state-transition with bracketed variations). Older drafts (1273966) vary. No skill rule codifies the "good" shape, so regressions happen.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Per-TC prereq behavior | **Additive** — common + TC-specific in a single HTML block, common rows first | Matches user's direction. Merges cleanly with existing `mergePrerequisites()` pattern. |
| Per-TC prereq heading | **Canonical: `### Pre-requisite (specific to this TC)`** | Matches what you author today. The old `**Additional Pre-requisite (TC-specific):**` stays supported as a fallback for back-compat. |
| System.Tags creation | **Match-only; never create** | Per user's explicit direction. Tenants without tag-creation permission stay safe. |
| Tag source in draft | **Two sources, precedence title-prefix first**: (a) TC title's first arrow segment if it's a recognized category (Regression/SIT/E2E/Smoke/...); (b) optional `**Tags**` row in TC metadata table | Title-prefix stays the canonical category carrier; explicit `**Tags**` row is for tenant-specific tags beyond the standard set |
| Tag fetch strategy | **Once per push batch**, cache in-memory for the push session | Avoids N API calls for N TCs |
| Tag fetch failure | **Non-blocking** — log warning, continue push without tags | Network / permission errors shouldn't block TC creation |
| Tag format in ADO | **Semicolon-separated** in `System.Tags` (ADO native format) | Standard |
| Flow quality | **Skill + prompt** only — no code changes | Flow shape is a drafting authoring concern, not a data contract |
| Flow format rules | Mermaid when decision logic is crisp; numbered text block with actor→action→state-transition+bracketed variations when Mermaid would mislead | Matches US 1370221 quality |

## Phase 1 — Per-TC Pre-requisite

### 1a. Parser

Extend `parseTcDraftFromMarkdown` in `src/helpers/tc-draft-parser.ts` around line 208 (per-TC section loop) to extract `### Pre-requisite (specific to this TC)` block. Fall back to existing `**Additional Pre-requisite (TC-specific):**` if the new heading is absent (back-compat).

Extract the rows exactly like the common prereq (flat 2-column OR structured multi-column table), populate `tc.prerequisites.preConditions` + optional `tc.prerequisites.preConditionsTable`.

### 1b. Merge logic

The existing `mergePrerequisites()` function (in `tc-drafts.ts` near `createTestCase` invocation) already combines common + per-TC prereqs at push time. Verify it concatenates `preConditions` arrays in order: `[...common, ...tcSpecific]`. If not, fix.

Multi-column table merging — if both common and TC-specific have `preConditionsTable`, concatenate rows with common first; headers must match (common's headers win; TC-specific rows conforming to those headers get appended).

### 1c. Tests

- Per-TC prereq block parses from both `### Pre-requisite (specific to this TC)` AND `**Additional Pre-requisite (TC-specific):**`
- Common + TC-specific concatenate additively in the final ADO HTML
- Empty TC-specific block → common-only HTML (no regression)
- Multi-column tables merge correctly

## Phase 2 — System.Tags (Match-Only)

### 2a. ADO tag fetch helper

New function in `src/ado-client.ts`:
```typescript
async listProjectTags(): Promise<string[]>
```
Calls `GET /_apis/wit/tags?api-version=7.1` (Project-level tag list). Cache the result in-memory for the push session.

### 2b. Draft tag extraction

In parser:
- Auto-extract category from TC title's first arrow segment IF it matches a recognized category set: `["Regression", "SIT", "E2E", "Smoke", "Accessibility", "Performance", "Security"]` (configurable via `conventions.config.json → testCaseDefaults.knownCategories`).
- Additionally extract explicit `**Tags**` row from TC metadata table: `| **Tags** | Regression; Critical |`. Parse as semicolon-separated list.
- Combine both sources; deduplicate.

### 2c. Apply on push

In `createTestCase` (and `updateTestCaseFromParams` for repush):
1. Before first TC push, call `adoClient.listProjectTags()` once; store in the push context.
2. For each TC:
   - Get requested tags (title-extracted + `**Tags**` row).
   - Filter requested tags against fetched ADO tags (case-insensitive match).
   - Matched tags → add to `System.Tags` JSON patch op (semicolon-separated).
   - Unmatched tags → log `[qa_publish_push] Tag '${tag}' not found in project tags; skipped (title-prefix category still applies).`
3. If `listProjectTags()` fails → log warning, push proceeds without tags.

### 2d. Tests

- Existing tag match → applied to `System.Tags`
- Unmatched tag → skipped + warning logged
- Tag fetch API failure → push continues without tags (non-blocking)
- Multiple tags (title category + `**Tags**` row) → deduplicated before matching

## Phase 3 — Flow Authoring Quality

### 3a. Update `qa-test-drafting` skill

Add a new section `## Functionality Process Flow — Authoring Rules` to `.cursor/skills/qa-test-drafting/SKILL.md`:

```markdown
## Functionality Process Flow — Authoring Rules

Every draft must include a `## Functionality Process Flow` section. Choose the format based on the logic being documented:

### Use Mermaid diagrams WHEN:
- The decision logic is clean (single trigger → evaluation → outcome branches)
- All decision points have documented (not inferred) criteria
- The flow fits cleanly in 5-8 nodes (larger diagrams hurt readability)
- Business flow with clear actor → action → system response

### Use numbered text-block format WHEN:
- Decision logic has multiple interacting paths (e.g., Path A + Path B + short-circuit)
- Variations within a flow matter (Variation A, Variation B)
- Mermaid would require too many branches to remain readable
- Configuration-sensitive behavior (e.g., flag TRUE vs FALSE changes everything)

### Required elements in each flow block:
1. **Actor / entry point** — who triggers it (KAM, Admin, System, etc.)
2. **Action chain** — sequential `→` arrows showing steps, indented
3. **Bracketed variations** where applicable: `[Variation A: ...]` `[Variation B: ...]`
4. **Terminal state** — every flow must end with an observable, documented state:
   - `Status: X → Y`
   - `Record locks (read-only)` / `Record stays unlocked (editable)`
   - `Re-Approval fires` / `Stays Adjusted`
5. **Numbered Flow headings** — `### Flow 1 — ...`, `### Flow 2 — ...` for multiple flows

### Quality checks (self-review before saving):
- [ ] Every flow ends with a terminal state, not a "next step" placeholder
- [ ] Bracketed variations cover all documented paths
- [ ] No guessed transitions — if Solution Design doesn't say it, write "(to confirm)"
- [ ] Naming is consistent (same field names, same tool names as Solution Design)

### Reference example (US 1370221):
The draft at `US_1370221_test_cases.md` Flows 1-5 demonstrates the correct format.
```

### 3b. Reinforce in `/qa-draft` prompt

In `src/prompts/index.ts`, `/qa-draft` prompt body, add a reference:

```
...
When building the Functionality Process Flow section, follow the rules in
`.cursor/skills/qa-test-drafting/SKILL.md` §Functionality Process Flow — Authoring Rules.
Use Mermaid only when decision logic is clean; use numbered text blocks for
config-sensitive or multi-path behavior. Every flow must end with a terminal
observable state.
...
```

## Phase 4 — Docs

Update `docs/changelog.md` under Unreleased with a `Fixed` + `Added` combined entry.

Update `docs/examples/cursor-rules/GUIDE.md` — document:
- Per-TC prereq now works end-to-end (additive)
- Tags are match-only (no surprise creations)
- Flow authoring rules are in the drafting skill

## Phase 5 — Deploy

```bash
npm run build
npm test
npm run build:dist
git commit
```

## Success Criteria

1. A draft with `### Pre-requisite (specific to this TC)` pushes both common + TC-specific prereq rows to ADO in a single HTML block
2. A draft with `Regression` title prefix results in ADO TC having `System.Tags: Regression` only if that tag exists in the project; otherwise title-prefix-only (warning logged)
3. Future drafts for any US have flow sections matching the US 1370221 quality (consistent format, terminal states)
4. All existing 186+ tests pass; new tests added per Phase 1c and 2d pass

## Out of Scope

- Creating new ADO tags (explicit non-goal per user direction)
- Changing title format / featureTags handling (title-prefix category remains canonical)
- Syncing Functionality Process Flow / Coverage Checklist / Test Coverage Insights to ADO fields (explicitly kept as draft-only)
- Per-TC Test Data override (deferred — not in scope of your current ask)
- Change detection / diff on repush (separate concern)
