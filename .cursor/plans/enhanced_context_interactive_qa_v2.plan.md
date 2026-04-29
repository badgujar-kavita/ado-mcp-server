---
name: Enhanced Context Interactive QA v2
overview: "Read all meaningful fields from the User Story work item, fetch all linked Confluence pages across all context fields, surface a Source Discovery Report before drafting, and give the user a single clean coverage decision gate. Optional US signals (Priority, Risk, Tags) are always read and shown but only applied when explicitly requested."
todos:
  - id: prereq-field-names
    content: "Run list_work_item_fields to confirm exact ADO reference names for Impact Assessment, Reference Documentation, Priority, Risk, Tags"
    status: pending
  - id: phase1-config
    content: "Phase 1a: Add additionalContextFields (ImpactAssessment, ReferenceDocumentation) and optionalSignalFields (Priority, Risk, Tags) to conventions.config.json, types.ts, config.ts"
    status: pending
  - id: phase1-links
    content: "Phase 1b: Add extractAllLinks() with URL categorization to confluence-url.ts — extract ALL links from ALL context fields, not just first"
    status: pending
  - id: phase1-errors
    content: "Phase 1c: Add typed Confluence errors (401/403/404) to confluence-client.ts"
    status: pending
  - id: phase1-workitems
    content: "Phase 1d: Rewrite extractUserStoryContext() to read all context fields + optional signal fields, fetch all Confluence pages, collect unfetched links"
    status: pending
  - id: phase1-types
    content: "Phase 1e: Update UserStoryContext with solutionDesignPages[], unfetchedLinks[], additionalContext{}, optionalSignals{}"
    status: pending
  - id: phase2-prompt
    content: "Phase 2a: Update draft_test_cases prompt — Source Discovery Report, single coverage mode gate, optional signals display, UX formatting rules"
    status: pending
  - id: phase2-skill
    content: "Phase 2b: Update SKILL.md — interactive consultant role, decision gates, optional signals usage rules, traceability step"
    status: pending
  - id: phase3-traceability
    content: "Phase 3: Add traceability matrix to draft formatter, parser, and schema"
    status: pending
  - id: phase4-docs
    content: "Phase 4: Update implementation.md, testing-guide.md, changelog.md, deploy"
    status: pending
isProject: true
---

# Enhanced Context Interactive QA Workflow v2

**Priority:** High
**Estimated Effort:** Medium-Large (16+ files across 4 phases)
**Based on:** enhanced_context_interactive_qa_ca5f696d.plan.md (original)
**Changes from original:** Added optional signal fields (Priority, Risk, Tags), clarified user control model, removed linked work item reading, resolved open questions.

---

## Problem Statement

The current `get_user_story` and `draft_test_cases` workflow has these gaps:

1. **Missing ADO fields** — only reads `Custom.TechnicalSolution`. Does NOT read `Impact Assessment`, `Reference Documentation`, `Priority`, `Risk`, or `Tags`.
2. **Single Confluence link** — only fetches the FIRST Confluence URL from a field. If a field has 3 links, 2 are silently ignored.
3. **Silent failures** — non-Confluence links (SharePoint, Figma, LucidChart, Google Drive) are silently dropped with no notification.
4. **No cross-instance detection** — Confluence links on a different Atlassian instance fail silently.
5. **No interactive consultation** — AI proceeds with whatever data it has, making assumptions instead of consulting the user.
6. **No traceability** — test cases are not anchored back to source documents.
7. **Optional signals unused** — Priority, Risk, Tags are available on the US but never read, even when explicitly requested.

---

## Scope: Only User Story Fields

**This plan reads only from the User Story work item itself.** No linked items, no parent Epics, no child Tasks, no linked Bugs.

Rationale:
- A well-written US should be self-contained with its own AC
- Implementation details (Tasks) should not drive test design — tests verify behaviour, not implementation
- Linked Bugs belong in regression suites, not functional TC drafts
- Parent Epic context is too broad and risks pulling test design off-requirements

