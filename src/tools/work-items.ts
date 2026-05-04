import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoClient } from "../ado-client.ts";
import type { ConfluenceClient } from "../confluence-client.ts";
import type {
  AdoWorkItem,
  CategorizedLink,
  EmbeddedImage,
  FetchedConfluencePage,
  UnfetchedLink,
  UserStoryContext,
} from "../types.ts";
import {
  extractAllLinks,
  extractConfluenceUrl,
} from "../helpers/confluence-url.ts";
import { adoWorkItemUrl } from "../helpers/ado-urls.ts";
import { loadConventionsConfig } from "../config.ts";
import { stripHtml } from "../helpers/strip-html.ts";
import { extractAndFetchAdoImages } from "../helpers/ado-attachments.ts";
import { fetchCurrentVersionAttachments } from "../helpers/confluence-attachments.ts";
import {
  READ_OUTPUT_SCHEMA,
  type CanonicalReadResult,
  type CanonicalReadChild,
  type CanonicalReadArtifact,
  type CanonicalReadDiagnostic,
} from "./read-result.ts";

/**
 * ADO system/common fields that are rarely useful to an LLM producing test
 * cases — stripped from `allFields` when `omitSystemNoise !== false`.
 */
const SYSTEM_NOISE_FIELDS: readonly string[] = [
  "System.Id",
  "System.Rev",
  "System.ChangedDate",
  "System.ChangedBy",
  "System.CreatedDate",
  "System.CreatedBy",
  "System.AuthorizedDate",
  "System.AuthorizedAs",
  "System.RevisedDate",
  "System.Watermark",
  "System.NodeName",
  "System.TeamProject",
  "System.WorkItemType",
  "System.BoardColumn",
  "System.BoardColumnDone",
  "System.BoardLane",
  "System.CommentCount",
  "System.PersonId",
  "System.ExternalLinkCount",
  "System.HyperLinkCount",
  "System.AttachedFileCount",
  "System.RelatedLinkCount",
  "Microsoft.VSTS.Common.StateChangeDate",
  "Microsoft.VSTS.Common.ActivatedDate",
  "Microsoft.VSTS.Common.ActivatedBy",
  "Microsoft.VSTS.Common.ResolvedDate",
  "Microsoft.VSTS.Common.ResolvedBy",
  "Microsoft.VSTS.Common.ClosedDate",
  "Microsoft.VSTS.Common.ClosedBy",
];

const NON_CONFLUENCE_WORKAROUND: Record<string, string> = {
  SharePoint:
    "Open the SharePoint link and paste the relevant content into the ADO field.",
  Figma:
    "Open the Figma link and paste a screenshot into the ADO field, or add key details to Solution Notes.",
  LucidChart:
    "Open the LucidChart link, export the diagram as an image, and attach to the ADO work item.",
  GoogleDrive:
    "Download the file from Google Drive and paste the content into the ADO field, or upload as an ADO attachment.",
  Other:
    "Unrecognized link type; fetch content manually if relevant to test design.",
};

