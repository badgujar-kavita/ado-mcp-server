---
name: Multi Test-Type Draft and Publish (Regression / SIT / E2E as First-Class Artifacts)
overview: "Extend /qa-draft to optionally generate separate, pushable markdown files for Regression, SIT, E2E, and other tenant-defined test types — and extend /qa-publish to push them to ADO with proper tags and suite placement. Today, only the main US_<id>_test_cases.md is pushable; supporting test-type files exist as review-only artifacts. This plan makes those artifacts symmetric with the main file: review-able, versionable, pushable, and re-pushable, with each type getting its own ADO tag and (optionally) its own test suite subfolder. Design-first; zero code changes ship in the plan itself."
todos:
  - id: phase0-decide-artifact-model
    content: "Phase 0: Lock the artifact model — decide between (a) one-file with sections, (b) separate files per type, (c) hybrid. Lock category vocabulary. Lock ADO tag convention."
    status: pending
  - id: phase1-config-schema
    content: "Phase 1: Extend conventions.config.json with testTypes block — per-type enablement, filename template, suite placement policy, tag override, required/optional flag"
    status: pending
  - id: phase1-types
    content: "Phase 1: Extend TcDraftData with testType field on each TC and optional typeSection metadata; update TcDraftTestCase"
    status: pending
  - id: phase2-draft-prompt
    content: "Phase 2: Update /qa-draft prompt — detect user-requested test types from the ask (Regression/SIT/E2E/etc), invoke appropriate skill subsections, save per-type drafts"
    status: pending
  - id: phase2-draft-skill
    content: "Phase 2: Extend qa-test-drafting/SKILL.md with subsections for each default test type (Regression, SIT, E2E) + guidance on when to invoke which"
    status: pending
  - id: phase2-draft-save
    content: "Phase 2: Update qa_draft_save to accept optional testType parameter and save per-type file with correct naming — US_<id>_regression_test_cases.md, US_<id>_sit_test_cases.md, etc"
    status: pending
  - id: phase3-parser
    content: "Phase 3: Update tc-draft-parser to accept any US_<id>_*_test_cases.md layout and preserve the test-type derived from the filename"
    status: pending
  - id: phase3-formatter
    content: "Phase 3: Update tc-draft-formatter to include per-type frontmatter (testType field) and render the per-type filename in Supporting Documents section"
    status: pending
  - id: phase3-publish
    content: "Phase 3: Update qa_publish_push to support include parameter (main | regression | sit | e2e | all) and push with correct ADO tag + target suite based on config"
    status: pending
  - id: phase4-draft-list
    content: "Phase 4: Update qa_drafts_list to surface per-type drafts — group by US, show one row per type with status/version"
    status: pending
  - id: phase4-draft-read
    content: "Phase 4: Update qa_draft_read to accept optional testType parameter; default to main"
    status: pending
  - id: phase5-tests
    content: "Phase 5: Add tests — multi-file parse, multi-file push dedupe, tag write, suite placement, filename resolution, repush-per-type"
    status: pending
  - id: phase6-docs
    content: "Phase 6: Update docs/extend-with-cursor-rules.md, docs/implementation.md, docs/testing-guide.md, docs/changelog.md, and website/public/index.html with the new capability"
    status: pending
  - id: phase7-deploy
    content: "Phase 7: Bundle and deploy — npm run build, npm test, npm run build:dist, then ship"
    status: pending
isProject: true
---

# Multi Test-Type Draft and Publish (Regression / SIT / E2E as First-Class Artifacts)

**Priority:** Medium-High — top-of-mind for the QA-lead audience, unlocks regression/SIT/E2E as pushable artifacts
**Estimated Effort:** Medium — ~8 files touched across 7 phases
**Scope:** Draft + publish path for per-test-type TCs. No changes to suite/plan/tc CRUD, no changes to setup or credentials.

---

## Problem Statement

Today, `/qa-draft` generates a single `US_<id>_test_cases.md` that gets pushed to ADO by `/qa-publish`. Users who also want Regression, SIT, or E2E test cases have two sub-par options:

1. **Everything in one file** (per the `extend-with-cursor-rules.md` guidance we shipped) — works, but the draft becomes huge and hard to review at a glance. A reviewer looking specifically at regression coverage must scroll through functional TCs first. For large USs, the one-file approach becomes unwieldy.

