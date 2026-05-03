---
name: All Fields and Embedded Images Support
overview: "Expose every populated ADO work-item field (standard + custom) to the agent, fetch all Confluence links from every context field, and capture embedded images from ADO rich-text fields and Confluence current-version pages. Delivered as saved local attachments PLUS MCP image content parts so draft_test_cases and create_test_cases can reason over the complete visual + textual context of any user story."
todos:
  - id: phase1-types
    content: "Phase 1: Extend UserStoryContext with allFields, namedFields, embeddedImages, unfetchedLinks, fetchedConfluencePages; update src/types.ts"
    status: pending
  - id: phase1-config
    content: "Phase 1: Extend conventions.config.json + src/config.ts Zod schema with additionalContextFields allowlist, allFields filter block, and images block (downscale, SVG inline, saveLocally opt-in)"
    status: pending
  - id: phase1-links
    content: "Phase 1: Replace extractConfluenceUrl with extractAllLinks() that returns ALL links per field, categorized, including page IDs for Confluence"
    status: pending
  - id: phase1-system-noise
    content: "Phase 1: Implement system-noise filter for allFields pass-through (curated default omit list + config extension)"
    status: pending
  - id: phase1-basic-auth
    content: "Phase 1 (prereq): Extract src/helpers/basic-auth.ts and replace the 4 existing inline Buffer.from(...).toString('base64') Basic-auth call sites before adding more"
    status: pending
  - id: phase2-image-downscale
    content: "Phase 2: Wire a shared downscaleRaster helper (using jimp — pure JS, no native deps) used by both attachment fetchers"
    status: pending
  - id: phase2-ado-attachments
    content: "Phase 2: New src/helpers/ado-attachments.ts — parse <img>, resolve /_apis/wit/attachments URLs, getBinary via ADO PAT, apply guardrails (downscale, SVG inline, optional save)"
    status: pending
  - id: phase2-confluence-attachments
    content: "Phase 2: New src/helpers/confluence-attachments.ts — list /child/attachment current version, map ac:image/ri:attachment + <img> refs, download via Basic auth, apply guardrails"
    status: pending
  - id: phase2-stripHtml
    content: "Phase 2: Update src/confluence-client.ts stripHtml to preserve image markers; add listAttachments + fetchAttachmentBinary; expose raw storage HTML"
    status: pending
  - id: phase3-rewrite-extract
    content: "Phase 3: Rewrite extractUserStoryContext() in src/tools/work-items.ts — allFields pass-through with filter, multi-link extraction across all text/HTML fields, invoke both attachment helpers, assemble new response shape"
    status: pending
  - id: phase3-mcp-parts
    content: "Phase 3: Update get_user_story tool response to include MCP image content parts (base64) alongside the JSON text part, respecting maxPerUserStory"
    status: pending
  - id: phase4-prompt
    content: "Phase 4: Update draft_test_cases and create_test_cases prompts — scan allFields, reference embeddedImages via originalUrl (or relativeToDraft if saveLocally), call out unfetched links before drafting"
    status: pending
  - id: phase4-skill
    content: "Phase 4: Update draft-test-cases-salesforce-tpm/SKILL.md and test-case-asset-manager/SKILL.md — allFields consumption rules, image referencing, optional attachments/ folder layout"
    status: pending
  - id: phase4-5-tests
    content: "Phase 4.5: Add node:test unit tests — extractAllLinks, categorizeLink, <img> parsing, <ac:image> parsing (3 variants), guardrail enforcement (min/max bytes, mime allowlist, downscale, response-budget), Confluence attachment filename matching"
    status: pending
  - id: phase5-docs
    content: "Phase 5: Update docs/implementation.md, docs/setup-guide.md, docs/testing-guide.md, docs/changelog.md with the new capabilities and saveLocally rationale"
    status: pending
  - id: phase5-deploy
    content: "Phase 5: Rebuild distribution bundle via npm run build:dist (Vercel tarball distribution handles delivery)"
    status: pending
isProject: true
---

# All Fields and Embedded Images Support

**Priority:** High
**Estimated Effort:** Large — 12 files across 5 phases
**Scope:** Data-gathering layer only (what the MCP reads and exposes). Does not cover Source Discovery Report UX or coverage-mode gates — those are not in any active plan and would need a new plan if pursued.

---

## Problem Statement

`draft_test_cases` and `create_test_cases` currently operate on an incomplete view of the User Story because the MCP's data layer is too narrow:

1. **Only 7 named fields are returned.** `extractUserStoryContext` in `src/tools/work-items.ts:123-174` discards the rest of `item.fields`. Teams with custom fields like `Custom.ImpactAssessment`, `Custom.ReferenceDocumentation`, `Custom.BusinessJustification`, etc. get none of them.
2. **Only the first Confluence link is fetched.** `extractConfluenceUrl` in `src/helpers/confluence-url.ts:54-69` returns `urls.find(isConfluenceUrl)`. If Solution Notes or Reference Documentation contains 3 links, 2 are silently dropped.
3. **Images are invisible to the agent.**
   - ADO rich-text fields (Description, AC, Solution Notes, any custom HTML field) may contain `<img src="https://dev.azure.com/{org}/{project}/_apis/wit/attachments/{guid}…">` — these pass through as raw HTML and are never fetched. The agent has no way to see the wireframe / screenshot / diagram the BA attached.
   - Confluence storage HTML contains `<ac:image><ri:attachment ri:filename="…"/></ac:image>` or direct `<img>` tags. `stripHtml` at `src/confluence-client.ts:107-124` deletes these entirely. The agent never sees the diagrams the solution-design author placed on the Confluence page.
4. **No "current version" attachment handling for Confluence.** `getPageContent` fetches `body.storage` but never calls `/rest/api/content/{pageId}/child/attachment`, so even if the storage HTML referenced an image, the download URL is unknown.

**End-user request (verbatim):**
> "we are focusing on these fields on primary basis Title, Description, acceptance criteria, solution notes and reference document but when you get the workitem details you can get all fields standard and custom created because we don't know how end users project is setup, so they can provide what they want you to refer additionally."

So the data layer must deliver **both** a known primary group **and** a pass-through of everything else the team's project happens to populate.

---

## Design Decisions (Locked In Before Implementation)