The only external fetch allowed is **Confluence pages linked inside US fields** — because those pages are explicitly referenced by the US author as relevant context.

---

## Fields to Read from User Story

### Core Context Fields (Always Read)

These are the primary input for test case generation:

| Field | Reference | Purpose |
|---|---|---|
| Title | `System.Title` | Feature being tested |
| Description | `System.Description` | Additional context beyond AC — read as content source, not just prerequisites fallback |
| Acceptance Criteria | `Microsoft.VSTS.Common.AcceptanceCriteria` | Primary source — defines what must pass |
| Solution Notes | `Custom.TechnicalSolution` | Technical behaviour — drives prerequisites and step logic |
| Area Path | `System.AreaPath` | Suite routing and plan mapping |
| Iteration Path | `System.IterationPath` | Sprint folder |
| State | `System.State` | Draft metadata |

### Additional Context Fields (Configurable, Always Read if Configured)

Defined in `conventions.config.json` under `additionalContextFields`:

| Field | Reference | Purpose |
|---|---|---|
| Impact Assessment | `Custom.ImpactAssessment` | What else breaks if this goes wrong — drives negative and regression TCs |
| Reference Documentation | `Custom.ReferenceDocumentation` | External specs, wireframes, uploaded docs — additional scenario source |

> **PREREQUISITE:** Run `list_work_item_fields` to confirm exact ADO reference names before implementing.

These are already proposed in the original plan. No change here.

### Optional Signal Fields (Always Read, Only Applied When User Requests)

| Field | Reference | Signal Value | When Applied |
|---|---|---|---|
| Priority | `Microsoft.VSTS.Common.Priority` | P1-2 = broader coverage; P3-4 = focused happy path | Only when user explicitly asks |
| Risk | `Microsoft.VSTS.Common.Risk` | High = more negative/boundary TCs; Low = happy path dominant | Only when user explicitly asks |
| Tags | `System.Tags` | Domain tags, feature flags, regression markers — influence TC featureTags and categorisation | Only when user explicitly asks |

**Why optional application:**
Teams use these fields inconsistently. Some teams set Priority 1 on everything. Some never set Risk. Auto-applying them would produce wrong TC coverage for teams that don't use them rigorously. Reading them always but applying only on request gives teams that use them well the benefit, without penalising teams that don't.

**How user requests application:**
Natural language in prompt:
- "Use Priority and Risk to determine coverage depth"
- "Apply US tags to TC feature tags"
- "Use all US signals"

If not mentioned — values appear in Source Discovery Report only. No effect on generation.

---

## Phase 1: Backend — Multi-Field and Multi-Link Support

### 1a. Config: Additional and Optional Signal Fields

**[conventions.config.json](conventions.config.json):**

```json
{
  "additionalContextFields": [
    {
      "adoFieldRef": "Custom.ImpactAssessment",
      "label": "Impact Assessment",
      "fetchLinks": true
    },
    {
      "adoFieldRef": "Custom.ReferenceDocumentation",
      "label": "Reference Documentation",
      "fetchLinks": true
    }
  ],
  "optionalSignalFields": {
    "priority": {
      "adoFieldRef": "Microsoft.VSTS.Common.Priority",
      "enabled": true
    },
    "risk": {
      "adoFieldRef": "Microsoft.VSTS.Common.Risk",
      "enabled": true
    },
    "tags": {
      "adoFieldRef": "System.Tags",
      "enabled": true
    }
  }
}
```

**[src/types.ts](src/types.ts):** Add `AdoContextField`, `OptionalSignalFields` interfaces, update `ConventionsConfig`.

**[src/config.ts](src/config.ts):** Add Zod schema for both `additionalContextFields` and `optionalSignalFields`. Both optional — if absent, system behaves exactly as before.

### 1b. URL Extraction: All Links from All Fields

**[src/helpers/confluence-url.ts](src/helpers/confluence-url.ts)** — add `extractAllLinks()`:

```typescript
type ExternalLinkType = "Confluence" | "SharePoint" | "Figma" | "LucidChart" | "GoogleDrive" | "Other";

interface CategorizedLink {
  url: string;
  type: ExternalLinkType;
  pageId?: string;
  sourceField: string;   // which ADO field this link came from
}

function extractAllLinks(rawValue: string, sourceField: string): CategorizedLink[]
```

Detection rules:
- `atlassian.net` → Confluence
- `sharepoint.com` / `office.com` → SharePoint
- `figma.com` → Figma
- `lucid.app` / `lucidchart.com` → LucidChart
- `drive.google.com` → GoogleDrive
- Everything else → Other

Keep existing `extractConfluencePageId()` and `extractConfluenceUrl()` for backward compatibility.

### 1c. Typed Confluence Errors

**[src/confluence-client.ts](src/confluence-client.ts)** — update `getPageContent()` to throw typed errors:

```typescript
class ConfluenceError extends Error {
  constructor(
    message: string,
    public status: 401 | 403 | 404 | number,
    public pageId: string
  ) { super(message); }
}
```

Callers can now distinguish:
- `401` — Auth failure (wrong email/token)
- `403` — Access denied (page exists, user lacks permission)
- `404` — Page not found (deleted or wrong ID)

### 1d. Multi-Field Reading and Multi-Page Fetching

**[src/tools/work-items.ts](src/tools/work-items.ts)** — rewrite `extractUserStoryContext()`:

1. Read all core context fields
2. Read each `additionalContextFields` entry — extract text + all links
3. Read all `optionalSignalFields` — store raw values in `optionalSignals{}`
4. For each field with `fetchLinks: true`:
   - Extract ALL links via `extractAllLinks()`
   - Cross-instance check: compare hostname to configured `confluence_base_url`
   - For Confluence links on same instance: fetch page content
   - For Confluence links on different instance: add to `unfetchedLinks[]` with "cross-instance" reason
   - For non-Confluence links (SharePoint, Figma, etc.): add to `unfetchedLinks[]` with type and workaround message
5. Collect all fetched pages in `solutionDesignPages[]`
6. Store raw text from additional fields in `additionalContext{}`

### 1e. Updated Response Types

**[src/types.ts](src/types.ts)** — update `UserStoryContext`:

```typescript
interface FetchedPage {
  pageId: string;
  title: string;
  content: string;
  sourceField: string;
  url: string;
}

interface UnfetchedLink {
  url: string;
  type: ExternalLinkType;
  sourceField: string;
  reason: "cross-instance" | "non-confluence" | "access-denied" | "not-found" | "auth-failure";
  workaround: string;
}

interface OptionalSignals {
  priority?: number;         // 1-4
  risk?: string;             // "High" | "Medium" | "Low" | "1 - Critical" etc.
  tags?: string[];           // parsed from semicolon-delimited string
}

// Add to UserStoryContext:
solutionDesignPages: FetchedPage[];
unfetchedLinks: UnfetchedLink[];
additionalContext: Record<string, string>;
optionalSignals: OptionalSignals;

// Keep deprecated (backward compat):
solutionDesignUrl?: string;
solutionDesignContent?: string;
```

---

## Phase 2: Prompt and Skill — Interactive QA Workflow

### 2a. Role and Core Principle

**Role:** AI QA Architect and Lead QA Consultant. Interactive consultant, not a script runner.

**Core Principle:** Prioritise transparency and user agency. Never assume about data sources or coverage decisions. Surface what was found, let the user confirm, then proceed.

### 2b. Source Discovery Report

After `get_user_story` is called, always present a Source Discovery Report before drafting:

```
📋 Source Discovery Report — US #12345: <Title>

Context Fields Found:
✅ Acceptance Criteria — present
✅ Solution Notes (Custom.TechnicalSolution) — present, 1 Confluence page fetched
✅ Impact Assessment — present, no links
⚠️  Reference Documentation — present, 1 SharePoint link (cannot auto-fetch)
ℹ️  Description — present, used as supplementary context

Confluence Pages Fetched:
✅ [Solution Design v2] — https://... (from Solution Notes)

Links Requiring Manual Action:
⚠️  SharePoint: https://... (from Reference Documentation)
    → Export as PDF and paste content into chat, or proceed without it

Optional Signals (not applied unless you request):
   Priority: 2 (High)
   Risk: High
   Tags: KAM, Promotion, Regression
```