2. **Separate file via `qa_draft_doc_save`** (available today for `regression_tests`) — saves to `US_<id>_regression_tests.md` as an advisory/review doc. But it's **not pushable** — `qa_publish_push` only reads `US_<id>_test_cases.md`. So regression TCs stay as markdown, never reach ADO, never get automation coverage, never appear in test runs.

The end-user feedback: *"Regression and SIT test cases ARE real test cases. We want them in ADO. We want them tagged. We want them filterable. We want them in their own suite or flagged inside the US suite. Today we either bloat the main draft or we paste them in manually."*

This plan makes per-test-type TCs first-class citizens of the full lifecycle.

---

## Design Decisions — Proposed, Locked In Phase 0

The following are **proposals**; they become binding after Phase 0 review. Every row below is a decision that shapes later phases.

| Decision | Proposed | Rationale |
|---|---|---|
| Artifact model | **Separate file per type** (`US_<id>_test_cases.md` + `US_<id>_regression_test_cases.md` + `US_<id>_sit_test_cases.md` + `US_<id>_e2e_test_cases.md`) | Each file is independently reviewable. QA leads scan regression without scrolling past functional. Each file has its own `status` frontmatter so types can be approved independently. Large USs stay manageable. The tenant extension guide's one-file approach remains valid for teams that prefer it — no config forces either. |
| Category vocabulary | **Built-in: `main` (no prefix), `regression`, `sit`, `e2e`** — extensible via config | Covers 95% of real usage. Teams can add `smoke`, `accessibility`, `performance`, `security` via config. Kept stable across tenants so tooling/WIQL queries work everywhere. |
| Filename convention | `US_<id>_test_cases.md` (main, unchanged) + `US_<id>_<type>_test_cases.md` (per type) | Existing main file keeps its name for full backward-compat. Per-type files share the `_test_cases.md` suffix so parser recognizes them uniformly. |
| TC title format | **Category prefix as first featureTag** — `TC_<USID>_<NN> -> Regression -> <feature> -> <area> -> <summary>` | Matches the convention locked in `extend-with-cursor-rules.md`. Parser-safe, WIQL-filterable, no code change needed for title parsing. |
| ADO tag on each TC | **Write `System.Tags` = capitalized category** (`Regression`, `SIT`, `E2E`). Main TCs: no tag. Tenant can override per-type. | Enables ADO-native filtering outside WIQL (UI filters, reports, dashboards). Complements the title-prefix convention; both work, tag is the canonical answer. |
| Suite placement | **Flat default** — all pushed TCs land in the same US-level query-based suite. **Optional per-type sub-suite** via config `testTypes.<type>.subSuite: true` — creates `Sprint_N > ParentID | ParentTitle > USID | USTitle > Regression` as a static suite alongside the query-based one. | Flat default preserves existing behavior and team muscle memory. Sub-suite option is for teams that want physical separation in ADO tree. No change to the query-based US suite; it still auto-pulls all `TC_<USID>_` items. |
| Publish command | **Single `/qa-publish` with an `include` argument** (Path 1 from architect's earlier proposal) | Avoids command proliferation. UX: `/qa-publish 12345` (default all types with drafts), or `/qa-publish 12345 --include regression` (one type only). Two-turn flow is avoided: agent infers `include` from what's approved on disk. |
| Approval model | **Per-type `status` frontmatter** — each file tracks its own DRAFT / APPROVED state | Reviewers can approve regression without being forced to approve functional at the same time. `/qa-publish` only pushes types that are APPROVED. |
| Draft workflow entry point | **`/qa-draft` accepts an optional test-type argument** — `/qa-draft 12345` (main only), `/qa-draft 12345 regression sit` (main + both), `/qa-draft 12345 --all` (all configured types) | Default remains "main only" — existing users see no change. Opt-in to additional types. |
| Idempotency | **Per-type ADO ID tracking** — each TC in each file has its own `(ADO #12345)` suffix after first push, driving repush logic | Main + regression + E2E pushes from the same US are independently repushable. |
| Prerequisites + common data | **Shared across types within the same US** — `Common Prerequisites`, `Test Data`, `Story Summary`, `Functionality Process Flow` in the main file only; per-type files reference them by relative link | DRY — don't duplicate persona/config/data across 4 files. Per-type files focus on the TCs themselves. Parser on push can resolve shared sections from the main file. |
| Duplicate-TC preflight | **Per-type** — push of regression checks for existing regression TCs (by WIQL filter on tag OR title prefix), not any TC on the US | Prevents false positives where main TCs exist but regression TCs don't, and vice-versa. |

---

## Scope

### In scope

- New per-test-type markdown files under `tc-drafts/US_<id>/`
- Draft generation (`/qa-draft`) for user-requested types
- Per-type approval via `status` frontmatter
- Publish (`/qa-publish`) reading one or more type files, pushing with correct ADO tag + suite
- `qa_drafts_list` + `qa_draft_read` + `qa_draft_save` multi-type awareness
- Config schema: `conventions.config.json → testTypes`
- Default type vocabulary (`main`, `regression`, `sit`, `e2e`)
- Tenant-extensibility via config for additional types
- Shared prerequisites/test data resolution across types
- Per-type repush

### Out of scope (defer to future)

- Test Runs / Results API integration (execution tracking)
- Automation framework code generation
- Cross-type dependency graphs (regression should block/unblock on failures)
- SIT environment provisioning
- Performance/load test orchestration
- Accessibility audit tooling
- Migration of existing one-file drafts to per-type (tenant does this manually if desired)
- Automatic regression scope computation from Solution Design diff (would be great, but requires semantic diff; out of scope for v1)

---

## Current State (File Anchors)

| Concern | Path | Lines |
|---|---|---|
| Draft save tool | `src/tools/tc-drafts.ts` | 138–193 (`qa_draft_save`) |
| Supporting-doc save (current regression path) | `src/tools/tc-drafts.ts` | 617–654 (`qa_draft_doc_save` — accepts `regression_tests`) |
| Publish push | `src/tools/tc-drafts.ts` | 438–604 (`qa_publish_push`) |
| Path resolution | `src/tools/tc-drafts.ts` | 66–72 (`resolveTestCasesMdPath` — hard-coded to `_test_cases.md`) |
| Draft parser | `src/helpers/tc-draft-parser.ts` | full file |
| Draft formatter | `src/helpers/tc-draft-formatter.ts` | full file |
| Title parser regex | `src/helpers/tc-draft-parser.ts` | 26–40 (accepts categories as featureTags already) |
| `/qa-draft` prompt | `src/prompts/index.ts` | ~215–295 |
| `/qa-publish` prompt | `src/prompts/index.ts` | ~297–360 |
| Drafting skill | `.cursor/skills/qa-test-drafting/SKILL.md` | full file |
| Config types | `src/types.ts` | `ConventionsConfig` interface |
| Tenant rules guide | `docs/extend-with-cursor-rules.md` | full file |

---

## Phase 0 — Lock the Artifact Model

**Before any code change, commit to the decisions above.** Specifically:

1. **Separate files per type?** Confirm YES. Alternative: hybrid (main file has `## Regression Scenarios` subsection + optional separate file). Hybrid is more complex; separate is cleaner.
2. **Category vocabulary?** `main` / `regression` / `sit` / `e2e` built-in. Anything else?
3. **ADO tag convention?** `System.Tags` = `Regression` / `SIT` / `E2E`. Multi-tag (e.g., `Regression; Critical`) — allowed? **Proposed:** tenant controls via `testTypes.<type>.extraTags: ["Critical"]` in config.
4. **Suite placement default?** Flat (query-based US suite pulls all). Sub-suite is opt-in via config.
5. **Approval model?** Per-type `status` frontmatter.
6. **`include` parameter default?** "all approved" — `/qa-publish 12345` pushes every type whose draft is APPROVED.

**Exit criterion for Phase 0:** a signed-off copy of the Design Decisions table at the top. Changes to these decisions require amending this plan, not inventing in code.

---

## Phase 1 — Config + Types

### 1a. `conventions.config.json` schema extension

Add an optional `testTypes` block:

```jsonc
{
  "testTypes": {
    "regression": {
      "enabled": true,
      "filenameSuffix": "regression_test_cases",
      "tcTitlePrefix": "Regression",
      "adoTags": ["Regression"],
      "subSuite": false,
      "subSuiteName": "Regression",
      "description": "Re-verification of existing behavior"
    },
    "sit": {
      "enabled": true,
      "filenameSuffix": "sit_test_cases",
      "tcTitlePrefix": "SIT",
      "adoTags": ["SIT"],
      "subSuite": false,
      "subSuiteName": "SIT",
      "description": "System integration test"
    },
    "e2e": {
      "enabled": true,
      "filenameSuffix": "e2e_test_cases",
      "tcTitlePrefix": "E2E",
      "adoTags": ["E2E"],
      "subSuite": false,
      "subSuiteName": "E2E",
      "description": "End-to-end business journey"
    },
    "smoke": {
      "enabled": false,
      "filenameSuffix": "smoke_test_cases",
      "tcTitlePrefix": "Smoke",
      "adoTags": ["Smoke"],
      "subSuite": false,
      "subSuiteName": "Smoke",
      "description": "Fast-running sanity checks"
    }
  }
}
```

**Design notes:**

- `testTypes` is **optional** — absence means current behavior (main-only).
- Each type is either enabled (eligible for draft + push) or disabled.
- Tenants can disable default types (`regression.enabled: false`) or enable the bundled `smoke` type.
- Tenants can add custom types (`accessibility`, `performance`, etc.) — just a new key.
- `tcTitlePrefix` is what the agent writes as the first featureTag — stays in sync with the title-parser convention.
- `adoTags` is an array so teams can auto-tag `["Regression", "Critical"]` if desired.

### 1b. `src/types.ts` — extend `TcDraftData` + `ConventionsConfig`

- Add `testType?: "main" | "regression" | "sit" | "e2e" | string` to `TcDraftData`. Default: `"main"`.
- Add `testType?: string` to each `TcDraftTestCase` — optional per-TC override (rarely used; file-level default is sufficient).
- Add `TestTypeConfig` interface + `testTypes?: Record<string, TestTypeConfig>` on `ConventionsConfig`.
- Add Zod schema in `src/config.ts` for the new block.

### 1c. Backward compatibility

- Existing drafts with no `testType` frontmatter are treated as `"main"` — no migration needed.
- Config without `testTypes` block — all types default to disabled; `/qa-draft` and `/qa-publish` behave exactly as today.

---

## Phase 2 — Draft Flow

### 2a. `/qa-draft` prompt updates

Update the prompt in `src/prompts/index.ts` to:

1. **Detect user intent.** Parse the user's ask for test-type keywords:
   - *"draft test cases for US 12345"* → main only
   - *"draft test cases including regression"* → main + regression
   - *"draft SIT cases for 12345"* → sit only
   - *"draft all types for 12345"* → main + every enabled type in config
2. **Ask when ambiguous.** *"I'll draft the main test cases. Should I also include regression, SIT, or E2E? Reply with a comma-separated list, 'all', or 'main only'."*
3. **Invoke the skill section for each type.** Each type has its own subsection (see 2b).
4. **Save per-type files.** Call `qa_draft_save` once per type with the `testType` arg.
5. **Report the artifact list.** *"Created 4 files: main, regression, SIT, E2E. Review and set `status: APPROVED` on each file you're ready to push."*

### 2b. `qa-test-drafting/SKILL.md` extension

Add three subsections (and a pattern for teams to add more):

#### §Regression Test Case Preparation

- When to generate: Solution Design mentions changes to existing behavior; US mentions a refactor, optimization, or bug fix; US has `Custom.IsRegressionRequired = true` (or project-defined flag)
- Scope: re-verify behavior that existed before the change
- Title format: `TC_<USID>_<NN> -> Regression -> <feature> -> <area> -> <summary>`
- Priority: same as functional unless explicit policy override
- Coverage floors: positive + negative + boundary per impacted behavior

#### §System Integration Test (SIT) Preparation

- When to generate: US touches any external system (API, webhook, file, event)
- Scope: per-integration — happy, retry, failure, timeout
- Title format: `TC_<USID>_<NN> -> SIT -> <external-system> -> <interaction-type> -> <summary>`
- Pre-requisites: integration connectivity, mock mode disabled, auth tokens current

#### §End-to-End (E2E) Preparation

- When to generate: US spans multiple personas/modules; full business journey; revenue-critical
- Scope: end-state validation (invoice total, confirmation page, report row)
- Title format: `TC_<USID>_<NN> -> E2E -> <primary-persona> -> <journey-name> -> <summary>`
- Priority: default to 1 (downgrade only with justification)

### 2c. `qa_draft_save` tool signature

Extend input schema:

```typescript
{
  userStoryId: z.number().int().positive(),
  testType: z.enum(["main", "regression", "sit", "e2e"]).optional().default("main"),
  // …other existing fields unchanged
}
```

**Behavior:**

- `testType === "main"` → saves to `US_<id>_test_cases.md` (existing path).
- `testType === "regression"` → saves to `US_<id>_regression_test_cases.md` (new).
- Accepts any type defined in `testTypes` config — the config key is the `testType` value.
- Enforces `testTypes.<type>.enabled === true`; errors clearly if disabled.

**Shared section resolution:**

- Only the `main` file contains `## Common Prerequisites`, `## Test Data`, `## Story Summary`, `## Functionality Process Flow`.
- Per-type files have a short `## Shared Context` block with a markdown link to the main file: *"Common prerequisites, test data, and story context live in [US_12345_test_cases.md](./US_12345_test_cases.md#common-prerequisites)."*
- If main file doesn't exist yet when saving regression, warn: *"Save the main draft first so shared context is anchored. Falling back to inline shared sections."* Optionally inline shared sections in the regression file for self-containment.

---

## Phase 3 — Parser + Formatter + Publish

### 3a. `resolveTestCasesMdPath` generalization

Today:
```typescript
function resolveTestCasesMdPath(tcDraftsDir: string, usId: number): string {
  const subPath = join(resolveUsFolder(tcDraftsDir, usId), `US_${usId}_test_cases.md`);
  // …
}
```

Proposed:
```typescript
function resolveTestCasesMdPath(
  tcDraftsDir: string,
  usId: number,
  testType: string = "main"
): string {
  const suffix = testType === "main"
    ? "test_cases"
    : getTestTypeFilenameSuffix(testType); // from config
  const fileName = `US_${usId}_${suffix}.md`;
  const subPath = join(resolveUsFolder(tcDraftsDir, usId), fileName);
  if (existsSync(subPath)) return subPath;
  // Legacy flat fallback only for main
  if (testType === "main") {
    const flatPath = join(tcDraftsDir, fileName);
    if (existsSync(flatPath)) return flatPath;
  }
  return subPath;
}
```

### 3b. Parser (`tc-draft-parser.ts`) updates

- Accept a new optional argument: `testType` (default `"main"`).
- Parse frontmatter for a `testType` field, warn if filename and frontmatter disagree.
- For per-type files, skip parsing `## Common Prerequisites`, `## Story Summary`, etc. — fetch those from the main file instead (if present) OR inline (if the file declares `selfContained: true` in frontmatter).

### 3c. Formatter (`tc-draft-formatter.ts`) updates

- When `data.testType !== "main"`, render:
  - Title: `# Test Cases: US #<id> — <storyTitle> — <Category>` (e.g., *"Test Cases: US #12345 — Promotion Plan — Regression"*)
  - Shared Context section with link to main file
  - No persona/prereq duplication
- When `data.testType === "main"`, render as today (unchanged).

### 3d. `qa_publish_push` extension

Add input params:
```typescript
{
  userStoryId: z.number().int().positive(),
  include: z.enum(["main", "regression", "sit", "e2e", "all"]).optional().default("all"),
  workspaceRoot: z.string().optional(),
  draftsPath: z.string().optional(),
  repush: z.boolean().optional(),
  insertAnyway: z.boolean().optional(),
}
```

**Behavior with `include: "all"` (default):**

1. Scan `tc-drafts/US_<id>/` for all per-type files.
2. For each file with `status: APPROVED`, parse + queue.
3. Run duplicate preflight **per type** — filter ADO linked TCs by `System.Tags` matching the type's tag. If conflict, return A/B/C prompt per current behavior, mentioning the type.
4. Execute all queued pushes in order: main first, then regression, SIT, E2E.
5. On success, update each file's frontmatter `status: APPROVED` and embed `(ADO #N)` into each TC title.
6. Report: per-type summary (*"Pushed 5 main + 3 regression + 2 SIT = 10 test cases"*).

**Behavior with `include: "regression"` (explicit single type):**

Same as above but only for regression. Useful for sequential review workflows where main was approved last week and regression is being added this week.

**Suite placement:**

- **Default:** all TCs go to the US-level query-based suite (no change from today).
- **Sub-suite mode** (`testTypes.<type>.subSuite: true`): before push, ensure a static sub-suite under the US query-based suite, named per config. Add TCs to it explicitly after creation.

**ADO tag writing:**

Each TC gets `System.Tags` set according to `testTypes.<type>.adoTags` joined with `; ` (ADO's convention). Main TCs: no tag written (preserves existing behavior).

### 3e. Repush per type

- Repush is per-file — `repush: true` when calling `qa_publish_push` with `include: "regression"` updates only regression TCs.
- `include: "all"` + `repush: true` repushes every APPROVED type where the file's TCs all have `(ADO #N)`.
- Error case: repush requested but some types have TCs without ADO IDs → clear error pointing to which type needs a first-time push.

---

## Phase 4 — List / Read Integration

### 4a. `qa_drafts_list`

Update to show per-type rows:

```markdown
| US | Story Title | Type | Status | Version | ADO IDs |
|---|---|---|---|---|---|
| 12345 | Promotion Plan | main | APPROVED | 3 | 5/5 pushed |
| 12345 | Promotion Plan | regression | DRAFT | 1 | 0/3 |
| 12345 | Promotion Plan | sit | DRAFT | 2 | 0/2 |
| 67890 | Order Flow | main | DRAFT | 1 | 0/8 |
```

Grouped by US, sorted by type (`main` first, then alphabetical).

### 4b. `qa_draft_read`

Accept optional `testType` parameter:
- `qa_draft_read(userStoryId: 12345)` → returns main (current behavior)
- `qa_draft_read(userStoryId: 12345, testType: "regression")` → returns regression file
- If the requested type doesn't exist for that US, return a helpful error listing which types DO exist.

---

## Phase 5 — Tests

**Framework:** `node:test` (already in repo).

**Must-cover cases:**

| Area | Tests |
|---|---|
| Filename resolution | Each type returns correct path; legacy flat layout still works for main |
| Config loading | Missing `testTypes` → all disabled; enabled=false → save refuses; unknown type → refuses |
| Draft save | Multi-type drafts coexist in same US folder; main → regression save order works in either direction |
| Parser | Multi-file parse; shared context resolution from main; frontmatter/filename disagreement warning |
| Formatter | Per-type file shape; shared-context link renders; main file unchanged |
| Publish push | `include: "all"` pushes all APPROVED; skips DRAFT; errors on type-without-approval-required |
| Tag writing | `System.Tags` set correctly per type; multi-tag case; empty tag for main |
| Suite placement | Flat default works; sub-suite mode creates static sub-suite; idempotent on rerun |
| Duplicate preflight | Per-type filtering — main TCs don't false-trigger regression preflight |
| Repush per type | Regression repush doesn't touch main; `include: "all"` repushes all types |
| Backward compat | US with only `US_<id>_test_cases.md` (no per-type files) behaves exactly as today |

---

## Phase 6 — Docs

### 6a. Update `docs/extend-with-cursor-rules.md`

- New section: "**Test type configuration via `conventions.config.json` (server-native) vs `.cursor/rules` (agent-driven)**"
- Contrast: config is for enabling types and setting tags/suites; rules are for coverage policy within a type
- Update the regression/SIT/E2E examples to mention the new native support — tenants pick the model that fits

### 6b. Update `docs/implementation.md`

- Add "Multi Test-Type Support" subsection covering file layout, config schema, push behavior, suite placement
- Update tool descriptions: `qa_draft_save`, `qa_draft_read`, `qa_drafts_list`, `qa_publish_push`

### 6c. Update `docs/testing-guide.md`

- Add worked example: drafting main + regression + SIT + E2E for a US; reviewing each; approving; pushing

### 6d. Update `docs/changelog.md`

- New Unreleased entry describing the capability, the config block, the filename convention

### 6e. Update `website/public/index.html`

- Update `/qa-draft` and `/qa-publish` descriptions to mention the `testType` and `include` params
- Add a "Multi test-type support" card/section

---

## Phase 7 — Deploy

```bash
npm run build
npm test
npm run build:dist
```

Smoke test end-to-end on a real US: draft main + regression → review both → push both → verify TCs in ADO with correct tags.

---

## Guardrails (Cross-Cutting)

| Concern | Rule |
|---|---|
| Zero behavior change when config is absent | `testTypes` block absent → main-only, exactly as today |
| Zero behavior change for existing drafts | No frontmatter `testType` → treated as main; filename recognition is primary signal |
| Destructive-action protection | All existing safeguards apply to per-type pushes (YES confirmation, duplicate preflight, delete gate) |
| ADO tag integrity | Never write a tag for main TCs; never add a tag unless the type's config defines `adoTags[]` |
| Suite integrity | Sub-suite mode creates sub-suites; never collapses main TCs into a sub-suite |
| Idempotency | Per-type push is idempotent: repeating a push produces the same ADO IDs, no duplicates |
| File recovery | Never delete a per-type markdown on publish failure; draft state is preserved on any error |
| Rollback | `git revert` of any single phase is safe; later phases depend only on earlier phases in sequence |
| Shared-context resolution | Per-type files without a main file can still push — just with shared sections inlined |

---

## Open Questions (to resolve during Phase 0 review)

1. **Approval granularity.** Should per-type `status: APPROVED` be independent (proposed), or should the main file gate everything (all types block on main approval)? The proposed independent model is more flexible but means a reviewer could push regression before the functional TCs are reviewed — is that acceptable?

2. **Sub-suite default.** Is flat (everything in the US query-based suite) the right default? Or should sub-suite be default for regression (since teams often run regression separately)?

3. **TC numbering.** Should regression/SIT/E2E continue the main numbering (regression starts at `06` if main ends at `05`), or reset per type (each type starts at `01`)? Continuing numbering is unique-per-US; resetting is more readable but can collide if not careful.

4. **Custom types naming.** When a tenant adds `accessibility` to `testTypes`, the filename becomes `US_<id>_accessibility_test_cases.md`. Reasonable? Should we enforce a snake_case or allow kebab?

5. **Tag multiplicity.** Should `adoTags` be a single string (simple) or an array (supports `["Regression", "Critical"]`)? The proposed array is more flexible but writes `Regression; Critical` to `System.Tags`, which is ADO-valid but more surface.

6. **What about `qa-clone` for per-type TCs?** If a tenant clones TCs from source US to target US, should per-type drafts also clone? Proposed: yes, preserve the source TC's test type in the target draft. Needs confirmation.

7. **Interaction with `extend-with-cursor-rules.md`'s one-file pattern.** The tenant guide shipped with the title-prefix convention as the canonical answer. Should this plan deprecate that guidance (explicit files are now preferred) or keep both as viable options? **Proposed:** keep both — config-driven per-type files for teams that want it, rule-driven title prefixes for teams that prefer one-file simplicity.

---

## Success Criteria

The plan is **done** when:

1. A QA lead can run `/qa-draft 12345 regression sit` and get three separate markdown files (main, regression, SIT) in `tc-drafts/US_12345/`.
2. Each file has its own `status` frontmatter, reviewable independently.
3. Running `/qa-publish 12345` pushes every APPROVED type to ADO with correct `System.Tags` and correct suite placement.
4. Running `/qa-publish 12345 --include regression` pushes only regression.
5. `qa_drafts_list` shows a clear per-type summary.
6. All 166+ existing tests still pass, plus ~20 new tests covering the multi-type paths.
7. `docs/extend-with-cursor-rules.md` cross-references this capability; tenants can choose config-driven or rule-driven.
8. Zero regressions for tenants who haven't configured `testTypes`.

---

## Files Changed Across All Phases

| File | Change |
|---|---|
| `conventions.config.json` | Add `testTypes` block (optional) |
| `src/types.ts` | Extend `TcDraftData`, `TcDraftTestCase`, `ConventionsConfig` |
| `src/config.ts` | Zod schema for `testTypes` |
| `src/helpers/tc-draft-parser.ts` | Per-type filename resolution; shared-context resolution |
| `src/helpers/tc-draft-formatter.ts` | Per-type rendering; shared-context link |
| `src/tools/tc-drafts.ts` | `qa_draft_save` / `qa_draft_read` / `qa_drafts_list` / `qa_publish_push` — all accept testType/include |
| `src/tools/test-suites.ts` | Optional sub-suite creation helper |
| `src/tools/test-cases.ts` | Write `System.Tags` on create (when provided by caller) |
| `src/prompts/index.ts` | Update `/qa-draft` and `/qa-publish` prompts for multi-type |
| `.cursor/skills/qa-test-drafting/SKILL.md` | Add §Regression / §SIT / §E2E subsections |
| `src/**/*.test.ts` | New tests for multi-type flow |
| `docs/extend-with-cursor-rules.md` | Cross-reference the config-driven path |
| `docs/implementation.md` | New "Multi Test-Type Support" section |
| `docs/testing-guide.md` | Worked example |
| `docs/changelog.md` | Entry |
| `website/public/index.html` | Updated descriptions + new section |
| `npm run build` + `npm test` + `npm run build:dist` | Per workspace rule |

---

## Risks + Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Parser regression breaks existing drafts | High — every publish is affected | Preserve exact legacy behavior when no per-type files present; run every existing test before shipping; canary on a known-good US |
| ADO tag write fails silently | Medium — silent quality degradation | Verify tag in response after create; surface failure to user |
| Sub-suite creation race | Low — parallel pushes | Sub-suite setup happens under the existing suite hierarchy lock; idempotent find-or-create |
| Config schema drift | Low — zod validation | Zod throws with clear message on bad config; config documented in setup-guide |
| Tenants confused by two patterns (one-file rules + per-type files) | Medium — DX cost | Explicit decision tree in `extend-with-cursor-rules.md`: *"Want a single reviewable file with inline categories? Use title-prefix rules. Want separate files per type? Enable `testTypes` in config."* |
| Repush per type invalidates main | Medium — accidental overwrite | Per-type isolation; each file tracks its own ADO IDs; main file never touched by a regression-only push |

---

## Verification (end-to-end)

1. `npm run build` — clean compile.
2. `npm test` — all existing tests pass; ~20 new tests pass.
3. Manual: draft main for a known US, review, push. Existing behavior unchanged.
4. Manual: draft main + regression for a known US, review both, push both. Two files, two `status: APPROVED`, two sets of TCs in ADO with correct tags.
5. Manual: push only regression (already-reviewed main stays untouched).
6. Manual: revise regression, repush with `include: "regression"` + `repush: true` — existing regression TCs updated, main untouched.
7. Manual: enable `subSuite: true` on regression in config; push; verify a `Regression` static sub-suite appears under the US query-based suite with the regression TCs inside.
8. Manual: disable `testTypes` block entirely; run `/qa-draft` and `/qa-publish` — exact old behavior.
9. Manual: run on a fresh US with no prior drafts; confirm main + per-type files all coexist correctly.
10. Read the diff against `main` — any file touched in a phase it wasn't supposed to? If yes, rebase.

---

## Appendix — Alternative paths considered

### Path considered — Hybrid (main file with inline subsections + optional separate files)
**Rejected** because the complexity of having regression TCs in two places (main file section + separate file) creates sync issues. Users would edit one but forget the other. Cleaner to pick a single source of truth per type.

### Path considered — Separate `/qa-publish-regression` command per type
**Rejected** because it proliferates commands (one per type). A tenant enabling `smoke` would expect `/qa-publish-smoke` and we'd have to dynamically register commands based on config. The `--include` argument on the single command is cleaner.

### Path considered — Tag-only approach (one file, use `System.Tags` to categorize in ADO)
**Valid and already documented** in `extend-with-cursor-rules.md`. This plan doesn't replace it — it adds the config-driven separate-file option alongside it. Tenants pick based on team preference.

### Path considered — Always write `System.Tags` (even for main, e.g., `Functional`)
**Rejected** for default behavior because it changes every existing team's ADO workflow. Main TCs stay tag-less by default. Teams that want a `Functional` tag can set `testTypes.main.adoTags: ["Functional"]` — proposed as a future config extension.