| Decision | Chosen | Rationale |
|---|---|---|
| Field exposure strategy | **Pass-through populated fields + named primary allowlist, with system-noise filter** | ADO already returns all populated fields in one call; zero-config for end users; LLM picks what matters; named primaries keep prompt focus; filter drops obvious noise (CommentCount, RevisedDate, AuthorizedAs, etc.) to keep payload focused. |
| Image delivery | **MCP image content parts always; local save opt-in per team** | MCP parts give Cursor / vision-capable clients immediate multimodal access with zero bloat. Local save is disabled by default to avoid disk bloat and PII-leak risk — teams that want offline-reviewable draft markdown opt in via `images.saveLocally: true`. |
| Oversized images | **Downscale to long-side 1600 px, not skip** | Preserves visual evidence while keeping token budget predictable. Skipping loses information; downscaling keeps it readable. |
| Downscale library | **`jimp`** (pure JS, zero native deps) | MCP ships to many dev machines. `sharp`'s native binaries regularly break installs on Windows / ARM Linux. The ~100–300 ms overhead per image is invisible for ≤20 images/call. |
| Aggregate response size | **`images.maxTotalBytesPerResponse: 4 MiB` default** | 20 images × 2 MiB raw = 40 MiB base64 can blow Claude's context window and silently break `draft_test_cases`. 4 MiB caps image payload at ~1M tokens, leaving room for text + other context. |
| Confluence link cap | **`context.maxConfluencePagesPerUserStory: 10`** | Pathological cases (50 links in Solution Notes) would stall the call. Excess → `unfetchedLinks` with `reason: "link-budget"`. |
| SVG handling | **Deliver as both image part and inline text** | SVG XML is parseable — the agent can read it textually for exact-value inspection (color codes, element IDs) while still seeing the rendered image. |
| Scope vs existing plans | **Standalone plan, current scope only** | No active follow-up plan for Source Discovery Report / coverage gates; if needed later, they warrant a new plan. |
| Cross-instance Confluence | **Do not fetch; record in `unfetchedLinks`** | Out of scope here; if needed later, it warrants a new plan. |
| Non-Confluence link types (SharePoint, Figma, …) | **Do not fetch; record in `unfetchedLinks`** | Same reasoning — surface to user, don't auto-resolve. |
| Field-name discovery (Impact Assessment, Reference Documentation) | **Runtime via REST, not a manual prerequisite** | The MCP already has `list_work_item_fields` and `get_user_story` returns `allFields` — the allowlist can be verified/auto-suggested at install time or on first use. |

---

## Scope — What This Plan Covers

### Fields Read from the User Story

**Primary (always surfaced with named keys in `namedFields`):**

| Field | Reference |
|---|---|
| Title | `System.Title` |
| Description | `System.Description` |
| Acceptance Criteria | `Microsoft.VSTS.Common.AcceptanceCriteria` |
| Solution Notes | `Custom.TechnicalSolution` (overridable via `conventions.config.json → solutionDesign.adoFieldRef`) |
| Impact Assessment | `Custom.ImpactAssessment` (configurable, see prerequisite) |
| Reference Documentation | `Custom.ReferenceDocumentation` (configurable, see prerequisite) |
| Area Path | `System.AreaPath` |
| Iteration Path | `System.IterationPath` |
| State | `System.State` |

**Pass-through (always surfaced as raw map `allFields`):** Every populated field the ADO API returns for that work item, including custom fields the end-user team has configured that we don't know about. The agent can scan this for additional context.

### Links

**For every text/HTML field in `namedFields` + every field in `additionalContextFields`:**
- Extract **all** links (not just the first).
- Categorize: Confluence, SharePoint, Figma, LucidChart, GoogleDrive, Other.
- For Confluence links on the configured instance: fetch the page body **and** its current-version attachments.
- For everything else: record in `unfetchedLinks[]` with a workaround message.

### Images

**ADO rich-text images:** Parse `<img>` tags in any HTML field value. Resolve ADO attachment URLs (`/_apis/wit/attachments/{guid}`), fetch using the existing ADO PAT, deliver as MCP image content parts. If `images.saveLocally` is enabled, also persist to `tc-drafts/US_<id>/attachments/ado/`.

**Confluence page images (current version only):** For each successfully fetched Confluence page:
1. Call `GET /rest/api/content/{pageId}/child/attachment?expand=version,metadata` to enumerate attachments.
2. Parse `<ac:image><ri:attachment ri:filename="…"/></ac:image>` refs in storage HTML to map filenames to download URLs.
3. Also capture direct `<img src="…">` references in the storage HTML.
4. Fetch each image using the existing Confluence Basic auth, deliver as MCP image content parts. If `images.saveLocally` is enabled, also persist to `tc-drafts/US_<id>/attachments/confluence/<pageId>/`.

**SVG images (ADO or Confluence):** Deliver the raw XML as inline text on the `EmbeddedImage.svgInlineText` field in addition to the image content part. Lets the agent inspect element IDs, text nodes, and exact color values without OCR.

**Oversized images:** When raw bytes exceed `images.maxBytesPerImage`, downscale to `images.downscaleLongSidePx` (default 1600 px on the long side) with aspect preserved, re-encode at `images.downscaleQuality` (default 85 for JPEG/WebP). Only skip (with `skipped: "too-large"`) when downscaled output still exceeds the limit. SVGs are never downscaled — they're vector.

### Explicitly Out of Scope