**If any field is empty:**
```
⚠️  Impact Assessment — empty
    → Proceeding without it. If this US has cross-functional impact, consider adding it before drafting.
```

### 2c. Single Coverage Mode Gate

After Source Discovery Report, present one decision before drafting:

```
Coverage Mode for US #12345:

  A) Comprehensive  — full positive, negative, boundary, and failure-path TCs (recommended: Priority 2, Risk High)
  B) Focused        — happy path + critical negatives only
  C) Edge-case      — boundary conditions and failure paths only

Press Enter to accept recommendation [A], or type B or C to override.

Optional: Add "use signals" to apply Priority, Risk, and Tags to generation decisions.
```

This is the **only question asked per US**. One keystroke to accept the recommendation. Full control if needed.

### 2d. Optional Signals Application

When user includes "use signals" or "use Priority/Risk/Tags":

| Signal | Effect on Generation |
|---|---|
| Priority 1-2 | Lean toward Comprehensive mode if not already set |
| Priority 3-4 | Lean toward Focused mode if not already set |
| Risk = High | Increase negative/boundary TC count by ~30% |
| Risk = Low | Reduce negative TC count, focus on happy path |
| Tags contain "regression" | Add regression markers to relevant TCs |
| Tags contain domain terms | Use as featureTags in TC titles automatically |

When NOT requested — signals shown in Source Discovery Report only. Zero effect on generation.

### 2e. Accuracy and Confidence Rules

- Cross-reference all fetched sources — highlight conflicts between AC and Solution Design as **Functional Gaps**
- Mark unclear or missing requirements as **TBD — Information Required** instead of guessing
- Confidence levels per TC:
  - **100%** — Directly from Acceptance Criteria
  - **90%** — From auto-fetched Confluence page
  - **80%** — From manually uploaded content
  - **70%** — Inferred from context (flag for review)
  - **TBD** — Insufficient information (block on this)

### 2f. UX Formatting Rules

| Indicator | Meaning |
|---|---|
| ✅ | Successfully fetched / resolved |
| ⚠️ | Needs attention / manual action available |
| ❌ | Blocker — cannot proceed without resolution |
| ℹ️ | Informational — no action required |

Use blockquotes for alerts. Use Option A/B paths for forced decisions. Use tables for summaries.

### 2g. Skill Update

**[.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md]** — add:
- Interactive consultant role definition
- Source Discovery Report format
- Single coverage gate format
- Optional signals usage rules
- Traceability step (after TC generation)
- Confidence level assignment rules

---

## Phase 3: Draft Format — Traceability Matrix

### 3a. Formatter

**[src/helpers/tc-draft-formatter.ts](src/helpers/tc-draft-formatter.ts)** — add `traceabilityMatrix` section after test cases:

```markdown
## Traceability Matrix

| TC | Title | Requirement Source | Document | Confidence |
|---|---|---|---|---|
| TC_1234_01 | Create basic promotion | AC Scenario 2 | Acceptance Criteria | 100% |
| TC_1234_02 | Promotion with no categories | Solution Design §3 | [Solution Design v2] | 90% |
| TC_1234_03 | Invalid date range | Inferred from AC | — | 70% |
```

### 3b. Parser

**[src/helpers/tc-draft-parser.ts](src/helpers/tc-draft-parser.ts)** — parse traceability matrix from markdown back to `TcDraftData`.

### 3c. Draft Schema

**[src/tools/tc-drafts.ts](src/tools/tc-drafts.ts)** — add `traceabilityMatrix` to `SaveTcDraftShape` schema. Field is optional — existing drafts unaffected.

