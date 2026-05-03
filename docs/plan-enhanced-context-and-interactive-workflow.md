# Plan: Enhanced Context Gathering, Multi-Link Support, and Interactive QA Workflow

**Status:** PLANNED — Not yet implemented  
**Created:** 2026-04-06  
**Priority:** High  
**Estimated Effort:** Medium-Large (8–12 files across code, config, prompts, skill, docs)

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Current State Analysis](#2-current-state-analysis)
3. [Design Goals](#3-design-goals)
4. [Architecture Changes](#4-architecture-changes)
   - [4.1 Additional ADO Fields](#41-additional-ado-fields)
   - [4.2 Multi-Link Extraction and Categorization](#42-multi-link-extraction-and-categorization)
   - [4.3 Multi-Confluence Page Fetching](#43-multi-confluence-page-fetching)
   - [4.4 Access Restriction Handling](#44-access-restriction-handling)
   - [4.5 Non-Confluence Source Detection](#45-non-confluence-source-detection)
   - [4.6 Updated Response Format](#46-updated-response-format)
5. [Interactive QA Workflow](#5-interactive-qa-workflow)
   - [5.1 Role Definition](#51-role-definition)
   - [5.2 Documentation and Link Handling UX](#52-documentation-and-link-handling-ux)
   - [5.3 Proposed Execution Plan (Decision Gate)](#53-proposed-execution-plan-decision-gate)
   - [5.4 Scope Guardrails](#54-scope-guardrails)
   - [5.5 UX and Interaction Style](#55-ux-and-interaction-style)
   - [5.6 Accuracy and Logic Rules](#56-accuracy-and-logic-rules)
   - [5.7 Traceability Matrix](#57-traceability-matrix)
6. [File-by-File Implementation Plan](#6-file-by-file-implementation-plan)
7. [Configuration Changes](#7-configuration-changes)
8. [Migration and Backward Compatibility](#8-migration-and-backward-compatibility)
9. [Testing Strategy](#9-testing-strategy)
10. [Open Questions](#10-open-questions)

---

## 1. Problem Statement

The current `ado_story` and `qa_draft` workflow has several gaps:

1. **Missing ADO fields:** Only reads `Custom.TechnicalSolution` (Solution Notes). Does NOT read `Description`, `Impact Assessment`, or `Reference Documentation` fields for context.
2. **Single Confluence link:** Only fetches the FIRST Confluence URL from Solution Design. If a field has 3 links, 2 are silently ignored.
3. **Silent failures:** Non-Confluence links (SharePoint, Figma, LucidChart, Google Drive) are silently dropped with no user notification.
4. **No cross-instance detection:** Confluence links pointing to a different Atlassian instance than configured fail silently.
5. **No interactive consultation:** The AI proceeds with whatever data it has, making assumptions rather than consulting the user about data sources and ambiguities.
6. **No traceability:** Test cases are not anchored back to specific source documents, making it hard to validate coverage.

---

## 2. Current State Analysis

### Fields currently read by `ado_story`

| Field | ADO Reference | Status |
|---|---|---|
| Title | `System.Title` | ✅ Read |
| Description | `System.Description` | ✅ Read |
| Acceptance Criteria | `Microsoft.VSTS.Common.AcceptanceCriteria` | ✅ Read |
| Area Path | `System.AreaPath` | ✅ Read |
| Iteration Path | `System.IterationPath` | ✅ Read |
| State | `System.State` | ✅ Read |
| Parent | `System.LinkTypes.Hierarchy-Reverse` | ✅ Read |
| Solution Notes | `Custom.TechnicalSolution` | ✅ Read (first Confluence link only) |
| **Impact Assessment** | `Custom.ImpactAssessment` (TBD) | ❌ NOT read |
| **Reference Documentation** | `Custom.ReferenceDocumentation` (TBD) | ❌ NOT read |

### Link handling today

| Scenario | Current Behavior |
|---|---|
| 1 Confluence link in Solution Notes | ✅ Fetched |
| 3 Confluence links in Solution Notes | ⚠️ Only first fetched, rest silently ignored |
| SharePoint link in Solution Notes | ❌ Silently ignored |
| Figma link in Reference Documentation | ❌ Field not read at all |
| Confluence link on different Atlassian instance | ❌ Fails silently |
| 403 / Access Denied on Confluence page | ⚠️ Returns generic error message |

### Key code locations

| File | What it does |
|---|---|
| `src/helpers/confluence-url.ts` | Extracts first Confluence URL and page ID from rich text |
| `src/tools/work-items.ts` | `extractUserStoryContext()` — reads ADO fields, fetches Confluence |
| `src/types.ts` | `UserStoryContext` — single `solutionDesignUrl` + `solutionDesignContent` |
| `src/confluence-client.ts` | `getPageContent(pageId)` — fetches one Confluence page |
| `src/config.ts` | Zod schema for `conventions.config.json` |
| `conventions.config.json` | `solutionDesign.adoFieldRef` — only one field configured |
| `src/prompts/index.ts` | `qa_draft` prompt — workflow instructions |
| `.cursor/skills/qa-test-drafting/SKILL.md` | QA Architect skill |

---

## 3. Design Goals

1. **Read all relevant ADO fields** for test case context (configurable, skip if empty)
2. **Extract ALL links** from all configured fields (not just the first one)
3. **Categorize links** by type (Confluence, SharePoint, Figma, LucidChart, Google Drive, Other)
4. **Auto-fetch all reachable Confluence pages** on the configured instance
5. **Detect and report access restrictions** (403/401) with actionable guidance
6. **Detect and report non-Confluence links** with clear workaround instructions
7. **Interactive workflow:** Present data sources, ask for user decisions, never assume
8. **Traceability:** Every test case anchored to a specific source document
9. **Backward compatible:** Existing `solutionDesignUrl` / `solutionDesignContent` fields preserved
10. **Configurable:** New fields added via `conventions.config.json` — no code changes needed

---

## 4. Architecture Changes

### 4.1 Additional ADO Fields

**File:** `conventions.config.json`

Add a new `additionalContextFields` array:

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
  ]
}
```

> **PREREQUISITE:** Run `ado_fields` tool to confirm exact ADO field reference names (`Custom.ImpactAssessment`, `Custom.ReferenceDocumentation`). These may differ per ADO project.

**Files to change:**
- `conventions.config.json` — Add `additionalContextFields`
- `src/types.ts` — Add `AdoContextField` interface, update `ConventionsConfig`
- `src/config.ts` — Add Zod schema for `additionalContextFields`

### 4.2 Multi-Link Extraction and Categorization

**File:** `src/helpers/confluence-url.ts`

Replace single-link extraction with full URL extraction and categorization.

**New exports:**

```typescript
type ExternalLinkType = "Confluence" | "SharePoint" | "Figma" | "LucidChart" | "GoogleDrive" | "Other";

interface CategorizedLink {
  url: string;
  type: ExternalLinkType;
  pageId?: string;  // Confluence only
}

function extractAllLinks(rawValue: string): CategorizedLink[]
```

**Detection rules:**

| Type | URL pattern |
|---|---|
| Confluence | `atlassian.net`, `confluence` |
| SharePoint | `sharepoint.com`, `office.com`, `office365.com` |
| Figma | `figma.com` |
| LucidChart | `lucid.app`, `lucidchart.com` |
| Google Drive | `drive.google.com`, `docs.google.com` |
| Other | Anything else with `https://` |

**Backward compatibility:** Keep existing `extractConfluencePageId()` and `extractConfluenceUrl()` as-is. Add `extractAllLinks()` as a new function.

### 4.3 Multi-Confluence Page Fetching

**File:** `src/tools/work-items.ts`

Update `extractUserStoryContext()` to:

1. Read Solution Design field → extract ALL links → fetch all Confluence pages
2. Read each `additionalContextFields` entry → extract text content + links → fetch Confluence pages
3. Collect all fetched pages and all unfetchable links
4. Handle errors per-page (one failure doesn't block others)

**Logic:**

```
For each configured field (Solution Design + additionalContextFields):
  rawValue = fields[adoFieldRef]
  if empty → skip
  
  textContent = stripHtml(rawValue)  // store readable text
  links = extractAllLinks(rawValue)
  
  for each link:
    if Confluence:
      if same instance as configured → try fetch
        if 403/401 → add to accessRestricted[] with space info
        if success → add to fetchedPages[]
      if different instance → add to unfetchedLinks[] with "different instance" type
    else:
      add to unfetchedLinks[] with categorized type and guidance message
```

### 4.4 Access Restriction Handling

**File:** `src/confluence-client.ts` + `src/tools/work-items.ts`

Currently, 401 errors attempt a fallback to `api.atlassian.com`. We need to distinguish:

| HTTP Status | Meaning | User Action |
|---|---|---|
| 200 | Success | Page content returned |
| 401 | Authentication failed | Check credentials / API token |
| 403 | Access denied (different space permissions) | Request access to that Confluence space |
| 404 | Page not found / deleted | Verify page ID is correct |

**New behavior on 403:**

```
⚠️ **Access Denied**
> I cannot access Confluence page [pageId] in space [SpaceName].
> This page may be in a restricted space.
>
> **Options:**
> - **Option A:** Grant my Confluence API token access to this space, then retry
> - **Option B:** Manually copy-paste the relevant content into this chat
> - **Option C:** Proceed without this source (may reduce test coverage)
```

**Implementation:**
- Update `ConfluenceClient.getPageContent()` to throw typed errors with HTTP status
- Update `work-items.ts` to catch and categorize these errors

### 4.5 Non-Confluence Source Detection

**File:** `src/tools/work-items.ts` + prompt

When non-Confluence links are detected, include an `integrationAlert` in the response:

```json
{
  "unfetchedLinks": [
    {
      "source": "Reference Documentation",
      "url": "https://www.figma.com/file/abc123/Design-System",
      "type": "Figma",
      "message": "Figma design link detected. Auto-fetch is not supported.",
      "workaround": "Export the relevant screens as PDF/PNG and upload to this chat for analysis."
    },
    {
      "source": "Solution Notes",
      "url": "https://company.sharepoint.com/sites/TPM/Pages/Config.aspx",
      "type": "SharePoint",
      "message": "SharePoint link detected. Auto-fetch is not supported.",
      "workaround": "Export the page content as PDF or copy-paste the relevant sections into this chat."
    }
  ]
}
```

**Guidance messages per type:**

| Type | Message |
|---|---|
| SharePoint | "SharePoint link detected. Export as PDF or copy-paste relevant content into this chat." |
| Figma | "Figma design link detected. Export relevant screens as PDF/PNG and upload to this chat." |
| LucidChart | "LucidChart diagram detected. Export as PDF/PNG and upload to this chat." |
| Google Drive | "Google Drive link detected. Download and share the file, or copy-paste relevant content." |
| Other | "External link detected. Please review and share relevant content manually if needed for test case design." |

### 4.6 Updated Response Format

**File:** `src/types.ts`

```typescript
interface FetchedPage {
  source: string;         // "Solution Design", "Reference Documentation"
  title: string;          // Confluence page title
  body: string;           // Stripped HTML content
  confidenceNote?: string; // e.g., "Auto-fetched from Confluence"
}

interface UnfetchedLink {
  source: string;
  url: string;
  type: "SharePoint" | "Figma" | "LucidChart" | "GoogleDrive" |
        "Confluence (different instance)" | "Confluence (access denied)" | "Other";
  message: string;
  workaround: string;
}

interface UserStoryContext {
  // ... existing fields preserved ...
  
  // Backward compat (deprecated but kept)
  solutionDesignUrl: string | null;
  solutionDesignContent: string | null;
  
  // New: all fetched pages from all configured fields
  solutionDesignPages: FetchedPage[];
  
  // New: links that couldn't be auto-fetched
  unfetchedLinks: UnfetchedLink[];
  
  // New: text content from additional ADO fields
  additionalContext: Record<string, string>;
  // e.g., { "Impact Assessment": "...", "Reference Documentation": "..." }
}
```

---

## 5. Interactive QA Workflow

### 5.1 Role Definition

**Update:** `src/prompts/index.ts` (qa_draft prompt) and `.cursor/skills/qa-test-drafting/SKILL.md`

```
Role: You are an AI QA Architect and Lead QA Architect. Your goal is to guide the user 
through a robust test case generation workflow by acting as an interactive consultant, 
not just a script runner.

Core Principle: Prioritize transparency and user agency. Never make assumptions about 
data sources. If a decision path is ambiguous, pause and consult the user.
```

### 5.2 Documentation and Link Handling UX

After `ado_story` returns, the AI must present a **Source Discovery Report** before proceeding:

#### Multiple Confluence Links

If >1 Confluence link detected across all fields:

```markdown
> **ℹ️ Multiple Confluence Sources Detected**
>
> I found multiple Confluence pages linked to this User Story:
>
> | # | Source Field | Page Title | Status |
> |---|---|---|---|
> | 1 | Solution Notes | "Product Category Sharing - Solution Design" | ✅ Fetched |
> | 2 | Solution Notes | "Sharing Framework - Architecture Overview" | ✅ Fetched |
> | 3 | Reference Documentation | "TPM Permission Model" | ✅ Fetched |
>
> **Should I synthesize all of them, or is there a primary source I should focus on?**
> - **Option A:** Use all sources (comprehensive coverage)
> - **Option B:** Focus on source #___ as primary (tell me which)
```

#### Access Restrictions (403/401)

```markdown
> **⚠️ Access Restricted**
>
> I cannot access the following Confluence page:
> - **Page:** [page ID / URL]
> - **Source Field:** Reference Documentation
> - **Error:** 403 Forbidden — this page may be in a restricted Confluence space
>
> **Options:**
> - **Option A:** Pause while you grant my API token access to this space
> - **Option B:** Copy-paste the relevant content from this page into the chat
> - **Option C:** Proceed without this source (may reduce test case coverage)
```

#### Non-Confluence Sources

```markdown
> **⚠️ Integration Alert: Non-Confluence Sources Detected**
>
> The following links require additional setup or manual action:
>
> | # | Source Field | Type | URL |
> |---|---|---|---|
> | 1 | Reference Documentation | Figma | https://figma.com/file/abc123 |
> | 2 | Solution Notes | SharePoint | https://company.sharepoint.com/... |
>
> These sources are **not configured** for auto-fetch in the credentials file.
>
> **Workaround:** Please manually export these as PDFs and upload them to this chat
> for analysis. Alternatively, copy-paste the relevant sections.
>
> **Should I proceed with the available Confluence data, or wait for these sources?**
```

### 5.3 Proposed Execution Plan (Decision Gate)

Before drafting test cases, the AI must present an **Execution Plan** and wait for acknowledgment:

```markdown
## 📋 Proposed Execution Plan — US #1244695

> [!IMPORTANT]
> Review the data sources below before I proceed with drafting.

### Data Sources Identified

| # | Source | Type | Status | Action |
|---|---|---|---|---|
| 1 | Acceptance Criteria | ADO Field | ✅ Available | Will use as source of truth |
| 2 | Description | ADO Field | ✅ Available | Will use for business context |
| 3 | Solution Design (Confluence) | Auto-fetched | ✅ Fetched | Will extract fields, configs, flows |
| 4 | Impact Assessment | ADO Field | ✅ Available | Will use for scope and risk analysis |
| 5 | Reference Documentation | ADO Field | ⚠️ Contains Figma link | Need manual export |
| 6 | Reference Documentation | Confluence page | ✅ Fetched | Will use for additional context |

### Proposed Approach

- [ ] Analyze AC + Description for functional requirements
- [ ] Extract business flows from Solution Design
- [ ] Identify new fields/configs from Solution Design for admin validation TCs
- [ ] Use Impact Assessment to identify edge cases and regression risks
- [ ] Generate Functionality Process Flow (Mermaid if confident, text-based otherwise)
- [ ] Generate Test Coverage Insights
- [ ] Draft test cases with full prerequisites

### Pending Items

- ⚠️ Figma link in Reference Documentation — waiting for manual export (or proceed without?)

**Please confirm this plan or adjust before I proceed.**
```

### 5.4 Scope Guardrails

- **Cross-Confluence:** Strictly ignore cross-site Confluence logic. Treat all links as belonging to the primary base URL in credentials. Links from different instances are reported but not fetched.
- **No hallucination:** If a requirement is missing or undefined, mark it as `TBD — Information Required` rather than guessing.
- **No assumptions about data sources:** Always present what was found and ask for confirmation.

### 5.5 UX and Interaction Style

The AI must use consistent visual formatting in all responses:

| Indicator | Usage |
|---|---|
| ✅ | Successfully fetched / available |
| ⚠️ | Warning — needs attention (access denied, unfetchable link) |
| ❌ | Blocker — cannot proceed without resolution |
| ℹ️ | Informational — no action needed |
| `> [!IMPORTANT]` | Blocker that must be resolved before proceeding |
| **Bold headers** | Section titles and key decisions |
| `> blockquotes` | Alerts, decisions, and modal-style prompts |
| `Option A / Option B` | Force user decision before proceeding |
| Tables | Data source summaries, link inventories, traceability |

### 5.6 Accuracy and Logic Rules

1. **Cross-reference sources:** If Figma UI flows conflict with Confluence logic, highlight it as a **Functional Gap** for the user to resolve.
2. **No assumptions:** If a requirement is missing (e.g., button behavior not defined), mark as `TBD — Information Required`.
3. **Eliminate hallucinated test steps:** Every step must trace back to a documented requirement.
4. **Confidence levels:** Assign confidence to each test case based on source quality:
   - 100% — Directly from Acceptance Criteria or Solution Design
   - 90% — From auto-fetched Confluence page (minor interpretation)
   - 80% — From manually uploaded content (PDF/screenshot)
   - 70% — Inferred from multiple sources (cross-reference)
   - `TBD` — Requirement unclear, needs clarification

### 5.7 Traceability Matrix

Every draft output must conclude with a **Traceability Matrix** table:

```markdown
## Traceability Matrix

| Test Case ID | Feature / Requirement | Source Document | Confidence |
|---|---|---|---|
| TC_1244695_01 | New fields accessible to System Admin | Solution Design (Confluence: PRD-v3) | 100% |
| TC_1244695_02 | Product Category sharing on Promotion create | AC #2 + Solution Design | 100% |
| TC_1244695_03 | CBP access with Edit permission | Solution Design (Confluence: PRD-v3) | 100% |
| TC_1244695_04 | UI validation — sharing indicator | Figma: Design-System (Manual Upload) | 80% |
| TC_1244695_05 | Batch scheduler error handling | Impact Assessment | 90% |
| TC_1244695_06 | Access revocation on category change | AC #5 | 100% |
| TC_1244695_07 | Negative — no Product Category assigned | Inferred from AC #3 + SD | 70% |
```

**Implementation:** Add the traceability matrix as a section in the markdown draft (after test cases, before Review Notes). The `qa_draft_save` tool and `tc-draft-formatter.ts` need to support a `traceabilityMatrix` field.

---

## 6. File-by-File Implementation Plan

### Phase 1: Backend — Multi-Field and Multi-Link Support

| # | File | Change | Effort |
|---|---|---|---|
| 1 | `conventions.config.json` | Add `additionalContextFields` array | Small |
| 2 | `src/types.ts` | Add `FetchedPage`, `UnfetchedLink`, `AdoContextField` interfaces; update `UserStoryContext` and `ConventionsConfig` | Small |
| 3 | `src/config.ts` | Add Zod schema for `additionalContextFields` | Small |
| 4 | `src/helpers/confluence-url.ts` | Add `extractAllLinks()` with URL categorization; keep existing functions for backward compat | Medium |
| 5 | `src/confluence-client.ts` | Improve error handling: distinguish 401 vs 403 vs 404 with typed errors | Small |
| 6 | `src/tools/work-items.ts` | Rewrite `extractUserStoryContext()`: read additional fields, fetch all Confluence pages, collect unfetched links | Large |
| 7 | `src/credentials.ts` | No change needed (Confluence credentials already supported) | — |

### Phase 2: Prompt and Skill — Interactive Workflow

| # | File | Change | Effort |
|---|---|---|---|
| 8 | `src/prompts/index.ts` | Update `qa_draft` prompt: add Source Discovery Report, Execution Plan gate, unfetched link handling, traceability matrix instruction | Large |
| 9 | `.cursor/skills/qa-test-drafting/SKILL.md` | Add interactive consultant role, decision gates, UX formatting rules, traceability matrix step | Medium |

### Phase 3: Draft Format — Traceability Matrix

| # | File | Change | Effort |
|---|---|---|---|
| 10 | `src/helpers/tc-draft-formatter.ts` | Add `traceabilityMatrix` section to markdown output | Medium |
| 11 | `src/helpers/tc-draft-parser.ts` | Parse traceability matrix from markdown | Medium |
| 12 | `src/tools/tc-drafts.ts` | Add `traceabilityMatrix` to `SaveTcDraftShape` schema | Small |

### Phase 4: Documentation and Deploy

| # | File | Change | Effort |
|---|---|---|---|
| 13 | `docs/implementation.md` | Update "Solution Design Usage" section with multi-field, multi-link docs | Medium |
| 14 | `docs/testing-guide.md` | Update tool reference table | Small |
| 15 | `docs/changelog.md` | Add changelog entry | Small |
| 16 | Rebuild | `npm run build:dist` (Vercel auto-rebuilds tarball on git push to main) | — |

---

## 7. Configuration Changes

### `conventions.config.json` additions

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
  ]
}
```

> **ACTION REQUIRED before implementation:** Run `ado_fields` to confirm the exact ADO field reference names. The names above (`Custom.ImpactAssessment`, `Custom.ReferenceDocumentation`) are educated guesses and may differ.

### No changes to `credentials.json`

Confluence credentials already support any space on the configured instance. No new credentials are needed.

---

## 8. Migration and Backward Compatibility

| Aspect | Approach |
|---|---|
| `solutionDesignUrl` field | Kept (deprecated). First Confluence URL from Solution Design field. |
| `solutionDesignContent` field | Kept (deprecated). Combined content from all fetched pages. |
| `solutionDesignPages[]` | New. Array of all fetched pages with source labels. |
| `unfetchedLinks[]` | New. Array of categorized links that couldn't be fetched. |
| `additionalContext{}` | New. Key-value map of text content from additional ADO fields. |
| Existing drafts | Unaffected. New traceability matrix is optional in existing drafts. |
| `additionalContextFields` config | Optional. If not present, system behaves exactly as before. |

---

## 9. Testing Strategy

### Manual Test Scenarios

| # | Scenario | Expected Behavior |
|---|---|---|
| 1 | US with 1 Confluence link in Solution Notes | Fetch page, show in solutionDesignPages[0] |
| 2 | US with 3 Confluence links in Solution Notes | Fetch all 3, list in solutionDesignPages[] |
| 3 | US with Confluence + SharePoint link | Fetch Confluence, report SharePoint in unfetchedLinks[] |
| 4 | US with Figma link in Reference Documentation | Report Figma in unfetchedLinks[] with workaround |
| 5 | US with Confluence link on different Atlassian instance | Report as "different instance" in unfetchedLinks[] |
| 6 | US with 403 on a Confluence page | Report access denied with space info and options |
| 7 | US with empty Impact Assessment field | Skip silently, no error |
| 8 | US with Impact Assessment containing text only (no links) | Include text in additionalContext["Impact Assessment"] |
| 9 | US with no additionalContextFields config | Behave exactly as before (backward compat) |
| 10 | Draft with traceability matrix | Matrix appears in markdown after test cases |
| 11 | AI presents Execution Plan before drafting | User sees sources table, confirms before TC generation |
| 12 | AI detects conflict between Figma and Confluence | Highlights as Functional Gap, asks user to resolve |

---

## 10. Open Questions

| # | Question | Status |
|---|---|---|
| 1 | What are the exact ADO field reference names for "Impact Assessment" and "Reference Documentation"? | ❓ Run `ado_fields` to confirm |
| 2 | Should the traceability matrix be included in the markdown draft file, or only shown in chat? | ❓ Recommend: both (draft file + chat summary) |
| 3 | Should the Execution Plan gate be mandatory (always pause) or configurable? | ❓ Recommend: mandatory for first draft, optional on revisions |
| 4 | Should confidence levels be shown in the draft markdown or only in the traceability matrix? | ❓ Recommend: traceability matrix only |
| 5 | Are there other ADO fields besides Impact Assessment and Reference Documentation that should be read? | ❓ Ask team |
| 6 | Should non-Confluence PAT setup be documented in the setup guide for future support? | ❓ Recommend: yes, as a "Future" section |

---

## Summary

This plan transforms the test case drafting workflow from a **script runner** to an **interactive QA consultant** that:

- Reads **all relevant ADO fields** (not just Solution Notes)
- Fetches **all Confluence pages** (not just the first link)
- **Detects and reports** non-Confluence sources with workarounds
- **Handles access restrictions** with clear options
- **Presents data sources** for user confirmation before drafting
- **Never assumes** — asks when unclear
- **Traces every test case** back to its source document

All changes are backward compatible and configurable via `conventions.config.json`.
