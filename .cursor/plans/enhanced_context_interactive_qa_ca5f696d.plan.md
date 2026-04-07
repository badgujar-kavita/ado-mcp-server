---
name: Enhanced Context Interactive QA
overview: "Transform the test case drafting workflow from a script runner to an interactive QA consultant: read all relevant ADO fields, fetch all Confluence pages, detect/report non-Confluence sources, handle access restrictions, present data sources for user confirmation, enforce traceability, and never assume."
todos:
  - id: prereq-field-names
    content: Run list_work_item_fields to confirm exact ADO reference names for Impact Assessment and Reference Documentation
    status: pending
  - id: phase1-config
    content: "Phase 1a: Add additionalContextFields to conventions.config.json, types.ts, config.ts"
    status: pending
  - id: phase1-links
    content: "Phase 1b: Add extractAllLinks() with URL categorization to confluence-url.ts"
    status: pending
  - id: phase1-errors
    content: "Phase 1c: Add typed Confluence errors (401/403/404) to confluence-client.ts"
    status: pending
  - id: phase1-workitems
    content: "Phase 1d: Rewrite extractUserStoryContext() for multi-field and multi-page fetching"
    status: pending
  - id: phase1-types
    content: "Phase 1e: Update UserStoryContext with solutionDesignPages[], unfetchedLinks[], additionalContext{}"
    status: pending
  - id: phase2-prompt
    content: "Phase 2: Update draft_test_cases prompt with interactive workflow (Source Discovery, Execution Plan gate, UX rules)"
    status: pending
  - id: phase2-skill
    content: "Phase 2: Update SKILL.md with interactive consultant role, decision gates, traceability step"
    status: pending
  - id: phase3-traceability
    content: "Phase 3: Add traceability matrix to draft formatter, parser, and schema"
    status: pending
  - id: phase4-docs
    content: "Phase 4: Update implementation.md, testing-guide.md, changelog.md, deploy"
    status: pending
isProject: false
---

# Enhanced Context Gathering, Multi-Link Support, and Interactive QA Workflow

**Priority:** High
**Estimated Effort:** Medium-Large (16 files across 4 phases)

---

## Problem Statement

The current `get_user_story` and `draft_test_cases` workflow has 6 gaps:

1. **Missing ADO fields** -- only reads `Custom.TechnicalSolution` (Solution Notes). Does NOT read `Impact Assessment` or `Reference Documentation`.
2. **Single Confluence link** -- only fetches the FIRST Confluence URL. If a field has 3 links, 2 are silently ignored.
3. **Silent failures** -- non-Confluence links (SharePoint, Figma, LucidChart, Google Drive) are silently dropped.
4. **No cross-instance detection** -- Confluence links on a different Atlassian instance fail silently.
5. **No interactive consultation** -- the AI proceeds with whatever data it has, making assumptions instead of consulting the user.
6. **No traceability** -- test cases are not anchored back to source documents.

---

## Current State (Key Files)

- [src/helpers/confluence-url.ts](src/helpers/confluence-url.ts) -- extracts **first** Confluence URL only via `extractConfluenceUrl()` and `extractConfluencePageId()`
- [src/tools/work-items.ts](src/tools/work-items.ts) -- `extractUserStoryContext()` reads only `Custom.TechnicalSolution`, fetches one Confluence page
- [src/types.ts](src/types.ts) -- `UserStoryContext` has single `solutionDesignUrl` + `solutionDesignContent`
- [src/confluence-client.ts](src/confluence-client.ts) -- `getPageContent()` does not distinguish 401 vs 403 vs 404 errors
- [src/config.ts](src/config.ts) -- Zod schema for `conventions.config.json`, no `additionalContextFields`
- [conventions.config.json](conventions.config.json) -- only `solutionDesign.adoFieldRef` configured
- [src/prompts/index.ts](src/prompts/index.ts) -- `draft_test_cases` prompt, no interactive decision gates
- [.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md](.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md) -- QA Architect skill, no traceability or interactive rules

---

## Phase 1: Backend -- Multi-Field and Multi-Link Support

### 1a. Config: Additional ADO context fields

**[conventions.config.json](conventions.config.json)** -- add `additionalContextFields`:

```json
{
  "additionalContextFields": [
    { "adoFieldRef": "Custom.ImpactAssessment", "label": "Impact Assessment", "fetchLinks": true },
    { "adoFieldRef": "Custom.ReferenceDocumentation", "label": "Reference Documentation", "fetchLinks": true }
  ]
}
```

> **PREREQUISITE:** Run `list_work_item_fields` to confirm exact ADO reference names before implementing.

**[src/types.ts](src/types.ts)** -- add `AdoContextField` interface, update `ConventionsConfig`

**[src/config.ts](src/config.ts)** -- add Zod schema for `additionalContextFields`

### 1b. URL extraction: Extract ALL links with categorization

**[src/helpers/confluence-url.ts](src/helpers/confluence-url.ts)** -- add `extractAllLinks()`:

```typescript
type ExternalLinkType = "Confluence" | "SharePoint" | "Figma" | "LucidChart" | "GoogleDrive" | "Other";
interface CategorizedLink { url: string; type: ExternalLinkType; pageId?: string; }
function extractAllLinks(rawValue: string): CategorizedLink[]
```