### 3d. Traceability Matrix Location

Default: **draft file + chat** — visible during review and permanently stored in the draft.
Can be changed per-team by setting `traceabilityOutput` in `conventions.config.json`:

```json
{
  "traceabilityOutput": "both"   // "both" | "chat-only" | "draft-only"
}
```

---

## Phase 4: Documentation and Deploy

- **[docs/implementation.md](docs/implementation.md)** — update "Solution Design Usage" section with multi-field, multi-link, optional signals documentation
- **[docs/testing-guide.md](docs/testing-guide.md)** — update tool reference table and add Source Discovery Report section
- **[docs/changelog.md](docs/changelog.md)** — add changelog entry
- Run `npm run deploy` to Google Drive after all changes

---

## Resolved Decisions (vs Original Plan)

| Question | Decision | Rationale |
|---|---|---|
| Read linked work items? | No — US only | Linked items (Tasks, Bugs, Epic) are out of scope. Tests derive from requirements, not implementation. |
| Priority/Risk/Tags auto-applied? | No — shown always, applied only on request | Teams use these fields inconsistently — auto-applying risks wrong coverage for teams that don't use them rigorously |
| Traceability matrix location | Both draft + chat (configurable) | Visible during review AND permanently stored |
| Execution Plan gate on revisions | Always show by default (configurable in conventions.config.json) | Safer default — user can turn off |
| Confidence threshold | Fixed levels (100/90/80/70/TBD) — no user-set % | Users think in labels, not percentages |
| External link blocking | Alert + workaround for all non-Confluence — no user config needed | Consistent behaviour is more predictable than per-type config |
| How many TCs / ratio | Single coverage mode gate (A/B/C) | One meaningful choice per US — not a multi-question form |

---

## Backward Compatibility

- `solutionDesignUrl` / `solutionDesignContent` kept (deprecated) — existing consumers unaffected
- `additionalContextFields` config is optional — absent = system behaves exactly as before
- `optionalSignalFields` config is optional — absent = signals not read, no behaviour change
- Traceability matrix is optional in existing drafts — parser handles missing section gracefully
- `traceabilityOutput` config is optional — absent = defaults to "both"

---

## Open Questions (Resolve Before Implementing)

1. **Exact ADO reference names** for Impact Assessment, Reference Documentation — run `list_work_item_fields` to confirm before coding Phase 1a
2. **Risk field value format** in your ADO org — is it "High/Medium/Low" or "1 - Critical / 2 - High" etc.? Affects signal parsing logic
3. **Tags field delimiter** — ADO uses semicolons by default (`Tag1; Tag2`) — confirm this matches your org

---

## Files Changed Across All Phases

| File | Change |
|---|---|
| `conventions.config.json` | Add `additionalContextFields`, `optionalSignalFields`, `traceabilityOutput` |
| `src/types.ts` | Add `AdoContextField`, `OptionalSignals`, `FetchedPage`, `UnfetchedLink`, update `UserStoryContext`, `ConventionsConfig` |
| `src/config.ts` | Add Zod schemas for new config sections |
| `src/helpers/confluence-url.ts` | Add `extractAllLinks()` with categorization |
| `src/confluence-client.ts` | Add typed `ConfluenceError` class (401/403/404) |
| `src/tools/work-items.ts` | Rewrite `extractUserStoryContext()` for multi-field, multi-link, optional signals |
| `src/prompts/index.ts` | Update `draft_test_cases` prompt with Source Discovery Report + coverage gate |
| `.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md` | Add consultant role, decision gates, signals rules, traceability step |
| `src/helpers/tc-draft-formatter.ts` | Add traceability matrix section |
| `src/helpers/tc-draft-parser.ts` | Parse traceability matrix |
| `src/tools/tc-drafts.ts` | Add `traceabilityMatrix` to schema |
| `docs/implementation.md` | Update Solution Design Usage section |
| `docs/testing-guide.md` | Update tool reference, add Source Discovery section |
| `docs/changelog.md` | Add changelog entry |