- Source Discovery Report, coverage-mode gates, interactive decision UX → not in any active plan; would need a new plan if pursued.
- Reading linked work items (parent Epic, child Tasks, linked Bugs) → out of scope for both plans.
- Cross-instance Confluence fetching or SharePoint/Figma/etc. auto-resolution → surfaced as `unfetchedLinks`, user handles manually.
- Historical versions of Confluence pages — current version only (as per user's request).
- OCR / text extraction from raster images — images delivered as-is; the agent's vision decides. (SVG is the exception — delivered as text + image.)

---

## Current State (File Anchors)

| Concern | Path | Lines |
|---|---|---|
| Narrow field extraction | `src/tools/work-items.ts` | 123–174 |
| First-Confluence-URL-only logic | `src/helpers/confluence-url.ts` | 54–69 |
| `<img>`-stripping Confluence client | `src/confluence-client.ts` | 107–124 |
| `UserStoryContext` shape | `src/types.ts` | 17–30 |
| Solution Design config | `conventions.config.json` | 113–136 |
| `draft_test_cases` prompt | `src/prompts/index.ts` | 170–238 |
| `create_test_cases` prompt | `src/prompts/index.ts` | 240–264 |
| ADO client (already supports Basic-PAT fetch for any URL under `baseUrl`) | `src/ado-client.ts` | full |
| Confluence client (already has Basic-auth fetch + fallback) | `src/confluence-client.ts` | full |

---

## Phase 1 — Types, Config, Link Extraction

### 1a. Extend `UserStoryContext` — `src/types.ts`

Add (keeping existing fields for backward compatibility):

```typescript
export type ExternalLinkType =
  | "Confluence" | "SharePoint" | "Figma" | "LucidChart" | "GoogleDrive" | "Other";

export interface CategorizedLink {
  url: string;
  type: ExternalLinkType;
  pageId?: string;        // present only for Confluence
  sourceField: string;    // ADO field reference this link came from
}

export interface FetchedConfluencePage {
  pageId: string;
  title: string;
  url: string;
  body: string;                       // stripped, markdown-ish
  sourceField: string;
  images: EmbeddedImage[];            // attachments resolved from this page
}

export interface UnfetchedLink {
  url: string;
  type: ExternalLinkType;
  sourceField: string;
  reason: "cross-instance" | "non-confluence" | "access-denied" | "not-found" | "auth-failure" | "link-budget" | "time-budget";
  workaround: string;                 // e.g. "Export as PDF and paste content"
}

export interface EmbeddedImage {
  source: "ado" | "confluence";
  sourceField?: string;               // ADO field name, if source=ado
  sourcePageId?: string;              // Confluence page id, if source=confluence
  originalUrl: string;                // original <img src> or download URL — stable link reviewers can click
  filename: string;                   // resolved file name
  mimeType: string;                   // image/png, image/jpeg, image/svg+xml, …
  bytes: number;                      // bytes after downscale (if applied)
  originalBytes?: number;             // bytes before downscale (only present when downscaled)
  downscaled?: boolean;
  altText?: string;
  svgInlineText?: string;             // raw SVG XML, only present when mimeType === "image/svg+xml" and inlineSvgAsText is enabled
  localPath?: string;                 // absolute path on disk — only present when images.saveLocally is true
  relativeToDraft?: string;           // path relative to the draft markdown file — only present when saveLocally is true
  skipped?: "too-small" | "too-large" | "unsupported-mime" | "fetch-failed" | "response-budget" | "time-budget";
}

export interface UserStoryContext {
  id: number;
  // Named primary fields — kept as top-level keys for convenience
  title: string;
  description: string;
  acceptanceCriteria: string;
  areaPath: string;
  iterationPath: string;
  state: string;
  parentId: number | null;
  parentTitle: string | null;
  relations: AdoRelation[];

  // NEW — named context group (solution notes + configured allowlist)
  namedFields: Record<string, { label: string; html: string; plainText: string }>;

  // NEW — pass-through of every populated ADO field (standard + custom)
  allFields: Record<string, unknown>;

  // NEW — multi-link fetching
  fetchedConfluencePages: FetchedConfluencePage[];
  unfetchedLinks: UnfetchedLink[];

  // NEW — images extracted from ADO rich-text fields (not tied to a Confluence page)
  embeddedImages: EmbeddedImage[];

  // Deprecated, kept for backward compatibility
  /** @deprecated Use fetchedConfluencePages[0]?.url instead */
  solutionDesignUrl: string | null;
  /** @deprecated Use fetchedConfluencePages[0]?.body instead */
  solutionDesignContent: string | null;
}
```

**Empty-field rule:** `namedFields[key]` is omitted when the underlying ADO field is null/empty — reviewers should not see ghost entries with empty `html` / `plainText`. Same rule for `allFields` (the noise filter and the "populated" filter together).

### 1a-prereq. Extract `src/helpers/strip-html.ts`

`stripHtml` in `src/confluence-client.ts:107-124` is private. The plan's new `namedFields[].plainText` and Phase 2c marker-preserving variant both need it.

- Extract the current `stripHtml` logic into `src/helpers/strip-html.ts` as `stripHtml(html: string, opts?: { preserveImageMarkers?: boolean }): string`.
- Default behavior matches current (image tags removed).
- With `preserveImageMarkers: true`: replace `<img>` / `<ac:image>` with `[image: filename]` (when filename resolvable from attrs) or `[image]` — per Phase 2c.
- Update `ConfluenceClient` to use the helper.

### 1b. Extend `conventions.config.json` + `src/config.ts`

Add two optional blocks (absence = current behavior, no breaking change):

```json
{
  "additionalContextFields": [
    { "adoFieldRef": "Custom.ImpactAssessment", "label": "Impact Assessment", "fetchLinks": true, "fetchImages": true },
    { "adoFieldRef": "Custom.ReferenceDocumentation", "label": "Reference Documentation", "fetchLinks": true, "fetchImages": true }
  ],
  "allFields": {
    "passThrough": true,
    "omitSystemNoise": true,
    "omitExtraRefs": []
  },
  "images": {
    "enabled": true,
    "maxPerUserStory": 20,
    "maxBytesPerImage": 2097152,
    "maxTotalBytesPerResponse": 4194304,
    "minBytesToKeep": 4096,
    "downscaleLongSidePx": 1600,
    "downscaleQuality": 85,
    "mimeAllowlist": ["image/png", "image/jpeg", "image/gif", "image/svg+xml"],
    "inlineSvgAsText": true,
    "returnMcpImageParts": true,
    "saveLocally": false,
    "savePathTemplate": "tc-drafts/US_{usId}/attachments"
  },
  "context": {
    "maxConfluencePagesPerUserStory": 10,
    "maxTotalFetchSeconds": 45
  }
}
```

> **Webp note:** `image/webp` is intentionally excluded from the default allowlist because `jimp` (the chosen downscale library, per R1) does not natively decode webp. Adding `image/webp` to `mimeAllowlist` will cause webp downscale to throw and the image to be dropped as `skipped: "fetch-failed"`. Teams that want webp pass-through (no downscale) can add it to the allowlist AND accept that webp files exceeding `maxBytesPerImage` will be skipped rather than shrunk. For reliable webp support, route through `sharp` (native dep, breaks install on some platforms) — not recommended for the default path.

**`allFields.omitSystemNoise`** (default `true`) filters the following obvious-noise fields from the `allFields` pass-through map to keep the payload focused. The LLM still gets them from the actual ADO API if any become relevant later, but they're not shipped in the default context:

```
System.Id, System.Rev, System.ChangedDate, System.ChangedBy,
System.CreatedDate, System.CreatedBy, System.AuthorizedDate, System.AuthorizedAs,
System.RevisedDate, System.Watermark, System.NodeName, System.TeamProject,
System.WorkItemType, System.BoardColumn, System.BoardColumnDone, System.BoardLane,
System.CommentCount, System.PersonId, System.ExternalLinkCount,
System.HyperLinkCount, System.AttachedFileCount, System.RelatedLinkCount,
Microsoft.VSTS.Common.StateChangeDate, Microsoft.VSTS.Common.ActivatedDate,
Microsoft.VSTS.Common.ActivatedBy, Microsoft.VSTS.Common.ResolvedDate,
Microsoft.VSTS.Common.ResolvedBy, Microsoft.VSTS.Common.ClosedDate,
Microsoft.VSTS.Common.ClosedBy
```

Teams can **extend** the omit list (e.g. extra project-specific audit fields) via `allFields.omitExtraRefs: ["Custom.InternalTrackingId", ...]`, or **disable** the filter entirely with `allFields.omitSystemNoise: false` to ship everything raw.

Match semantics: `omitExtraRefs` uses **exact match on `referenceName`**. No globs, no prefix matching — keeps it predictable and documentable. Teams omitting a family of fields list each ref explicitly.

**`images.saveLocally`** (default `false`) — see "Why not save locally by default?" below. Set to `true` per-team to also persist images to disk next to the draft.

Matching Zod schema additions in `src/config.ts`. All fields optional with sensible defaults defined inline.

**Failure mode:** the existing Zod schema uses strict `.parse()` (`src/config.ts:82`). Parse each of the **new** optional blocks (`additionalContextFields`, `allFields`, `images`, `context`) with `.safeParse()` per-block and fall back to defaults on validation error, logging a single `console.warn`. A malformed new block must not crash the MCP server. Existing required blocks keep strict `.parse()`.

#### Why not save locally by default?

Images are already delivered to the agent as MCP image content parts (base64 inline). Saving them to `tc-drafts/US_<id>/attachments/` gives exactly **one** extra capability: reviewers reading the draft markdown offline, without ADO/Confluence auth, can see the screenshots.

Costs of saving by default:
- **Disk bloat** — every `draft_test_cases` run persists copies of images that already exist in ADO/Confluence with version control.
- **PII leak risk** — screenshots can contain customer names, emails, tokens, test data. Keeping copies on every developer's machine widens the exposure surface beyond the source systems.
- **Git noise** — `tc-drafts/` is typically committed; binaries in every US folder bloat the repository.
- **Reference drift** — the source-system image is the canonical version. Local copies go stale when authors update the ADO attachment.

Teams whose reviewers genuinely work offline, or who want draft folders to be a self-contained deliverable, turn it on. Everyone else gets vision + clickable source URLs in the draft markdown, which is the common case.

### 1c. Rewrite `src/helpers/confluence-url.ts`

Replace first-match-only logic with full extraction + categorization:

```typescript
export function extractAllLinks(rawHtmlOrText: string, sourceField: string): CategorizedLink[]
export function categorizeLink(url: string): ExternalLinkType
export function extractConfluencePageIdFromUrl(url: string): string | null
// Keep (delegating to new functions, marked @deprecated):
export function extractConfluenceUrl(raw: string | null | undefined): string | null
export function extractConfluencePageId(raw: string | null | undefined): string | null
```

Categorization rules:

| Host pattern | Type |
|---|---|
| `atlassian.net` (matches configured instance) | `Confluence` |
| `atlassian.net` (different instance) | `Confluence` but flagged cross-instance at fetch time |
| `*.sharepoint.com` \| `*.office.com` | `SharePoint` |
| `figma.com` | `Figma` |
| `lucid.app` \| `lucidchart.com` | `LucidChart` |
| `drive.google.com` | `GoogleDrive` |
| anything else | `Other` |

---

## Phase 2 — Attachment Fetchers

### 2a-prereq. Refactor `AdoClient` for binary responses

Before `ado-attachments.ts` can download bytes, extend `src/ado-client.ts:32-72` (`request<T>`) to accept `responseType: "json" | "binary"` (default `"json"`).

- When `"binary"`: return `{ buffer: ArrayBuffer; mimeType: string | null }` using `response.arrayBuffer()` + `response.headers.get("content-type")`.
- **MIME caveat:** ADO attachment endpoints return `Content-Type: application/octet-stream` (or `application/zip`) per Microsoft's REST spec — NOT `image/*`. Callers MUST derive the true MIME from the filename extension (e.g. `.png` → `image/png`) and/or a magic-byte sniff. Do not trust the response header for allowlist checks.
- When `"json"`: existing behaviour, no regressions.
- `mapError`, `buildUrl`, and auth stay shared — no duplication.
- Add `getBinary(path, apiVersion, queryParams)` as a thin wrapper over `request` with `responseType: "binary"`.

### 2a. New `src/helpers/ado-attachments.ts`

```typescript
export async function extractAndFetchAdoImages(params: {
  fieldValuesByRef: Record<string, string>;       // HTML strings from populated fields
  adoClient: AdoClient;
  userStoryId: number;
  saveRoot?: string;                              // only used when saveLocally is true
  guardrails: ImageGuardrails;
}): Promise<EmbeddedImage[]>
```

Responsibilities:
1. For each populated field value that looks like HTML, parse `<img>` tags (regex or lightweight HTML scanner).
2. Filter `src` URLs to those pointing at the configured ADO instance. Use **path-based detection** — an `<img>` is an ADO attachment if its URL pathname contains `/_apis/wit/attachments/`. Combine with a hostname check against the configured ADO `baseUrl.host` (dev.azure.com, `*.visualstudio.com` legacy, or self-hosted ADO Server) to prevent cross-tenant leakage. Rejected hosts record `skipped: "unsupported-mime"` — we have no auth for them.
3. For each URL:
   - **Data URI handling:** if `<img src="data:...">`, decode base64 → bytes, parse mime from the URI prefix, and run through the same guardrails as a fetched attachment. No HTTP fetch. Skip if mime is not in the allowlist or bytes fall outside `minBytesToKeep`..`maxBytesPerImage` (downscale raster if applicable).
   - Call `GET /_apis/wit/attachments/{guid}?download=true&fileName=...` via the new `AdoClient.getBinary(path, apiVersion, queryParams)` method (returns `ArrayBuffer` + content-type). **Derive MIME from filename extension** (and/or magic-byte sniff) — the response `Content-Type` is `application/octet-stream` and cannot be trusted for the allowlist check.
   - Skip below `minBytesToKeep`, skip MIME not in allowlist.
   - If bytes > `maxBytesPerImage` and MIME is raster: downscale via a lightweight image library (e.g. `sharp` if available, else a pure-JS fallback) to long-side `downscaleLongSidePx`. Set `downscaled: true` and `originalBytes`.
   - If MIME is `image/svg+xml` and `inlineSvgAsText` is enabled: decode bytes as UTF-8 and attach as `svgInlineText`.
   - Deduplicate by GUID within a single US fetch.
   - Capture `alt` attribute from the `<img>` tag as `altText`.
   - If `saveLocally` is true: save to `{saveRoot}/{guid}_{sanitizedFilename}` and populate `localPath` + `relativeToDraft`. If the save root is not writable (read-only CWD, ephemeral container), log a warning and fall back to MCP-parts-only — never fail the overall call on disk errors.
4. Return `EmbeddedImage[]` in source-document order — `<img>` tags ordered per the HTML they appear in, fields ordered as declared in `namedFields` + `additionalContextFields`. Includes skipped entries (with `skipped` set) for audit.

### 2b. New `src/helpers/confluence-attachments.ts`

```typescript
export async function fetchCurrentVersionAttachments(params: {
  pageId: string;
  storageHtml: string;                            // raw body.storage.value
  confluenceClient: ConfluenceClient;
  saveRoot?: string;                              // only used when saveLocally is true
  guardrails: ImageGuardrails;
}): Promise<EmbeddedImage[]>
```

Responsibilities:
1. Parse storage HTML for image references using **`node-html-parser`** (zero deps — used only in this helper; regex is too fragile for nested `<ac:image><ri:attachment>` with variant attribute orders and optional `<ri:page>`/`<ri:url>` children). **Colon-in-tag caveat:** CSS selectors for namespaced tags must escape the colon (`root.querySelectorAll("ac\\:image")`, `node.getAttribute("ri:filename")`). Covered by a fixture test in Phase 4.5.
   - `<ac:image …><ri:attachment ri:filename="…" /></ac:image>` → filename lookup
   - Direct `<img src="…">` → URL-based lookup (relative `/download/attachments/…` or absolute)
2. Call `ConfluenceClient.listAttachments(pageId)` which wraps `GET /rest/api/content/{pageId}/child/attachment?expand=version,metadata` — returns array of `{ id, title, mediaType, version: { number }, _links: { download } }`.
3. Join step-1 refs against step-2 results **by filename**. If multiple attachments share a filename (same name, different uploads), pick the one with the highest `version.number`. (Attachment versions are independent of page version — matching by filename against the latest upload is the only stable join.)
4. **Dedupe** resolved attachments by `(pageId, filename)` before fetching — the same image can be referenced multiple times in storage HTML; fetch once.
5. For each matched attachment:
   - Download via `ConfluenceClient.fetchAttachmentBinary(downloadUrl)` — new method using the existing Basic auth, resolves relative URLs against `baseUrl`.
   - Apply same guardrails as ADO images (min bytes, MIME allowlist, downscale if oversized, SVG inline-as-text). Per-image failures use the same `skipped` mechanism as top-level `embeddedImages` (`fetch-failed`, `too-large`, etc.) — recorded on `FetchedConfluencePage.images[].skipped`. Reviewers debugging "why is this image missing?" see a clear reason in the JSON payload.
   - If `saveLocally` is true: save to `{saveRoot}/{pageId}/{sanitizedFilename}`; populate `localPath` + `relativeToDraft`. If the save root is not writable, log a warning and fall back to MCP-parts-only — never fail the overall call on disk errors.
6. Return `EmbeddedImage[]` in source-document order (the order filenames appear in the storage HTML).

### 2c. Update `src/confluence-client.ts`

- Add `listAttachments(pageId: string): Promise<ConfluenceAttachment[]>`.
- Add `fetchAttachmentBinary(urlOrPath: string): Promise<{ buffer: ArrayBuffer; mimeType: string }>`. On 401, attempt the same `api.atlassian.com/ex/confluence/{cloudId}/...` fallback that `getPageContent` already uses (`src/confluence-client.ts:58-74, 78-105`) — otherwise tenants on scoped tokens will get page bodies but every image returns `skipped: "auth-failure"`. Short-circuit after the first 401 per call to avoid 10×30s retry storms.
- Update `stripHtml` to replace image tags with a placeholder marker (`[image: filename.png]` when resolvable, else `[image]`) instead of deleting them — preserves spatial context in the page body.
- Expose `getPageContent` return shape to optionally include the raw `body.storage.value` so attachment helper can parse it without a second fetch.
- Preserve existing 401 fallback logic.

---

## Phase 3 — Rewrite Data Extraction + Tool Surface

### 3a. Rewrite `extractUserStoryContext` in `src/tools/work-items.ts`

New flow:

```
fetch work item with $expand=relations                       // unchanged REST call
→ build rawAllFields = { …item.fields }
→ apply omitSystemNoise filter (config-driven)              → allFields
→ build namedFields = {
     Title, Description, AcceptanceCriteria,
     SolutionNotes (via configured adoFieldRef),
     ...additionalContextFields from config
   } — each entry has { label, html, plainText }
→ collect fieldsToScanForLinks = namedFields + any HTML-valued allFields entry
→ collectedLinks = extractAllLinks(each field, sourceField)
→ cap Confluence links at context.maxConfluencePagesPerUserStory (default 10) in source-document order;
    overflow → unfetchedLinks with reason: "link-budget"
→ for each kept Confluence link on configured instance:
     fetch page body → stripHtml → plain text
     fetch current-version attachments → EmbeddedImage[]
     append to fetchedConfluencePages
→ for everything else (non-Confluence, cross-instance, link-budget overflow):
    append to unfetchedLinks with a workaround
→ extractAndFetchAdoImages across every populated HTML field in allFields
→ enforce guardrails.maxPerUserStory across combined image list (source-document order)
→ return new UserStoryContext
```

**Dedupe rule:** if an `additionalContextFields` entry's `adoFieldRef` collides with a primary (Title, Description, AC, Solution Notes, Impact Assessment, Reference Documentation already seeded), skip the duplicate and log once — primary wins.

Concurrency: `Promise.all` across Confluence pages and ADO images with a small concurrency cap (say 5) to avoid hammering either API. Per-request timeout 30s.

Failure policy: any individual fetch failure is caught, the item is added to `unfetchedLinks` or `embeddedImages` with `skipped: "fetch-failed"`, and the overall call never fails hard — the agent must still get a usable `UserStoryContext`.

### 3b. Update `get_user_story` tool response

**Tool signature change:** accept two new optional params, `workspaceRoot` and `draftsPath`. **Only consulted when `images.saveLocally === true`.** Reuse `resolveTcDraftsDir` from `src/tools/tc-drafts.ts:26-36` — which already handles the precedence `draftsPath > workspaceRoot > TC_DRAFTS_PATH env > credentials.tc_drafts_path` (env lookup is inside `getTcDraftsDir()` in `src/credentials.ts:30-38`, not in `resolveTcDraftsDir` directly). If `saveLocally` is true and the chain resolves to nothing, log a warning and fall back to MCP-parts-only (image bytes still returned inline; `localPath` / `relativeToDraft` omitted). Do not re-invent path precedence.

Currently returns a single `text` content part. Change to return a content array:

```typescript
content: [
  { type: "text", text: JSON.stringify(context, null, 2) },
  ...(config.images.returnMcpImageParts
      ? packWithResponseBudget(
          allImages.filter(i => !i.skipped),     // already in source-document order
          config.images.maxTotalBytesPerResponse // 4 MiB default
        ).map(i => ({
          type: "image",
          data: base64OfImage(i),                // from in-memory buffer; if saveLocally, also from disk
          mimeType: i.mimeType,
        }))
      : []),
]
```

**Response-budget packing** — iterate images in source-document order, accumulating base64 byte count; when adding the next image would exceed `maxTotalBytesPerResponse`, stop. Remaining images are marked `skipped: "response-budget"` in the JSON payload (with `originalUrl` intact so reviewers can click through) but are NOT base64-encoded into the response. This prevents `get_user_story` from returning a payload large enough to blow Claude's context window.

Respect `maxPerUserStory` before `maxTotalBytesPerResponse`. The JSON text part is always included. Clients without image support (or with `returnMcpImageParts: false`) still get every metadata field including `originalUrl` and, if `saveLocally` is enabled, `localPath` / `relativeToDraft`.

**Tool description update:** `src/tools/work-items.ts:21` — replace the current `"Fetch a User Story from ADO with description, acceptance criteria, parent info, Solution Design content from Confluence, and all relations"` with something like: `"Fetch a User Story from ADO. Returns every populated field (named primaries + allFields pass-through), all linked Confluence pages with their current-version images, and embedded images from ADO rich-text fields. When images are present, the response contains [text, image, image, ...] content parts. Optional workspaceRoot/draftsPath for saveLocally mode."` LLMs route by description; leaving it stale under-represents the new payload.

### 3c. Preserve deprecated keys

- `solutionDesignUrl` = first Confluence link found in Solution Notes (existing behavior).
- `solutionDesignContent` = body of first fetched Confluence page from Solution Notes.

Existing consumers (e.g. current `draft_test_cases` prompt) keep working while we roll out the new keys.

**Format note:** `solutionDesignContent` was previously `# ${title}\n\n${body}`. `fetchedConfluencePages[].body` is stripped HTML without a title heading — the title is on `.title` instead. New consumers reading `body` directly see no title prefix; existing consumers keep reading `solutionDesignContent` unchanged.

---

## Phase 4 — Prompt + Skill Updates

### 4a. `src/prompts/index.ts` → `draft_test_cases` prompt

Insert after the existing step 2 ("Fetch the user story using the get_user_story tool"):

> **2d. Consume the full context payload.** `get_user_story` now returns:
> - `namedFields` — primary focus: Title, Description, Acceptance Criteria, Solution Notes, Impact Assessment, Reference Documentation. These are the first-class inputs for test design.
> - `allFields` — every other populated ADO field on this work item (system-noise filtered). Scan for anything the team has configured that looks relevant (e.g. `Custom.BusinessJustification`, `Custom.RiskLevel`, tags). Use it as supporting context — do not invent meaning for fields you don't recognize; if a field's relevance is unclear, mention it and ask.
> - `fetchedConfluencePages[]` — all Confluence pages linked from any context field, each with current-version images.
> - `embeddedImages[]` — screenshots, wireframes, and diagrams embedded in ADO rich-text fields. Each entry includes `originalUrl` (the clickable ADO/Confluence source) and, if saved, `relativeToDraft`. For SVG entries, `svgInlineText` contains the raw XML — read it for exact element IDs, colors, and text values.
> - `unfetchedLinks[]` — links we could not fetch (SharePoint, Figma, cross-instance Confluence, etc.). Surface these to the user with the provided workaround before drafting.
>
> **2e. Use images when present.** When `embeddedImages` or any `fetchedConfluencePages[].images` is non-empty, treat them as first-class evidence. Describe what you observe in the draft's Functionality Process Flow. In the draft markdown, reference each image using `originalUrl` (preferred — reviewers click through to the live source), or `relativeToDraft` when `saveLocally` is enabled and offline viewing is expected.

Add a rule:

> **When `unfetchedLinks` is non-empty, list them to the user and propose next action BEFORE starting TC generation.** Do not silently proceed past a SharePoint or Figma link the user may consider essential.

### 4b. `src/prompts/index.ts` → `create_test_cases` prompt

If no draft exists, the same consumption rules from 4a apply when it falls through to `get_user_story` in step 3.

### 4c. `.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md`

- Add a "Context Inputs" section enumerating `namedFields`, `allFields`, `fetchedConfluencePages`, `embeddedImages`, `unfetchedLinks` with expected usage.
- Add a rule: "When a screenshot or wireframe is available (`embeddedImages` or Confluence page images), reference it in the TC description or Process Flow with a relative link. Do not describe UI from memory or invention if an image is available."
- Add a rule: "`allFields` is a safety net for project-specific fields we don't know about. Scan it, but only elevate a value to test-case input if it looks unambiguously relevant. When in doubt, ask the user."

### 4d. `.cursor/skills/test-case-asset-manager/SKILL.md`

Document that the US folder **optionally** contains an `attachments/` subfolder when `images.saveLocally` is enabled:

```
tc-drafts/
  US_<id>/
    US_<id>_test_cases.md
    solution_summary.md
    qa_cheat_sheet.md
    attachments/                       # only created when images.saveLocally is true
      ado/
        <guid>_<filename>
      confluence/
        <pageId>/
          <filename>
```

Default is no `attachments/` folder — the draft markdown embeds images via their `originalUrl` (ADO or Confluence). Mention both modes in `list_tc_drafts` / `get_tc_draft` tool descriptions so reviewers know whether to expect local files or to click through.

---

## Phase 4.5 — Tests (new)

The repo has no existing test suite. This refactor adds net-new parsing and binary-fetch logic across 12 files, so a minimal test baseline is mandatory.

**Framework:** `node:test` (built into Node 20+, zero new deps). Colocate tests next to source (`src/helpers/confluence-url.test.ts`, etc.) and add `npm test` → `node --test --import tsx src/**/*.test.ts`.

**Must-cover cases:**

| Area | Tests |
|---|---|
| `extractAllLinks` | Multiple links per field; `sourceField` attribution; preserves document order |
| `categorizeLink` | Each of the 6 types + edge cases (subdomain matching, port numbers, query strings) |
| `extractConfluencePageIdFromUrl` | Both `/pages/{id}` and `?pageId={id}` variants |
| ADO `<img>` parser | Single / multiple `<img>` tags; `alt` extraction; data URIs passed through; external CDNs recorded as unsupported |
| Confluence `<ac:image>` parser (via `node-html-parser`) | All 3 variants: `<ri:attachment>`, `<ri:attachment ri:filename="…"><ri:page…>` (cross-page → unfetched), `<ri:url>` (external → unfetched); plain `<img>` fallback |
| Confluence attachment filename matching | Multiple attachments sharing a filename → highest `version.number` wins; dedupe by `(pageId, filename)` |
| Guardrails | min-bytes skip, mime-allowlist skip, downscale trigger at `maxBytesPerImage`, SVG never downscaled, `maxPerUserStory` cap, `maxTotalBytesPerResponse` packing stops at limit |
| Response-budget packing | Images past the byte cap get `skipped: "response-budget"` with `originalUrl` intact, and are NOT in the response content array |
| Link-budget cap | 12 Confluence links with `maxConfluencePagesPerUserStory: 10` → first 10 fetched, last 2 in `unfetchedLinks` with `reason: "link-budget"` |
| Failure isolation | A single 404 on one attachment doesn't sink the overall call; `skipped: "fetch-failed"` recorded |
| `saveLocally` fallback | Read-only save root → warning logged, `localPath` absent, MCP parts still returned |
| `basicAuthHeader` parity | After extracting `src/helpers/basic-auth.ts`, assert the header produced for each of the 4 existing call sites (`src/ado-client.ts:18`, `src/confluence-client.ts:4`, `src/tools/configure-ui.ts:41`, `src/tools/configure-ui.ts:102`) is byte-identical to pre-refactor output. Trivial assertion, high safety value |
| `node-html-parser` fixture | Parse `<ac:image ac:align="center"><ri:attachment ri:filename="diagram.png"/></ac:image>` and confirm selector `ac\\:image` + attribute read `ri:filename` both work. Guards against future parser swap silently breaking `<ac:image>` detection |
| `maxTotalFetchSeconds` timeout | Simulate 12 slow fetches × 10 s/fetch with budget 45 s → remaining fetches cancelled, affected entries marked `skipped: "time-budget"` / `reason: "time-budget"`, call returns with partial result |

**What's NOT tested here:** end-to-end against real ADO / Confluence (manual verification in Phase 5). Tests use in-memory mocks for HTTP clients.

---

## Phase 5 — Docs + Deploy

### 5a. Documentation (per workspace deploy rule)

- **`docs/implementation.md`** — new "Work Item Context Payload" subsection describing the full `UserStoryContext` shape, `namedFields` vs `allFields`, image guardrails, and failure policy. Add a "MCP Tool Response Shape" note clarifying that `get_user_story` may return image content parts.
- **`docs/setup-guide.md`** — document the `additionalContextFields` and `images` blocks in `conventions.config.json`, including how to override for other projects that use different custom field names. Explicitly correct the current "Confluence: server never reads attachments" statement.
- **`docs/testing-guide.md`** — update the `get_user_story` row in the tool quick-reference table with the new response fields. Add a troubleshooting row for "image did not appear in draft" (check guardrails + mime allowlist + attachments folder).
- **`docs/changelog.md`** — single entry covering all-fields pass-through, multi-link fetching, ADO image support, and Confluence current-version image support. Include a **"Breaking changes"** heading: `get_user_story` now returns multiple content parts (text + images) when images are present. MCP clients that assert `content.length === 1` or only read `content[0]` must either upgrade to iterate the content array OR set `images.returnMcpImageParts: false` in `conventions.config.json` to retain the single-text-part response shape.

### 5b. Deploy

**Prerequisite — `build-dist.mjs` update (BLOCKER, not just a spot-check):**

`build-dist.mjs` uses esbuild with `bundle: true`, no `external` markers, and emits a synthesized `package.json` with `dependencies: {}`. Adding `jimp` (~3-6 MB bundled, includes codec data + potentially wasm/native sub-deps) and `node-html-parser` (~100-200 KB) means one of the following MUST be true, or the deployed MCP crashes at runtime:

1. **Option A — bundle inline (simpler, bigger):** leave esbuild's `bundle: true` and no externals. Verify the output `dist-package/dist/index.js` actually builds without errors (jimp's codec sub-deps sometimes resist bundling). Bundle size jumps from ~KBs to ~4-6 MB. Document the size jump in the changelog.
2. **Option B — mark external + propagate:** add `external: ["jimp", "node-html-parser"]` to esbuild config AND update the synthesized `distPkg.dependencies` to include both packages at their installed versions. Deployment target must `npm install` on first run, OR the packages must be shipped alongside.