export function registerWorkItemTools(
  server: McpServer,
  client: AdoClient,
  confluenceClient: ConfluenceClient | null
) {
  server.registerTool(
    "ado_story",
    {
      title: "Read User Story",
      description:
        "Fetch a User Story from ADO with description, acceptance criteria, parent info, Solution Design content from Confluence, and all relations",
      inputSchema: {
        workItemId: z
          .number()
          .int()
          .positive()
          .describe("The ADO work item ID of the User Story"),
      },
      outputSchema: READ_OUTPUT_SCHEMA,
    },
    async ({ workItemId }) => {
      try {
        const item = await client.get<AdoWorkItem>(
          `/_apis/wit/workitems/${workItemId}`,
          "7.0",
          { "$expand": "relations" }
        );

        const context = await extractUserStoryContext(item, client, confluenceClient);
        const config = loadConventionsConfig();
        const { content, withUrl } = buildGetUserStoryResponse(context, {
          webUrl: adoWorkItemUrl(client, context.id),
          returnMcpImageParts: config.images?.returnMcpImageParts === true,
          maxTotalBytesPerResponse: config.images?.maxTotalBytesPerResponse ?? 4194304,
        });
        const canonical = buildUserStoryCanonicalResult(withUrl);
        return {
          content,
          structuredContent: canonical as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error fetching US#${workItemId}: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_tests",
    {
      title: "List Test Cases for User Story",
      description:
        "Get test case work item IDs linked to a User Story via Tests/Tested By relation. Use before cloning test cases from one US to another.",
      inputSchema: {
        userStoryId: z.number().int().positive().describe("The User Story work item ID"),
      },
      outputSchema: READ_OUTPUT_SCHEMA,
    },
    async ({ userStoryId }) => {
      try {
        const item = await client.get<AdoWorkItem>(
          `/_apis/wit/workitems/${userStoryId}`,
          "7.0",
          { "$expand": "relations" }
        );
        const relations = item.relations ?? [];
        const testedByRels = relations.filter(
          (r) =>
            r.rel === "Microsoft.VSTS.Common.TestedBy" ||
            r.rel === "Microsoft.VSTS.Common.TestedBy-Forward"
        );
        const ids = testedByRels
          .map((r) => {
            const parts = r.url.split("/");
            const id = parseInt(parts[parts.length - 1], 10);
            return isNaN(id) ? null : id;
          })
          .filter((id): id is number => id != null);
        const testCases = ids.map((id) => ({ id, webUrl: adoWorkItemUrl(client, id) }));
        const prose = JSON.stringify({
          userStoryId,
          userStoryWebUrl: adoWorkItemUrl(client, userStoryId),
          testCases,
          testCaseIds: ids,
          count: ids.length,
        }, null, 2);
        const canonical = buildLinkedTestCasesCanonicalResult(userStoryId, testCases);
        return {
          content: [{ type: "text" as const, text: prose }],
          structuredContent: canonical as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error listing linked test cases: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "ado_fields",
    {
      title: "List Work Item Fields",
      description:
        "List all work item field definitions in the ADO project. Returns reference names (e.g. Custom.PrerequisiteforTest, System.Title) and metadata. Use to verify field names before updating work items.",
      inputSchema: {
        expand: z.string().optional().describe("Optional. Use 'ExtensionFields' to include extension fields."),
      },
      outputSchema: READ_OUTPUT_SCHEMA,
    },
    async ({ expand }) => {
      try {
        const queryParams = expand ? { "$expand": expand } : undefined;
        const result = await client.get<{ value: Array<{ referenceName: string; name: string; type: string; readOnly?: boolean }> }>(
          "/_apis/wit/fields",
          "7.1",
          queryParams
        );
        const fields = (result.value ?? []).map((f, i) => ({
          id: i + 1,
          referenceName: f.referenceName,
          name: f.name,
          type: f.type,
          readOnly: f.readOnly ?? false,
        }));
        const prose = JSON.stringify({ count: fields.length, value: fields }, null, 2);
        const canonical = buildFieldInventoryCanonicalResult(fields);
        return {
          content: [{ type: "text" as const, text: prose }],
          structuredContent: canonical as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error listing fields: ${err}` }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Build the full `UserStoryContext` payload: primary fields, parent resolution,
 * all-fields pass-through, configured-named rich-text fields with plaintext,
 * Confluence link fetching (with cross-instance/budget gating), ADO image
 * extraction, and backward-compatible deprecated aliases (solutionDesignUrl,
 * solutionDesignContent).
 *
 * Exported for testing. Internal to the `ado_story` tool otherwise.
 */
export async function extractUserStoryContext(
  item: AdoWorkItem,
  adoClient: AdoClient,
  confluenceClient: ConfluenceClient | null
): Promise<UserStoryContext> {
  const config = loadConventionsConfig();
  const fields = item.fields;
  const relations = item.relations ?? [];

  // ── Primary fields (preserved shape) ─────────────────────────────────────
  const title = (fields["System.Title"] as string) ?? "";
  const description = (fields["System.Description"] as string) ?? "";
  const acceptanceCriteria =
    (fields["Microsoft.VSTS.Common.AcceptanceCriteria"] as string) ?? "";
  const areaPath = (fields["System.AreaPath"] as string) ?? "";
  const iterationPath = (fields["System.IterationPath"] as string) ?? "";
  const state = (fields["System.State"] as string) ?? "";

  // ── Parent resolution (preserved) ─────────────────────────────────────────
  let parentId: number | null = null;
  let parentTitle: string | null = null;
  const parentRelation = relations.find(
    (r) => r.rel === "System.LinkTypes.Hierarchy-Reverse"
  );
  if (parentRelation) {
    const urlParts = parentRelation.url.split("/");
    parentId = parseInt(urlParts[urlParts.length - 1], 10) || null;
    parentTitle = (parentRelation.attributes?.["name"] as string) || null;
  }
  if (!parentTitle && fields["System.Parent"] != null) {
    const p = Number(fields["System.Parent"]);
    parentId = Number.isFinite(p) && p > 0 ? p : parentId;
  }

  // ── allFields pass-through (system-noise + extras filtered) ──────────────
  const noiseSet = new Set<string>(SYSTEM_NOISE_FIELDS);
  if (config.allFields?.omitExtraRefs) {
    for (const ref of config.allFields.omitExtraRefs) noiseSet.add(ref);
  }
  const allFields: Record<string, unknown> = {};
  const passThrough = config.allFields?.passThrough !== false;
  const omitNoise = config.allFields?.omitSystemNoise !== false;
  if (passThrough) {
    for (const [ref, value] of Object.entries(fields)) {
      if (omitNoise && noiseSet.has(ref)) continue;
      if (value == null || value === "") continue;
      allFields[ref] = value;
    }
  }

  // ── namedFields (primaries + configured additional context fields) ───────
  const solutionFieldRef =
    config.solutionDesign?.adoFieldRef ?? "Custom.TechnicalSolution";
  const namedFieldDefs: Array<{ ref: string; label: string }> = [
    { ref: "System.Title", label: "Title" },
    { ref: "System.Description", label: "Description" },
    {
      ref: "Microsoft.VSTS.Common.AcceptanceCriteria",
      label: "Acceptance Criteria",
    },
    { ref: solutionFieldRef, label: config.solutionDesign?.uiLabel ?? "Solution Notes" },
    ...(config.additionalContextFields ?? []).map((a) => ({
      ref: a.adoFieldRef,
      label: a.label,
    })),
  ];
  const namedFields: Record<
    string,
    { label: string; html: string; plainText: string }
  > = {};
  for (const def of namedFieldDefs) {
    const raw = fields[def.ref];
    if (raw == null || raw === "") continue;
    const html = String(raw);
    namedFields[def.ref] = {
      label: def.label,
      html,
      plainText: stripHtml(html),
    };
  }

  // ── Link extraction (across scanned fields) ──────────────────────────────
  const fetchedConfluencePages: FetchedConfluencePage[] = [];
  const unfetchedLinks: UnfetchedLink[] = [];
  const maxConfluencePages =
    config.context?.maxConfluencePagesPerUserStory ?? 10;
  const maxTotalFetchMs = (config.context?.maxTotalFetchSeconds ?? 45) * 1000;
  const startTime = Date.now();

  // Every primary namedField is scanned by default. Additional fields respect
  // their `fetchLinks` flag (defaults to true per config schema).
  const linkFields: Array<{ ref: string; html: string }> = [];
  for (const def of namedFieldDefs) {
    const f = namedFields[def.ref];
    if (!f) continue;
    const cfg = config.additionalContextFields?.find(
      (a) => a.adoFieldRef === def.ref
    );
    const shouldScan = cfg ? cfg.fetchLinks !== false : true;
    if (shouldScan) linkFields.push({ ref: def.ref, html: f.html });
  }

  // Collect categorized links across all scanned fields (doc order, dedup by URL).
  const allLinks: CategorizedLink[] = [];
  const seenLinkUrls = new Set<string>();
  for (const { ref, html } of linkFields) {
    for (const link of extractAllLinks(html, ref)) {
      if (seenLinkUrls.has(link.url)) continue;
      seenLinkUrls.add(link.url);
      allLinks.push(link);
    }
  }

  // Configured Confluence host (for cross-instance gating).
  let configuredConfluenceHost: string | null = null;
  if (confluenceClient) {
    try {
      configuredConfluenceHost = new URL(confluenceClient.baseUrl).hostname;
    } catch {
      /* ignore */
    }
  }

  // Partition Confluence vs other links; apply link-budget cap to Confluence.
  const confluenceLinks = allLinks.filter((l) => l.type === "Confluence");
  const nonConfluenceLinks = allLinks.filter((l) => l.type !== "Confluence");

  const fetchableConfluence: CategorizedLink[] = [];
  const overflow: CategorizedLink[] = [];
  for (const link of confluenceLinks) {
    let linkHost: string | null = null;
    try {
      linkHost = new URL(link.url).hostname;
    } catch {
      /* ignore */
    }
    if (
      configuredConfluenceHost &&
      linkHost &&
      linkHost !== configuredConfluenceHost
    ) {
      unfetchedLinks.push({
        url: link.url,
        type: "Confluence",
        sourceField: link.sourceField,
        reason: "cross-instance",
        workaround: `Cross-instance Confluence link (${linkHost}); configure that instance or paste the page content manually.`,
      });
      continue;
    }
    if (fetchableConfluence.length >= maxConfluencePages) {
      overflow.push(link);
      continue;
    }
    fetchableConfluence.push(link);
  }

  for (const link of overflow) {
    unfetchedLinks.push({
      url: link.url,
      type: link.type,
      sourceField: link.sourceField,
      reason: "link-budget",
      workaround: `Exceeded maxConfluencePagesPerUserStory (${maxConfluencePages}); raise the cap or inspect manually.`,
    });
  }

  for (const link of nonConfluenceLinks) {
    unfetchedLinks.push({
      url: link.url,
      type: link.type,
      sourceField: link.sourceField,
      reason: "non-confluence",
      workaround:
        NON_CONFLUENCE_WORKAROUND[link.type] ?? NON_CONFLUENCE_WORKAROUND.Other,
    });
  }

  // ── Image guardrails (shared between Confluence + ADO extractors) ────────
  const imagesCfg = config.images;
  const maxPerUS = imagesCfg?.maxPerUserStory ?? 20;
  const imageGuardrails = {
    maxBytesPerImage: imagesCfg?.maxBytesPerImage ?? 2097152,
    minBytesToKeep: imagesCfg?.minBytesToKeep ?? 4096,
    downscaleLongSidePx: imagesCfg?.downscaleLongSidePx ?? 1600,
    downscaleQuality: imagesCfg?.downscaleQuality ?? 85,
    mimeAllowlist: imagesCfg?.mimeAllowlist ?? [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/svg+xml",
    ],
    inlineSvgAsText: imagesCfg?.inlineSvgAsText ?? true,
  };

  // ── Fetch each in-scope Confluence page ──────────────────────────────────
  const allEmbeddedImages: EmbeddedImage[] = [];
  const countKept = () => allEmbeddedImages.filter((i) => !i.skipped).length;

  if (confluenceClient) {
    for (const link of fetchableConfluence) {
      if (Date.now() - startTime > maxTotalFetchMs) {
        unfetchedLinks.push({
          url: link.url,
          type: "Confluence",
          sourceField: link.sourceField,
          reason: "time-budget",
          workaround: `Exceeded maxTotalFetchSeconds (${maxTotalFetchMs / 1000}); raise the cap or inspect manually.`,
        });
        continue;
      }

      const pageId = link.pageId;
      if (!pageId) {
        unfetchedLinks.push({
          url: link.url,
          type: "Confluence",
          sourceField: link.sourceField,
          reason: "not-found",
          workaround: "Could not extract Confluence page ID from URL.",
        });
        continue;
      }

      try {
        const page = await confluenceClient.getPageContentRaw(pageId);
        const pageImages = await fetchCurrentVersionAttachments({
          pageId,
          storageHtml: page.rawStorageHtml,
          confluenceClient,
          guardrails: imageGuardrails,
        });

        // Respect maxPerUS across combined ADO + Confluence kept images.
        for (const img of pageImages) {
          if (!img.skipped && countKept() >= maxPerUS) break;
          allEmbeddedImages.push(img);
        }

        fetchedConfluencePages.push({
          pageId,
          title: page.title,
          url: link.url,
          body: page.body,
          sourceField: link.sourceField,
          images: pageImages,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const reason: UnfetchedLink["reason"] = /401/.test(msg)
          ? "auth-failure"
          : /403/.test(msg)
            ? "access-denied"
            : /404/.test(msg)
              ? "not-found"
              : "access-denied";
        unfetchedLinks.push({
          url: link.url,
          type: "Confluence",
          sourceField: link.sourceField,
          reason,
          workaround: `Could not fetch Confluence page: ${msg}`,
        });
      }
    }
  }

  // ── ADO image extraction across all HTML-valued fields ───────────────────
  const htmlFieldValues: Record<string, string> = {};
  for (const [ref, f] of Object.entries(namedFields)) {
    htmlFieldValues[ref] = f.html;
  }
  for (const [ref, value] of Object.entries(allFields)) {
    if (ref in htmlFieldValues) continue;
    if (typeof value === "string" && /<img\b/i.test(value)) {
      htmlFieldValues[ref] = value;
    }
  }

  if (Object.keys(htmlFieldValues).length > 0) {
    const remaining = maxPerUS - countKept();
    if (remaining > 0) {
      try {
        const adoImages = await extractAndFetchAdoImages({
          fieldValuesByRef: htmlFieldValues,
          adoClient,
          userStoryId: item.id,
          guardrails: {
            maxPerUserStory: remaining,
            ...imageGuardrails,
          },
        });
        allEmbeddedImages.push(...adoImages);
      } catch {
        /* failure isolation — never break context */
      }
    }
  }

  // ── Deprecated aliases (backward compatibility) ──────────────────────────
  const solutionNotesHtml = namedFields[solutionFieldRef]?.html;
  const firstConfluencePage = fetchedConfluencePages[0];
  const solutionDesignUrl =
    firstConfluencePage?.url ??
    (solutionNotesHtml ? extractConfluenceUrl(solutionNotesHtml) : null) ??
    null;
  const solutionDesignContent = firstConfluencePage
    ? `# ${firstConfluencePage.title}\n\n${firstConfluencePage.body}`
    : null;

  return {
    id: item.id,
    title,
    description,
    acceptanceCriteria,
    areaPath,
    iterationPath,
    state,
    parentId,
    parentTitle,
    relations,
    namedFields,
    allFields,
    fetchedConfluencePages,
    unfetchedLinks,
    embeddedImages: allEmbeddedImages,
    solutionDesignUrl,
    solutionDesignContent,
  };
}

/**
 * Return a JSON-safe clone of `UserStoryContext` with every `_buffer` stripped
 * from embedded images (ADO and Confluence). `_buffer` holds raw attachment
 * bytes used only to build MCP image content parts; it MUST NOT leak into the
 * serialized JSON text part.
 */
function stripImageBuffers(context: UserStoryContext): UserStoryContext {
  const stripOne = (img: EmbeddedImage): EmbeddedImage => {
    const { _buffer: _unused, ...rest } = img;
    return rest;
  };
  return {
    ...context,
    embeddedImages: context.embeddedImages?.map(stripOne),
    fetchedConfluencePages: context.fetchedConfluencePages?.map((p) => ({
      ...p,
      images: p.images.map(stripOne),
    })),
  };
}

export interface BuildGetUserStoryResponseOptions {
  webUrl: string;
  returnMcpImageParts: boolean;
  maxTotalBytesPerResponse: number;
}

/**
 * Pack a `UserStoryContext` into the MCP tool response shape. When
 * `returnMcpImageParts` is true, successfully-fetched embedded images are
 * appended as `type: "image"` content parts (ADO first, then Confluence pages
 * in fetch order) until `maxTotalBytesPerResponse` (applied to the combined
 * base64 size) is reached — overflowed images are mutated to
 * `skipped: "response-budget"` so the JSON text part accurately reports them.
 * Exported for direct unit testing without touching the config singleton.
 */
export function buildGetUserStoryResponse(
  context: UserStoryContext,
  options: BuildGetUserStoryResponseOptions,
): {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  /**
   * Post-strip UserStoryContext merged with `webUrl`. Exposed so the
   * tool handler can synthesise a CanonicalReadResult from the same
   * data that was serialised into the text part (no double-stripping).
   */
  withUrl: UserStoryContext & { webUrl: string };
} {
  const { webUrl, returnMcpImageParts, maxTotalBytesPerResponse } = options;

  // Collect every successfully-fetched image across ADO + Confluence, in
  // source-doc order (ADO first, then Confluence pages in fetch order).
  // These references alias the objects in `context`, so mutating `skipped`
  // below propagates into the JSON text part.
  const allImages: EmbeddedImage[] = [
    ...(context.embeddedImages ?? []),
    ...(context.fetchedConfluencePages ?? []).flatMap((p) => p.images),
  ];

  const imageParts: Array<{ type: "image"; data: string; mimeType: string }> = [];
  if (returnMcpImageParts) {
    let runningBase64Bytes = 0;
    for (const img of allImages) {
      if (img.skipped || !img._buffer) continue;
      // base64 encoding is ~4/3 raw bytes (round up)
      const estBase64 = Math.ceil((img._buffer.byteLength * 4) / 3);
      if (runningBase64Bytes + estBase64 > maxTotalBytesPerResponse) {
        // Mark this image as response-budget skipped (before JSON stringify).
        img.skipped = "response-budget";
        continue;
      }
      runningBase64Bytes += estBase64;
      imageParts.push({
        type: "image",
        data: Buffer.from(img._buffer).toString("base64"),
        mimeType: img.mimeType,
      });
    }
  }

  // Strip _buffer from every image AFTER the packing loop (mutations to
  // skipped above must still be captured in the JSON).
  const stripped = stripImageBuffers(context);
  const withUrl = { ...stripped, webUrl };

  return {
    content: [
      { type: "text" as const, text: JSON.stringify(withUrl, null, 2) },
      ...imageParts,
    ],
    withUrl,
  };
}

/**
 * Synthesise the canonical read result for `ado_story` from the
 * same `UserStoryContext + webUrl` that was serialised into the prose.
 *
 * - `item.type` = "user-story"
 * - `item.summary` is a 500-char stripped-HTML excerpt of description.
 * - `children`: the parent (if any). Linked test cases require a
 *   second API call (`qa_tests`) that this
 *   tool deliberately doesn't make — documented skip.
 * - `artifacts`: one entry per fetched Confluence page
 *   (`kind: "solution-design"`) and one per successfully-attached
 *   image (`kind: "image"`). Skipped images are reported as
 *   diagnostics instead.
 * - `completeness.isPartial = true` if any unfetched links are present
 *   OR any image is marked `skipped: "fetch-failed"`.
 */
export function buildUserStoryCanonicalResult(
  withUrl: UserStoryContext & { webUrl: string },
): CanonicalReadResult {
  const children: CanonicalReadChild[] = [];
  if (withUrl.parentId != null) {
    children.push({
      id: withUrl.parentId,
      type: "work-item",
      title: withUrl.parentTitle ?? `#${withUrl.parentId}`,
      relationship: "parent",
    });
  }

  const artifacts: CanonicalReadArtifact[] = [];
  for (const page of withUrl.fetchedConfluencePages ?? []) {
    artifacts.push({
      kind: "solution-design",
      title: page.title,
      url: page.url,
    });
  }
  const allImages = [
    ...(withUrl.embeddedImages ?? []),
    ...(withUrl.fetchedConfluencePages ?? []).flatMap((p) => p.images),
  ];
  for (const img of allImages) {
    if (img.skipped) continue;
    artifacts.push({
      kind: "image",
      title: img.filename,
      url: img.originalUrl,
    });
  }

  const diagnostics: CanonicalReadDiagnostic[] = [];
  for (const link of withUrl.unfetchedLinks ?? []) {
    diagnostics.push({
      severity: "warning",
      message: `Unfetched link (${link.reason}): ${link.url}`,
    });
  }
  const fetchFailedImages = allImages.filter(
    (i) => i.skipped === "fetch-failed",
  );
  if (fetchFailedImages.length > 0) {
    diagnostics.push({
      severity: "warning",
      message: `${fetchFailedImages.length} image${fetchFailedImages.length === 1 ? "" : "s"} failed to fetch`,
    });
  }

  const unfetchedCount = withUrl.unfetchedLinks?.length ?? 0;
  const isPartial = unfetchedCount > 0 || fetchFailedImages.length > 0;
  let partialReason: string | undefined;
  if (isPartial) {
    const parts: string[] = [];
    if (unfetchedCount > 0) {
      parts.push(`${unfetchedCount} unfetched link${unfetchedCount === 1 ? "" : "s"}`);
    }
    if (fetchFailedImages.length > 0) {
      parts.push(`${fetchFailedImages.length} image fetch failure${fetchFailedImages.length === 1 ? "" : "s"}`);
    }
    partialReason = parts.join(", ");
  }

  return {
    item: {
      id: withUrl.id,
      type: "user-story",
      title: withUrl.title,
      summary: stripHtml(withUrl.description ?? "").slice(0, 500) || undefined,
    },
    ...(children.length > 0 ? { children } : {}),
    ...(artifacts.length > 0 ? { artifacts } : {}),
    completeness: {
      isPartial,
      ...(partialReason ? { reason: partialReason } : {}),
    },
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

/**
 * Build the CanonicalReadResult for `qa_tests`.
 *
 * - `item.type` = "user-story" (the US is the read target; the tool
 *   reports the set of test cases linked to it).
 * - `children[]` = one entry per test case linked via a TestedBy
 *   relation, `relationship: "tested-by"`.
 * - `completeness.isPartial` = false; the TestedBy relation set is
 *   fully returned by the single ADO call.
 */
export function buildLinkedTestCasesCanonicalResult(
  userStoryId: number,
  testCases: Array<{ id: number }>,
): CanonicalReadResult {
  const ids = testCases.map((tc) => tc.id);
  return {
    item: {
      id: userStoryId,
      type: "user-story",
      title: `Test cases linked to US #${userStoryId}`,
      summary: `${ids.length} test case${ids.length === 1 ? "" : "s"} linked via TestedBy relation`,
    },
    children: testCases.map((tc) => ({
      id: tc.id,
      type: "test-case",
      title: `Test Case #${tc.id}`,
      relationship: "tested-by",
    })),
    completeness: { isPartial: false },
  };
}

/**
 * Build the CanonicalReadResult for `ado_fields`.
 *
 * - `item.type` = "field-inventory"; the read target is the whole
 *   project field catalogue.
 * - `children[]` is capped at 50 entries (ADO projects typically have
 *   200+ fields; the full list stays in the prose text part). The
 *   cap keeps `structuredContent` navigable without losing honest
 *   completeness reporting.
 * - `completeness.isPartial` = true iff the cap truncates the list,
 *   with a reason describing the truncation.
 */
export function buildFieldInventoryCanonicalResult(
  fields: Array<{ referenceName: string; name: string }>,
): CanonicalReadResult {
  const CAP = 50;
  return {
    item: {
      id: "ado-wit-fields",
      type: "field-inventory",
      title: "ADO Work Item Field Definitions",
      summary: `${fields.length} field${fields.length === 1 ? "" : "s"} defined in the project`,
    },
    children: fields.slice(0, CAP).map((f) => ({
      id: f.referenceName,
      type: "field-definition",
      title: f.name,
      relationship: "defined",
    })),
    completeness: {
      isPartial: fields.length > CAP,
      ...(fields.length > CAP
        ? { reason: `Showing ${CAP} of ${fields.length} fields; full list in the text content.` }
        : {}),
    },
  };
}