Detection: `atlassian.net` -> Confluence, `sharepoint.com/office.com` -> SharePoint, `figma.com` -> Figma, `lucid.app/lucidchart.com` -> LucidChart, `drive.google.com` -> GoogleDrive

Keep existing `extractConfluencePageId()` and `extractConfluenceUrl()` for backward compat.

### 1c. Typed Confluence errors (401/403/404)

**[src/confluence-client.ts](src/confluence-client.ts)** -- update `getPageContent()` to throw typed errors with HTTP status so callers can distinguish access denied (403) from auth failure (401) from not found (404).

### 1d. Multi-field reading and multi-page fetching

**[src/tools/work-items.ts](src/tools/work-items.ts)** -- rewrite `extractUserStoryContext()`:

- Read Solution Design field -> extract ALL links -> fetch all Confluence pages
- Read each `additionalContextFields` entry -> extract text + links -> fetch Confluence pages
- Cross-instance check: compare link hostname to configured `confluence_base_url`
- Collect all fetched pages in `solutionDesignPages[]`, all unfetchable links in `unfetchedLinks[]`
- Store raw text from additional fields in `additionalContext{}`

### 1e. Updated response types

**[src/types.ts](src/types.ts)** -- add to `UserStoryContext`:

- `solutionDesignPages: FetchedPage[]` -- all fetched Confluence pages
- `unfetchedLinks: UnfetchedLink[]` -- categorized links with type, message, workaround
- `additionalContext: Record<string, string>` -- text from Impact Assessment, Reference Documentation, etc.
- Keep deprecated `solutionDesignUrl` / `solutionDesignContent` for backward compat

---

## Phase 2: Prompt and Skill -- Interactive QA Workflow

### 2a. Role and core principle

**Role:** AI QA Architect and Lead QA Architect. Interactive consultant, not script runner.

**Core Principle:** Prioritize transparency and user agency. Never assume about data sources. If ambiguous, pause and consult.

### 2b. Source Discovery Report (after get_user_story)

**[src/prompts/index.ts](src/prompts/index.ts)** -- update `draft_test_cases` prompt to instruct:

- **Multiple Confluence links:** List page titles/URLs, ask "Synthesize all, or focus on primary?"
- **Access restrictions (403):** Notify with Option A (grant access) / Option B (paste content) / Option C (proceed without)
- **Non-Confluence links:** Integration Alert with workaround ("export as PDF and upload to chat")

### 2c. Execution Plan decision gate

Before drafting, AI must present a data sources table with status and wait for user confirmation. Includes pending items that need manual action.

### 2d. UX formatting rules

Visual indicators: checkmark for success, warning for attention needed, cross for blockers, info for informational. Use blockquotes for alerts, Option A/B paths for forced decisions, tables for summaries.

### 2e. Accuracy and logic rules

- Cross-reference sources; highlight conflicts as Functional Gaps
- Mark unclear requirements as "TBD -- Information Required" instead of guessing
- Confidence levels: 100% (from AC/SD), 90% (auto-fetched), 80% (manual upload), 70% (inferred), TBD (unclear)

### 2f. Skill update

**[.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md](.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md)** -- add interactive consultant role, decision gates, UX formatting, traceability step.

---

## Phase 3: Draft Format -- Traceability Matrix

### 3a. Formatter

**[src/helpers/tc-draft-formatter.ts](src/helpers/tc-draft-formatter.ts)** -- add `traceabilityMatrix` section to markdown output (after test cases, before Review Notes)

### 3b. Parser

**[src/helpers/tc-draft-parser.ts](src/helpers/tc-draft-parser.ts)** -- parse traceability matrix from markdown

### 3c. Draft schema

**[src/tools/tc-drafts.ts](src/tools/tc-drafts.ts)** -- add `traceabilityMatrix` to `SaveTcDraftShape` schema

Matrix format per row: Test Case ID, Feature/Requirement, Source Document, Confidence Level

---

## Phase 4: Documentation and Deploy

- **[docs/implementation.md](docs/implementation.md)** -- update "Solution Design Usage" with multi-field, multi-link docs
- **[docs/testing-guide.md](docs/testing-guide.md)** -- update tool reference table
- **[docs/changelog.md](docs/changelog.md)** -- add changelog entry
- `npm run deploy` to Google Drive

---

## Open Questions (Resolve Before Implementing)

- Exact ADO field reference names for "Impact Assessment" and "Reference Documentation" -- run `list_work_item_fields`
- Traceability matrix in draft file AND chat, or chat only?
- Execution Plan gate mandatory always, or optional on revisions?
- Any other ADO fields to read besides Impact Assessment and Reference Documentation?

---

## Backward Compatibility

- `solutionDesignUrl` / `solutionDesignContent` kept (deprecated) for existing consumers
- `additionalContextFields` config is optional -- if absent, system behaves exactly as before
- Existing drafts unaffected; traceability matrix is optional in existing drafts

Full details: [docs/plan-enhanced-context-and-interactive-workflow.md](docs/plan-enhanced-context-and-interactive-workflow.md)