**Verification before shipping the distribution bundle:**
```bash
npm run build:dist
node dist-package/dist/index.js --help   # smoke test: server starts, no missing-module errors
```
If the smoke test fails with `Cannot find module 'jimp'` or a jimp codec error, the bundling choice above is wrong — fix before rebuilding.

**Then:** rebuild the distribution bundle via `npm run build:dist`; distribution happens via Vercel (see docs/distribution-guide.md). Mandatory after touching any MCP tool, prompt, skill, or conventions/documentation change.

---

## Guardrails (Cross-Cutting)

| Concern | Rule |
|---|---|
| Max images per US | `images.maxPerUserStory` (default 20) — ADO + Confluence combined |
| Max bytes per image | `images.maxBytesPerImage` (default 2 MiB) — oversized raster images are **downscaled** before this limit is re-applied; SVG always passes (vector) |
| **Max total bytes per response** | `images.maxTotalBytesPerResponse` (default 4 MiB) — aggregate cap across all image parts in a single `get_user_story` response; prevents blowing Claude's context window. Overflow → `skipped: "response-budget"` |
| Max Confluence pages per US | `context.maxConfluencePagesPerUserStory` (default 10) — overflow → `unfetchedLinks` with `reason: "link-budget"` |
| Downscale target | `images.downscaleLongSidePx` (default 1600 px long side) at `images.downscaleQuality` (default 85) |
| Min bytes to keep | `images.minBytesToKeep` (default 4 KiB) — drops icons/spacers |
| Allowed MIME | `images.mimeAllowlist` — others recorded as `skipped: "unsupported-mime"` |
| SVG text inline | `images.inlineSvgAsText` (default `true`) — raw XML attached to `EmbeddedImage.svgInlineText`. When `saveLocally` is `true`, SVGs written to disk have `<script>` tags and `on*=""` event-handler attributes stripped before write to prevent XSS when a reviewer opens them in a browser. `svgInlineText` shown to the agent is unfiltered (agents don't execute SVG). |
| **Total fetch budget per call** | `context.maxTotalFetchSeconds` (default 45) — wall-clock cap across all Confluence page + attachment fetches in a single `get_user_story`. When exceeded, cancel pending fetches, mark affected items `skipped: "time-budget"` / `reason: "time-budget"`, and return what's fetched so far. Prevents MCP-client timeouts on pathological USs. |
| Per-fetch timeout | 30 s hard timeout on every ADO and Confluence HTTP call |
| Concurrency | Max 5 parallel attachment fetches |
| Idempotence | When `saveLocally` is true, images saved by `{guid}_{filename}` (ADO) or `{pageId}/{filename}` (Confluence) — overwrite on re-run for same US |
| Failure isolation | Individual fetch failures logged into `embeddedImages[].skipped` / `unfetchedLinks[].reason`; the tool call always succeeds if the work item itself was fetched |
| Secret safety | Never embed PAT or Confluence token in saved image paths, alt text, or returned JSON |

---

## Backward Compatibility

- Existing `UserStoryContext` keys remain (`solutionDesignUrl`, `solutionDesignContent`, etc.).
- `additionalContextFields`, `images`, and `context` config blocks are optional — absence = pre-rollout behavior (named fields only, first-link only, no images).
- `get_user_story` JSON payload gets new keys but no removals — parsers tolerant of extra keys keep working.
- Existing `draft_test_cases` prompt flow unchanged for projects that don't configure the new fields; enhanced flow only activates when the new payload keys are populated.
- Existing drafts under `tc-drafts/US_<id>/` are untouched; the `attachments/` folder is additive.

### ⚠️ One breaking-change risk (opt-out available)

When `images.returnMcpImageParts: true` (default) and images are present, `get_user_story` returns a content array `[text, image, image, …]` instead of a single text part. MCP clients that assert `content.length === 1` or only read `content[0]` will break.

**Mitigation:** set `images.returnMcpImageParts: false` in `conventions.config.json` to retain the single-text-part shape. Image metadata (including `originalUrl`) is still in the JSON payload, so clients can click through to sources. Document this clearly under a "Breaking changes" heading in `docs/changelog.md`.

---

## Runtime Discovery (no manual prerequisites)

All three previously-manual "prerequisites" are resolved via REST at runtime — no blocking setup step:

### Field reference names (Impact Assessment, Reference Documentation, …)

- The existing `list_work_item_fields` tool (`src/tools/work-items.ts:89-120`) calls `GET /_apis/wit/fields` and returns every field's `referenceName` + `name`. The installer / first-run flow can call this, fuzzy-match the configured labels against returned `name`s (e.g. "Impact Assessment" → `Custom.ImpactAssessment`), and either auto-populate `conventions.config.json → additionalContextFields` or prompt the user once.
- `get_user_story` returns `allFields` — the map of every populated field on this work item — so even without `additionalContextFields` configured, the agent can scan for relevant-looking custom fields in a given US and surface them.
- `AdoContextField.adoFieldRef` resolution is late-bound: if a configured ref isn't populated on a given US, we skip it silently (no hard error).

### ADO image URL pattern

- Detected at parse time: any `<img>` whose `src` matches `https://dev.azure.com/*/_apis/wit/attachments/*` (or the equivalent `https://*.visualstudio.com/*/_apis/wit/attachments/*` legacy pattern) is treated as an ADO attachment.
- Any other `<img src>` (e.g. data URIs, external CDN) is either passed through as-is (for data URIs — already embeddable) or recorded in `embeddedImages[].skipped = "unsupported-mime"` for non-fetchable externals.
- No pre-run sampling needed.

### Confluence storage-HTML shape

- The parser handles three variants in one pass:
  - `<ac:image><ri:attachment ri:filename="…"/></ac:image>` — attachment on same page
  - `<ac:image><ri:attachment ri:filename="…"><ri:page ri:content-title="…"/></ri:attachment></ac:image>` — attachment on a different page (future extension; recorded as unfetched)
  - `<ac:image><ri:url ri:value="https://…"/></ac:image>` — external image (recorded as `unfetchedLinks` with `reason: "non-confluence"`)
  - Plain `<img src="…">` — resolve against `baseUrl` if relative, else external
- The `/child/attachment?expand=version,metadata` response shape is stable across Confluence Cloud and Server and is used as documented — no per-instance variation.

**One-off verification** (optional, not blocking): during the first local dev run, invoke the existing `list_work_item_fields` tool and `get_user_story` for one known US to visually confirm the label mapping. This is documentation guidance in `docs/setup-guide.md`, not a coded prerequisite.

---

## Files Changed Across All Phases

| File | Change |
|---|---|
| `conventions.config.json` | Add `additionalContextFields`, `images` blocks |
| `src/config.ts` | Zod schemas for new config blocks with defaults |
| `src/types.ts` | Add `CategorizedLink`, `FetchedConfluencePage`, `UnfetchedLink`, `EmbeddedImage`; extend `UserStoryContext`; deprecate legacy keys |
| `src/helpers/confluence-url.ts` | `extractAllLinks`, `categorizeLink`; legacy helpers marked deprecated |
| `src/helpers/basic-auth.ts` | NEW (prereq) — `basicAuthHeader(user, pass)` centralized; replaces 4 existing inline `Buffer.from(...).toString('base64')` call sites + used by the 2 new attachment helpers |
| `src/helpers/ado-attachments.ts` | NEW — ADO rich-text image extraction and download (uses `jimp` for downscale) |
| `src/helpers/confluence-attachments.ts` | NEW — Confluence current-version attachment resolution and download (uses `node-html-parser` for robust `<ac:image>` parsing) |
| `src/**/*.test.ts` | NEW — `node:test` unit tests for link extraction, image parsing, guardrails (Phase 4.5) |
| `package.json` | Add `jimp` and `node-html-parser` dependencies; add `test` script |
| `src/ado-client.ts` | Add `getBinary(path, apiVersion, queryParams)` for attachment bytes |
| `src/confluence-client.ts` | Add `listAttachments`, `fetchAttachmentBinary`; update `stripHtml` to preserve image markers; expose raw storage HTML |
| `src/tools/work-items.ts` | Rewrite `extractUserStoryContext`; update `get_user_story` response to include MCP image content parts |
| `src/prompts/index.ts` | Update `draft_test_cases` and `create_test_cases` prompts to consume the new payload and reference images |
| `.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md` | Consume `allFields`, reference images, call out unfetched links |
| `.cursor/skills/test-case-asset-manager/SKILL.md` | Document `attachments/` subfolder layout |
| `docs/implementation.md` | New "Work Item Context Payload" section |
| `docs/setup-guide.md` | Document `additionalContextFields` and `images` blocks; correct attachment statement |
| `docs/testing-guide.md` | Update `get_user_story` reference + troubleshooting |
| `docs/changelog.md` | Single changelog entry |
| `npm run build:dist` | Rebuild distribution bundle (Vercel tarball distribution handles delivery; see docs/distribution-guide.md) |

---

## Relationship to Other Plans

This plan is **independent**. `tc_asset_folder_structure.plan.md` already established `tc-drafts/US_<id>/` — this plan's optional `attachments/` subfolder is fully additive. Older context/QA plans (`enhanced_context_interactive_qa_v2.plan.md`, `enhanced_context_interactive_qa_ca5f696d.plan.md`) are outdated, not referenced by this plan, and not active commitments.

---

## Open Questions (Resolved)

All four original open questions now have committed decisions:

1. **Oversized images** → **Downscale** to `downscaleLongSidePx` (1600 px default) at quality 85. Raster only; SVG is vector and untouched. Skip only if the downscaled output still exceeds the limit.
2. **SVG handling** → **Both**: image content part + inline XML on `EmbeddedImage.svgInlineText` (controlled by `images.inlineSvgAsText`, default `true`).
3. **`allFields` noise filter** → **Omit** a curated system-noise list by default (`allFields.omitSystemNoise: true`), extensible per team via `allFields.omitExtraRefs`. Can be disabled to ship everything raw.
4. **Local image saving** → **Opt-in** via `images.saveLocally` (default `false`). See "Why not save locally by default?" under Phase 1b. Default flow: MCP image parts for vision + `originalUrl` in draft markdown for reviewers. Teams that need offline-reviewable drafts enable it.

## New Open Questions

None remaining. The downscale library choice is locked to **`jimp`** (pure JS, zero native deps) — the MCP ships to many developer machines (macOS Intel/ARM, Windows, Linux x86/ARM) and `sharp`'s native binaries regularly break installs on less common setups. The ~100–300 ms overhead per image is invisible for ≤20 images per call.
