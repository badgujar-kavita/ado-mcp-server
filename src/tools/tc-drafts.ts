import { z } from "zod";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoClient } from "../ado-client.ts";
import type { AdoWorkItem } from "../types.ts";
import { getTcDraftsDir } from "../credentials.ts";
import { formatTcDraftToMarkdown, type TcDraftData, type TcDraftTestCase } from "../helpers/tc-draft-formatter.ts";
import { parseTcDraftFromMarkdown } from "../helpers/tc-draft-parser.ts";
import { adoWorkItemUrl } from "../helpers/ado-urls.ts";
import { createTestCase, updateTestCaseFromParams, type CreateTestCaseParams } from "./test-cases.ts";
import { ensureSuiteHierarchyForUs } from "./test-suites.ts";
import { READ_OUTPUT_SCHEMA, type CanonicalReadResult } from "./read-result.ts";
import { resolveTagsMatchOnly } from "../helpers/tag-resolver.ts";
import { analyzePushState } from "../helpers/push-state-analyzer.ts";

async function fetchLinkedTestCaseIds(adoClient: AdoClient, userStoryId: number): Promise<number[]> {
  const us = await adoClient.get<AdoWorkItem>(
    `/_apis/wit/workitems/${userStoryId}`,
    "7.0",
    { "$expand": "relations" }
  );
  return (us.relations ?? [])
    .filter((r) => r.rel === "Microsoft.VSTS.Common.TestedBy" || r.rel === "Microsoft.VSTS.Common.TestedBy-Forward")
    .map((r) => {
      const parts = r.url.split("/");
      const id = parseInt(parts[parts.length - 1], 10);
      return isNaN(id) ? null : id;
    })
    .filter((id): id is number => id != null);
}

/**
 * Fetch linked TC IDs AND their titles, so analyzePushState() can parse
 * TC numbers out of the titles for the mapping proposal. Parallel is fine —
 * ADO's work-item endpoints handle concurrent reads comfortably.
 */
async function fetchLinkedTestCasesWithTitles(
  adoClient: AdoClient,
  userStoryId: number,
): Promise<Array<{ id: number; title: string }>> {
  const linkedIds = await fetchLinkedTestCaseIds(adoClient, userStoryId);
  if (linkedIds.length === 0) return [];
  const results = await Promise.all(
    linkedIds.map(async (id) => {
      try {
        const wi = await adoClient.get<AdoWorkItem>(
          `/_apis/wit/workitems/${id}`,
          "7.0",
          { fields: "System.Title" },
        );
        return { id, title: (wi.fields["System.Title"] as string) ?? `TC #${id}` };
      } catch {
        return { id, title: `TC #${id} (title fetch failed)` };
      }
    }),
  );
  return results;
}

const NO_PATH_MSG =
  "No draft location specified. Open a folder in your workspace (drafts will go to <folder>/tc-drafts) or provide draftsPath, or set TC_DRAFTS_PATH / tc_drafts_path in credentials.";

/** Convert an absolute file path to a file:// URI that Cursor can open on click. */
function toFileUri(absolutePath: string): string {
  const encoded = absolutePath.split("/").map(encodeURIComponent).join("/");
  return `file://${encoded}`;
}

/**
 * Apply post-push edits to the draft markdown IN PLACE.
 *
 * Rationale: the previous implementation round-tripped the file through
 * parseTcDraftFromMarkdown → TcDraftData → formatTcDraftToMarkdown, which
 * silently stripped any reviewer-added custom content (Test Data rows,
 * per-TC Pre-requisite blocks, Coverage Checklists, reviewer Notes, etc.)
 * because TcDraftData only captures parser-known fields.
 *
 * In-place edits mutate ONLY two things:
 *   1. Flip `| **Status** | DRAFT |` → `| **Status** | APPROVED |` in the header
 *   2. Append ` (ADO #<id>)` to each TC title line `**TC_<usid>_<nn> -> ...**`
 *
 * Idempotent: re-running on already-approved / already-suffixed content is a no-op.
 * Preserves every other byte of the draft file.
 */
export function applyPostPushEditsInPlace(
  originalMd: string,
  userStoryId: number,
  testCaseAdoIds: Array<{ tcNumber: number; adoId: number }>,
): { updatedMd: string; statusFlipped: boolean; titlesUpdated: number; titlesSkipped: number[] } {
  let updated = originalMd;
  let statusFlipped = false;
  let titlesUpdated = 0;
  const titlesSkipped: number[] = [];

  // Step 1: flip Status DRAFT → APPROVED (table-row regex, anchored to header block)
  const statusRe = /^\|\s*\*\*Status\*\*\s*\|\s*DRAFT\s*\|$/m;
  if (statusRe.test(updated)) {
    updated = updated.replace(statusRe, "| **Status** | APPROVED |");
    statusFlipped = true;
  }

  // Step 2: append (ADO #N) to each TC title line
  // Title format: `**TC_<usid>_<nn> -> ...**` (possibly already suffixed with ` (ADO #N)`)
  for (const { tcNumber, adoId } of testCaseAdoIds) {
    const padded = String(tcNumber).padStart(2, "0");
    const titleRe = new RegExp(
      `^\\*\\*TC_${userStoryId}_${padded}\\s*->.*?\\*\\*$`,
      "m",
    );
    const match = updated.match(titleRe);
    if (!match) {
      titlesSkipped.push(tcNumber);
      continue;
    }
    const original = match[0];
    // Idempotent: if the title already ends with " (ADO #<id>)**", skip
    if (/\s*\(ADO\s*#\d+\)\*\*$/.test(original)) {
      continue;
    }
    // Insert " (ADO #<id>)" before the closing **
    const suffixed = original.replace(/\*\*$/, ` (ADO #${adoId})**`);
    updated = updated.replace(original, suffixed);
    titlesUpdated += 1;
  }

  return { updatedMd: updated, statusFlipped, titlesUpdated, titlesSkipped };
}

/**
 * Resolve tc-drafts directory. No hardcoded default.
 * Priority: draftsPath (user choice) > workspaceRoot/tc-drafts > credentials/env.
 * Creates folder if it doesn't exist.
 */
function resolveTcDraftsDir(workspaceRoot?: string | null, draftsPath?: string | null): string {
  if (draftsPath?.trim()) {
    return resolve(draftsPath.trim());
  }
  if (workspaceRoot?.trim()) {
    return join(resolve(workspaceRoot.trim()), "tc-drafts");
  }
  const fromConfig = getTcDraftsDir();
  if (fromConfig) return fromConfig;
  throw new Error(NO_PATH_MSG);
}

/** Resolve the per-US folder path: tc-drafts/US_<id>/ */
function resolveUsFolder(tcDraftsDir: string, usId: number): string {
  return join(tcDraftsDir, `US_${usId}`);
}

/**
 * Resolve the test-cases markdown path with backward compat.
 * Subfolder layout preferred, flat fallback for legacy drafts.
 */
function resolveTestCasesMdPath(tcDraftsDir: string, usId: number): string {
  const subPath = join(resolveUsFolder(tcDraftsDir, usId), `US_${usId}_test_cases.md`);
  if (existsSync(subPath)) return subPath;
  const flatPath = join(tcDraftsDir, `US_${usId}_test_cases.md`);
  if (existsSync(flatPath)) return flatPath; // legacy
  return subPath; // default to new layout for writes
}

/** Check which supporting docs exist for a US folder */
function checkSupportingDocs(usFolder: string, usId: number): { hasSummary: boolean; hasCheatSheet: boolean } {
  return {
    hasSummary: existsSync(join(usFolder, `US_${usId}_solution_design_summary.md`)),
    hasCheatSheet: existsSync(join(usFolder, `US_${usId}_qa_cheat_sheet.md`)),
  };
}

/** Parse header fields from markdown for qa_drafts_list. */
function parseMarkdownHeader(mdContent: string): { userStoryId: number; title: string; status: string; version: number } | null {
  const titleMatch = mdContent.match(/^# Test Cases: US #(\d+) — (.+)$/m);
  if (!titleMatch) return null;
  const userStoryId = parseInt(titleMatch[1], 10);
  const title = titleMatch[2].replace(/&#124;/g, "|").trim();
  const statusMatch = mdContent.match(/\|\s*\*\*Status\*\*\s*\|\s*([^|]+)\|/);
  const status = statusMatch ? statusMatch[1].trim() : "DRAFT";
  const versionMatch = mdContent.match(/\|\s*\*\*Version\*\*\s*\|\s*(\d+)\s*\|/);
  const version = versionMatch ? parseInt(versionMatch[1], 10) : 1;
  return { userStoryId, title, status, version };
}

const StepSchema = z.object({
  action: z.string(),
  expectedResult: z.string(),
});

const PrerequisitesSchema = z.object({
  personas: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
  preConditions: z.array(z.string()).nullable().optional(),
  testData: z.string().nullable().optional(),
}).optional();

const SaveTcDraftShape = {
  userStoryId: z.number().int().positive().describe("User Story work item ID"),
  storyTitle: z.string().describe("Story title"),
  storyState: z.string().describe("Story state"),
  areaPath: z.string().describe("Area path from US"),
  iterationPath: z.string().describe("Iteration path from US"),
  parentId: z.number().int().positive().optional().describe("Parent work item ID"),
  parentTitle: z.string().optional().describe("Parent title"),
  planId: z.number().int().positive().optional().describe("Test plan ID (optional; will be auto-derived from US AreaPath during push if not provided)"),
  version: z.number().int().positive().describe("Draft version (increment on revision)"),
  functionalityProcessFlow: z.string().optional().describe("Mermaid or process diagram based on understanding of the flow"),
  testCoverageInsights: z.array(z.object({
    scenario: z.string().describe("Scenario description"),
    covered: z.boolean().describe("Whether this scenario is covered by a test case"),
    positiveNegative: z.enum(["P", "N"]).describe("P = Positive, N = Negative"),
    functionalNonFunctional: z.enum(["F", "NF"]).describe("F = Functional, NF = Non-Functional"),
    priority: z.enum(["High", "Medium", "Low"]).describe("Scenario priority"),
    notes: z.string().optional().describe("Optional concise note"),
  })).optional().describe("Classified coverage scenarios with P/N, F/NF, priority for Test Coverage Insights"),
  testCases: z.array(z.object({
    tcNumber: z.number().int().positive(),
    featureTags: z.array(z.string()).min(1),
    useCaseSummary: z.string(),
    priority: z.number().int().min(1).max(4).optional(),
    prerequisites: PrerequisitesSchema,
    steps: z.array(StepSchema).min(1),
  })).describe("Array of test cases"),
  commonPrerequisites: PrerequisitesSchema.optional().describe("Shared prerequisites for all TCs"),
  workspaceRoot: z.string().optional().describe("Project folder path; drafts go to workspaceRoot/tc-drafts (created if missing)"),
  draftsPath: z.string().optional().describe("Exact path where to save drafts; use when user specifies a location. Overrides workspaceRoot."),
};

export function registerTcDraftTools(server: McpServer, adoClient: AdoClient) {
  server.registerTool(
    "qa_draft_save",
    {
      title: "Save Test Case Draft",
      description: "Save a test case draft to tc-drafts/US_<id>/ as markdown only. JSON is created only when pushing to ADO. Pass workspaceRoot (open folder) or draftsPath (user-specified location). Creates tc-drafts/US_<id>/ folder if missing. No hardcoded default path.",
      inputSchema: SaveTcDraftShape,
    },
    async (input) => {
      try {
        const tcDraftsDir = resolveTcDraftsDir(input.workspaceRoot, input.draftsPath);
        const usFolder = resolveUsFolder(tcDraftsDir, input.userStoryId);
        mkdirSync(usFolder, { recursive: true });

        const now = new Date().toISOString().slice(0, 10);
        const data: TcDraftData = {
          userStoryId: input.userStoryId,
          storyTitle: input.storyTitle,
          storyState: input.storyState,
          areaPath: input.areaPath,
          iterationPath: input.iterationPath,
          parentId: input.parentId,
          parentTitle: input.parentTitle,
          planId: input.planId ?? undefined,
          version: input.version,
          status: "DRAFT",
          lastUpdated: now,
          functionalityProcessFlow: input.functionalityProcessFlow,
          testCoverageInsights: input.testCoverageInsights,
          testCases: input.testCases.map((tc: TcDraftTestCase) => ({
            ...tc,
            adoWorkItemId: undefined,
          })),
          commonPrerequisites: input.commonPrerequisites,
        };

        const mdPath = join(usFolder, `US_${input.userStoryId}_test_cases.md`);

        const markdown = formatTcDraftToMarkdown(data);
        writeFileSync(mdPath, markdown, "utf-8");

        const fileName = `US_${input.userStoryId}_test_cases.md`;
        const fileUri = toFileUri(mdPath);
        return {
          content: [{
            type: "text" as const,
            text: `Draft saved successfully!\n\n**File:** [${fileName}](${fileUri})\n**Folder:** tc-drafts/US_${input.userStoryId}/\n**Path:** ${mdPath}\n**Version:** ${input.version}\n**Test Cases:** ${input.testCases.length}\n\n_JSON will be generated when you push to ADO. Use qa_draft_doc_save to create solution_design_summary and qa_cheat_sheet files._`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: msg.startsWith("No draft") || msg.startsWith("No ") ? msg : `Error saving draft: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_draft_read",
    {
      title: "Read Test Case Draft",
      description: "Read and return the markdown content of a test case draft for a User Story. Use to show the draft during review. Pass workspaceRoot or draftsPath. Supports both new subfolder (tc-drafts/US_<id>/) and legacy flat layout.",
      inputSchema: {
        userStoryId: z.number().int().positive(),
        workspaceRoot: z.string().optional().describe("Project folder path; reads from workspaceRoot/tc-drafts"),
        draftsPath: z.string().optional().describe("Exact path to drafts folder; overrides workspaceRoot"),
      },
      outputSchema: READ_OUTPUT_SCHEMA,
    },
    async ({ userStoryId, workspaceRoot, draftsPath }) => {
      try {
        const tcDraftsDir = resolveTcDraftsDir(workspaceRoot, draftsPath);
        const mdPath = resolveTestCasesMdPath(tcDraftsDir, userStoryId);
        if (!existsSync(mdPath)) {
          return {
            content: [{ type: "text" as const, text: `No draft found for US ${userStoryId}.` }],
            isError: true,
          };
        }
        const content = readFileSync(mdPath, "utf-8");
        // Append an ADO Links section when the draft has ADO IDs. The file on disk
        // stays unchanged — this is an agent-display convenience so clickable links
        // surface in chat without round-tripping URLs through the markdown format
        // (the parser regex for `(ADO #\d+)` requires `)` right after the digits).
        const parsed = parseTcDraftFromMarkdown(content);
        const tcsWithIds = parsed?.testCases.filter((tc) => tc.adoWorkItemId != null) ?? [];
        let display = content;
        if (tcsWithIds.length > 0 && parsed) {
          const usUrl = adoWorkItemUrl(adoClient, parsed.userStoryId);
          const lines = [
            "",
            "---",
            "",
            "## ADO Links (agent display — not persisted)",
            "",
            `- User Story: [US #${parsed.userStoryId}](${usUrl})`,
            ...tcsWithIds.map((tc) => {
              const label = `TC_${parsed.userStoryId}_${String(tc.tcNumber).padStart(2, "0")}`;
              return `- ${label} → [ADO #${tc.adoWorkItemId}](${adoWorkItemUrl(adoClient, tc.adoWorkItemId!)})`;
            }),
            "",
          ];
          display = content + lines.join("\n");
        }
        const canonical = buildTcDraftCanonicalResult(userStoryId, parsed, mdPath);
        return {
          content: [{ type: "text" as const, text: display }],
          structuredContent: canonical as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: msg.startsWith("No draft") || msg.startsWith("No ") ? msg : `Error reading draft: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_drafts_list",
    {
      title: "List Test Case Drafts",
      description: "List all test case drafts in tc-drafts/ with US ID, title, status, version, and supporting docs. Supports both new subfolder (tc-drafts/US_<id>/) and legacy flat layout. Pass workspaceRoot or draftsPath.",
      inputSchema: {
        workspaceRoot: z.string().optional().describe("Project folder path; lists from workspaceRoot/tc-drafts"),
        draftsPath: z.string().optional().describe("Exact path to drafts folder; overrides workspaceRoot"),
      },
      outputSchema: READ_OUTPUT_SCHEMA,
    },
    async ({ workspaceRoot, draftsPath }) => {
      try {
        const tcDraftsDir = resolveTcDraftsDir(workspaceRoot, draftsPath);
        if (!existsSync(tcDraftsDir)) {
          const canonical = buildTcDraftIndexCanonicalResult(tcDraftsDir, []);
          return {
            content: [{ type: "text" as const, text: `No drafts yet. tc-drafts/ is empty. (Path: ${tcDraftsDir})` }],
            structuredContent: canonical as unknown as Record<string, unknown>,
          };
        }

        const entries: Array<{
          userStoryId: number;
          title: string;
          status: string;
          version: number;
          layout: "subfolder" | "legacy";
          hasSummary: boolean;
          hasCheatSheet: boolean;
        }> = [];
        const seenUsIds = new Set<number>();
        const items = readdirSync(tcDraftsDir, { withFileTypes: true });

        // First pass: check subfolders (new layout)
        for (const item of items) {
          if (item.isDirectory()) {
            const folderMatch = item.name.match(/^US_(\d+)(_.*)?$/);
            if (folderMatch) {
              const usId = parseInt(folderMatch[1], 10);
              const usFolder = join(tcDraftsDir, item.name);
              const mdPath = join(usFolder, `US_${usId}_test_cases.md`);
              if (existsSync(mdPath)) {
                seenUsIds.add(usId);
                const supportingDocs = checkSupportingDocs(usFolder, usId);
                try {
                  const raw = readFileSync(mdPath, "utf-8");
                  const parsed = parseMarkdownHeader(raw);
                  if (parsed) {
                    entries.push({
                      userStoryId: parsed.userStoryId,
                      title: parsed.title,
                      status: parsed.status,
                      version: parsed.version,
                      layout: "subfolder",
                      ...supportingDocs,
                    });
                  } else {
                    entries.push({ userStoryId: usId, title: `US ${usId}`, status: "?", version: 0, layout: "subfolder", ...supportingDocs });
                  }
                } catch {
                  entries.push({ userStoryId: usId, title: `US ${usId}`, status: "?", version: 0, layout: "subfolder", ...supportingDocs });
                }
              }
            }
          }
        }

        // Second pass: check flat files (legacy layout)
        for (const item of items) {
          if (item.isFile() && item.name.endsWith(".md")) {
            const match = item.name.match(/^US_(\d+)_test_cases\.md$/);
            if (match) {
              const usId = parseInt(match[1], 10);
              if (seenUsIds.has(usId)) continue; // Skip if already found in subfolder
              const mdPath = join(tcDraftsDir, item.name);
              try {
                const raw = readFileSync(mdPath, "utf-8");
                const parsed = parseMarkdownHeader(raw);
                if (parsed) {
                  entries.push({
                    userStoryId: parsed.userStoryId,
                    title: parsed.title,
                    status: parsed.status,
                    version: parsed.version,
                    layout: "legacy",
                    hasSummary: false,
                    hasCheatSheet: false,
                  });
                } else {
                  entries.push({ userStoryId: usId, title: `US ${usId}`, status: "?", version: 0, layout: "legacy", hasSummary: false, hasCheatSheet: false });
                }
              } catch {
                entries.push({ userStoryId: usId, title: `US ${usId}`, status: "?", version: 0, layout: "legacy", hasSummary: false, hasCheatSheet: false });
              }
            }
          }
        }

        if (entries.length === 0) {
          const canonical = buildTcDraftIndexCanonicalResult(tcDraftsDir, []);
          return {
            content: [{ type: "text" as const, text: "No drafts found." }],
            structuredContent: canonical as unknown as Record<string, unknown>,
          };
        }

        // Sort by US ID
        entries.sort((a, b) => a.userStoryId - b.userStoryId);

        const text = entries
          .map((e) => {
            const docs = e.layout === "subfolder"
              ? ` | Docs: ${e.hasSummary ? "Summary" : ""}${e.hasSummary && e.hasCheatSheet ? ", " : ""}${e.hasCheatSheet ? "CheatSheet" : ""}${!e.hasSummary && !e.hasCheatSheet ? "None" : ""}`
              : "";
            const layoutTag = e.layout === "legacy" ? " (legacy flat)" : "";
            return `US_${e.userStoryId}: ${e.title} | Status: ${e.status} | v${e.version}${layoutTag}${docs}`;
          })
          .join("\n");

        const canonical = buildTcDraftIndexCanonicalResult(
          tcDraftsDir,
          entries.map((e) => ({
            userStoryId: e.userStoryId,
            storyTitle: e.title,
            status: e.status,
          })),
        );
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: canonical as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: msg.startsWith("No draft") || msg.startsWith("No ") ? msg : `Error listing drafts: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_clone_preview_save",
    {
      title: "Save Clone-and-Enhance Preview",
      description: "Save a clone-and-enhance preview to tc-drafts/Clone_US_{sourceId}_to_US_{targetId}_preview.md. Use after analyzing source TCs and target US+Solution Design. Pass workspaceRoot or draftsPath.",
      inputSchema: {
        sourceUserStoryId: z.number().int().positive().describe("Source User Story ID"),
        targetUserStoryId: z.number().int().positive().describe("Target User Story ID"),
        markdown: z.string().describe("Full markdown content of the clone preview (classification, steps, prerequisites per TC)"),
        workspaceRoot: z.string().optional().describe("Project folder path; drafts go to workspaceRoot/tc-drafts"),
        draftsPath: z.string().optional().describe("Exact path to drafts folder; overrides workspaceRoot"),
      },
    },
    async ({ sourceUserStoryId, targetUserStoryId, markdown, workspaceRoot, draftsPath }) => {
      try {
        const tcDraftsDir = resolveTcDraftsDir(workspaceRoot, draftsPath);
        mkdirSync(tcDraftsDir, { recursive: true });
        const filename = `Clone_US_${sourceUserStoryId}_to_US_${targetUserStoryId}_preview.md`;
        const mdPath = join(tcDraftsDir, filename);
        writeFileSync(mdPath, markdown, "utf-8");
        const fileUri = toFileUri(mdPath);
        return {
          content: [{
            type: "text" as const,
            text: `Clone preview saved successfully!\n\n**File:** [${filename}](${fileUri})\n**Path:** ${mdPath}\n\nReview the preview. When ready, respond with:\n- **APPROVED** to create test cases in ADO\n- **MODIFY** to revise\n- **CANCEL** to abort`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error saving clone preview: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_publish_push",
    {
      title: "Publish Test Cases to ADO",
      description: "Push a reviewed test case draft to ADO. Ensures the Sprint → Epic → US suite hierarchy exists (auto-derives plan/sprint from the US unless overrides are provided), then creates or updates test cases and marks the draft APPROVED. Only call after explicit user confirmation. Pass workspaceRoot or draftsPath. Phase A consent gates: draft-status-draft, approved-without-ids, approved-with-ids-no-repush, repush-missing-ids. Phase B consent gates (mapping/mixed ops): draft-ids-not-linked (set proceedWithUnlinkedIds), existing-tcs-unmapped (set attemptMapping OR insertAnyway), mapping-preview → mapping confirm (set acknowledgeMapping + userConfirmedMapping), tc-number-mismatch (BLOCK; use insertAnyway as fallback), extras-in-ado (set acknowledgeExtras), mixed-update-create (set acknowledgeMixedOp). Plan/sprint consent gates: plan-resolution-failed, sprint-resolution-failed, missing-fields, override-mismatch (set confirmMismatch).",
      inputSchema: {
        userStoryId: z.number().int().positive(),
        workspaceRoot: z.string().optional().describe("Project folder path; reads from workspaceRoot/tc-drafts"),
        draftsPath: z.string().optional().describe("Exact path to drafts folder; overrides workspaceRoot"),
        repush: z.boolean().optional().describe("If true, update existing test cases (by ADO ID in draft) instead of creating new ones. Use when draft was revised after initial push."),
        insertAnyway: z.boolean().optional().describe("If true, skip the duplicate-TC check and insert new test cases even when the US already has test cases linked in ADO. Only set after the user has seen the existing TCs and explicitly confirmed they want new ones alongside."),
        approveAndPush: z.boolean().optional().describe("Set to true to flip the draft from DRAFT to APPROVED and push in the same call. REQUIRED for first-push of a DRAFT-status draft. Only set after the user has explicitly confirmed (e.g. typed YES in response to a review-ready prompt)."),
        resetToDraft: z.boolean().optional().describe("Set to true when draft status is APPROVED but no TC has an ADO ID (scenario 2). Flips status back to DRAFT in the file and aborts the push so the user can re-review. Only set after explicit user confirmation."),
        planId: z.number().int().positive().optional().describe("Override: test plan ID (skips AreaPath-based auto-derivation). Use when the US's AreaPath has no matching testPlanMapping entry, or the user wants to target a specific plan."),
        sprintNumber: z.number().int().positive().optional().describe("Override: sprint number (skips Iteration parsing). Use when the US's Iteration path can't be parsed for a sprint number."),
        confirmMismatch: z.boolean().optional().describe("Set to true to force suite creation when planId/sprintNumber override doesn't match the US's auto-derived values. Only set after the user has seen the mismatch details and explicitly picked the override option."),
        attemptMapping: z.boolean().optional().describe("Phase B: set to true when the user chose 'attempt mapping' in response to existing-tcs-unmapped. Triggers a mapping preview showing draft TC numbers mapped to same-numbered ADO TCs."),
        acknowledgeMapping: z.boolean().optional().describe("Phase B: set to true (alongside userConfirmedMapping) to confirm the mapping preview. Applies the mapping in-memory and proceeds with the push."),
        acknowledgeExtras: z.boolean().optional().describe("Phase B: set to true when the user accepted that ADO has extra TCs not in the draft (extras-in-ado). Proceeds updating only the TCs in the draft."),
        acknowledgeMixedOp: z.boolean().optional().describe("Phase B: set to true when the user accepted a mixed update+create plan (mixed-update-create). Proceeds with the push."),
        proceedWithUnlinkedIds: z.boolean().optional().describe("Phase B: set to true to proceed when the draft carries ADO IDs not linked to the US (draft-ids-not-linked). Only set after explicit user confirmation."),
        userConfirmedMapping: z.array(z.object({
          tcNumber: z.number().int().positive(),
          adoId: z.number().int().positive(),
        })).optional().describe("Phase B: the exact mapping the user confirmed — each entry must match a mappingProposal entry returned in the mapping-preview response. Required together with acknowledgeMapping."),
      },
    },
    async ({ userStoryId, workspaceRoot, draftsPath, repush, insertAnyway, approveAndPush, resetToDraft, planId: planIdOverride, sprintNumber, confirmMismatch, attemptMapping, acknowledgeMapping, acknowledgeExtras, acknowledgeMixedOp, proceedWithUnlinkedIds, userConfirmedMapping }) => {
      try {
        const tcDraftsDir = resolveTcDraftsDir(workspaceRoot, draftsPath);
        const mdPath = resolveTestCasesMdPath(tcDraftsDir, userStoryId);

        if (!existsSync(mdPath)) {
          return {
            content: [{ type: "text" as const, text: `No draft found for US ${userStoryId}. Run qa-draft first.` }],
            isError: true,
          };
        }

        const mdContent = readFileSync(mdPath, "utf-8");
        const data = parseTcDraftFromMarkdown(mdContent);

        if (!data) {
          return {
            content: [{ type: "text" as const, text: `Could not parse draft for US ${userStoryId}. Check markdown format.` }],
            isError: true,
          };
        }

        const isRepush = repush === true && data.status === "APPROVED";
        const allHaveAdoIds = data.testCases.every((tc) => tc.adoWorkItemId != null);
        const anyHaveAdoIds = data.testCases.some((tc) => tc.adoWorkItemId != null);
        const tcCount = data.testCases.length;

        // Scenario 2 option A: user confirmed reset APPROVED → DRAFT (no ADO IDs in draft).
        // Flip status in-place and abort the push so the user can re-review.
        if (resetToDraft === true) {
          if (data.status !== "APPROVED" || anyHaveAdoIds) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({
                status: "needs-input",
                reason: "reset-to-draft-not-applicable",
                message: `ℹ️ INFO: resetToDraft only applies when the draft is APPROVED and has no ADO IDs. Current status: ${data.status}, TCs with ADO IDs: ${data.testCases.filter((t) => t.adoWorkItemId != null).length}/${tcCount}.`,
                suggestion: "Remove resetToDraft and re-run based on current state.",
                resolvedSoFar: { userStoryId, status: data.status },
              }, null, 2) }],
              isError: true,
            };
          }
          const reverted = mdContent.replace(
            /^\|\s*\*\*Status\*\*\s*\|\s*APPROVED\s*\|$/m,
            "| **Status** | DRAFT |",
          );
          writeFileSync(mdPath, reverted, "utf-8");
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              status: "success",
              reason: "reset-to-draft-complete",
              message: `✅ SUCCESS: Draft for US ${userStoryId} has been reset to DRAFT status. The file was modified in place; all other content is preserved.`,
              suggestion: "Review the draft, then re-run /qa-publish when ready.",
              resolvedSoFar: { userStoryId, status: "DRAFT" },
            }, null, 2) }],
          };
        }

        // Scenario 2: APPROVED status but draft has no ADO IDs (state is inconsistent).
        // Do NOT silently overwrite — surface the problem and let the user pick.
        if (data.status === "APPROVED" && !anyHaveAdoIds) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              status: "needs-confirmation",
              reason: "approved-without-ids",
              message:
                `⚠️ WARN: Draft for US ${userStoryId} has status APPROVED but none of the ${tcCount} test case(s) carry an ADO ID. ` +
                `This usually means the draft was reset manually without restoring IDs, or it was approved before a successful push.\n\n` +
                `Publishing in this state would create ${tcCount} brand-new test case(s) — potentially duplicating content already in ADO. I cannot guess which outcome you want.`,
              options: [
                { key: "A", label: "Reset to DRAFT", action: "Re-run qa_publish_push with resetToDraft: true. Status flips back to DRAFT in the file (all other content preserved). Push is aborted so you can re-review." },
                { key: "B", label: "Cancel", action: "Stop. User will investigate manually (likely: restore ADO IDs to the draft TC titles, then re-run with repush: true)." },
              ],
              resolvedSoFar: { userStoryId, status: data.status, tcCount, anyHaveAdoIds },
            }, null, 2) }],
            isError: true,
          };
        }

        // Scenario 4/12 precondition: repush is only valid when ALL TCs have ADO IDs.
        if (isRepush && !allHaveAdoIds) {
          const missing = data.testCases.filter((t) => t.adoWorkItemId == null).map((t) => t.tcNumber);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              status: "needs-input",
              reason: "repush-missing-ids",
              message:
                `🚫 BLOCK: repush requires every test case in the draft to carry an ADO ID (e.g. '(ADO #1234567)' in the TC title line). ` +
                `${missing.length} TC(s) are missing ADO IDs: TC_${String(missing[0]).padStart(2, "0")}${missing.length > 1 ? ` and ${missing.length - 1} more` : ""}.`,
              suggestion:
                `Either (a) restore the '(ADO #<id>)' suffix on each TC title by copying from the latest ADO TCs, or (b) drop repush and use the standard push flow which handles mixed update+create.`,
              resolvedSoFar: { userStoryId, missingTcNumbers: missing },
            }, null, 2) }],
            isError: true,
          };
        }

        // Scenarios 4/12 entry gate: APPROVED + IDs + no repush flag.
        // User ran /qa-publish on an already-pushed draft without explicitly asking for repush.
        // Offer the repush option; don't guess.
        if (data.status === "APPROVED" && anyHaveAdoIds && !isRepush) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              status: "needs-confirmation",
              reason: "approved-with-ids-no-repush",
              message:
                `ℹ️ INFO: Draft for US ${userStoryId} is APPROVED and has ${data.testCases.filter((t) => t.adoWorkItemId != null).length}/${tcCount} TC(s) with ADO IDs. ` +
                `This draft has already been pushed. To apply revisions to the existing test cases, repush is required.`,
              options: [
                { key: "A", label: "Repush (update all)", action: `Re-run qa_publish_push with repush: true. All ${tcCount} TC(s) will be updated in ADO (title, prerequisites, steps, priority) from the current draft. Formatting is re-applied.` },
                { key: "B", label: "Cancel", action: "Stop. No changes." },
              ],
              resolvedSoFar: { userStoryId, status: data.status, tcCount, withIds: data.testCases.filter((t) => t.adoWorkItemId != null).length },
            }, null, 2) }],
            isError: true,
          };
        }

        // Scenario 1: DRAFT status is the default. Pushing requires explicit approval.
        // Without approveAndPush=true, block and ask the user to confirm review is done.
        if (data.status === "DRAFT" && !approveAndPush) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              status: "needs-confirmation",
              reason: "draft-status-draft",
              message:
                `ℹ️ INFO: Draft for US ${userStoryId} is still in DRAFT status with ${tcCount} test case(s). ` +
                `Before I push to ADO, confirm you've reviewed the draft and everything looks correct.`,
              prompt: `Reply **YES** to approve and push ${tcCount} test case(s) to ADO (status flips to APPROVED in the file), or **no** to hold the process.`,
              onYes: "Re-run qa_publish_push with approveAndPush: true to flip status to APPROVED and push.",
              onNo: "Stop — do not call qa_publish_push. Ask the user what they'd like to change.",
              resolvedSoFar: { userStoryId, status: data.status, tcCount },
            }, null, 2) }],
            isError: true,
          };
        }

        // ── Phase B analysis: classify the push against the US's currently linked TCs. ──
        // Fetches linked TCs + titles (once), runs the pure analyzer, and routes to one of the
        // structured-response branches below. Skipped entirely when `insertAnyway` is set AND
        // the draft has no ADO IDs — that flag is an explicit "I know, just create" override
        // returned from scenario 3. Also skipped during a clean repush (draft fully IDs-filled):
        // all TCs carry an ID → no orphans/unlinked/mapping to surface.
        //
        // Shape: analyzePushState(draftTcs, adoTcs, usId) returns toUpdate[], toCreate[],
        // unlinkedDraftIds[], orphansInAdo[], mappingProposal[], unmappableDraftTcs[],
        // adoTcsWithUnparseableTitles[]. See src/helpers/push-state-analyzer.ts.
        const skipAnalysis = insertAnyway === true && !anyHaveAdoIds;
        if (!skipAnalysis) {
          let adoTcs: Array<{ id: number; title: string }>;
          try {
            adoTcs = await fetchLinkedTestCasesWithTitles(adoClient, userStoryId);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{
                type: "text" as const,
                text:
                  `Could not check for existing linked test cases on US ${userStoryId}: ${msg}\n\n` +
                  `If you're confident no test cases exist for this US, call again with insertAnyway=true. ` +
                  `Otherwise cancel and retry when ADO is reachable.`,
              }],
              isError: true,
            };
          }

          const draftTcViews = data.testCases.map((t) => ({
            tcNumber: t.tcNumber,
            adoWorkItemId: t.adoWorkItemId,
            titleHint: t.useCaseSummary,
          }));
          let analysis = analyzePushState(draftTcViews, adoTcs, userStoryId);

          // ── Gate 1: draft has ADO IDs that are NOT linked to this US ──
          if (analysis.unlinkedDraftIds.length > 0 && !proceedWithUnlinkedIds) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({
                status: "needs-confirmation",
                reason: "draft-ids-not-linked",
                message:
                  `⚠️ WARN: Draft for US ${userStoryId} carries ${analysis.unlinkedDraftIds.length} ADO ID(s) that are NOT linked to this User Story in ADO. ` +
                  `These test cases may have been moved, deleted, or they belong to another US. Proceeding would update TCs that are not linked to this US.`,
                unlinkedDraftIds: analysis.unlinkedDraftIds,
                options: [
                  { key: "A", label: "Proceed anyway", action: "Re-run qa_publish_push with proceedWithUnlinkedIds: true. Existing un-linked TCs will be updated as-is; no re-linking is attempted." },
                  { key: "B", label: "Cancel", action: "Stop. Inspect the draft — likely the ADO IDs are stale or belong to another US." },
                ],
                resolvedSoFar: { userStoryId, unlinkedCount: analysis.unlinkedDraftIds.length },
              }, null, 2) }],
              isError: true,
            };
          }

          // ── Gate 2: draft has NO IDs, but ADO already has linked TCs (scenario 3). ──
          // Fires in the "pure no-ID draft" path whether or not the analyzer produced a
          // mappingProposal — either way the user needs to pick: attempt mapping, create new
          // alongside, or cancel. The sub-case where mappingProposal is non-empty IS still
          // reachable here because we haven't routed to attemptMapping yet.
          const draftHasNoIds = !anyHaveAdoIds;
          const adoHasLinked = analysis.orphansInAdo.length > 0 || analysis.mappingProposal.length > 0;
          if (
            draftHasNoIds &&
            adoHasLinked &&
            !insertAnyway &&
            !attemptMapping &&
            !acknowledgeMapping &&
            !isRepush
          ) {
            const draftTcCount = data.testCases.length;
            // Mapping preview is meaningful when at least one proposal exists OR at least one
            // draft TC number matches an ADO TC number (analyzer would produce a proposal).
            const mappingPreviewAvailable =
              analysis.mappingProposal.length > 0 ||
              analysis.mappingProposal.length + analysis.toCreate.length === draftTcCount;
            // Orphan count for the message: every ADO TC not-yet-mapped (orphansInAdo already
            // excludes mapped TCs, but when the user hasn't confirmed the mapping yet, we want
            // to show the total count of linked ADO TCs for clarity).
            const totalAdoLinked = analysis.orphansInAdo.length + analysis.mappingProposal.length;

            return {
              content: [{ type: "text" as const, text: JSON.stringify({
                status: "needs-confirmation",
                reason: "existing-tcs-unmapped",
                message:
                  `⚠️ WARN: US ${userStoryId} already has ${totalAdoLinked} test case(s) linked in ADO, ` +
                  `but your draft's ${draftTcCount} TC(s) carry no ADO IDs. Publishing now would create duplicates.`,
                orphanCount: totalAdoLinked,
                draftCount: draftTcCount,
                mappingPreviewAvailable,
                options: [
                  { key: "A", label: "Attempt mapping", action: "Re-run qa_publish_push with attemptMapping: true. The tool returns a mapping preview (draft TC# ↔ ADO TC#) for your review before any writes." },
                  { key: "B", label: "Create new alongside", action: `Re-run qa_publish_push with insertAnyway: true. Creates ${draftTcCount} brand-new TC(s) in ADO, leaving the existing ${totalAdoLinked} untouched.` },
                  { key: "C", label: "Cancel", action: "Stop. No changes." },
                ],
                resolvedSoFar: { userStoryId, draftCount: draftTcCount, orphanCount: totalAdoLinked },
              }, null, 2) }],
              isError: true,
            };
          }

          // ── Gate 3: attemptMapping=true but the user hasn't acknowledged the preview yet. ──
          // Re-run analyzer in case stale params were passed; issue mapping preview OR tc-number-mismatch.
          if (attemptMapping === true && !acknowledgeMapping) {
            analysis = analyzePushState(draftTcViews, adoTcs, userStoryId);

            // All ADO TCs have unparseable titles AND no mapping can be proposed — block.
            if (
              analysis.adoTcsWithUnparseableTitles.length === analysis.orphansInAdo.length &&
              analysis.mappingProposal.length === 0
            ) {
              return {
                content: [{ type: "text" as const, text: JSON.stringify({
                  status: "needs-confirmation",
                  reason: "tc-number-mismatch",
                  message:
                    `🚫 BLOCK: Mapping cannot be attempted for US ${userStoryId}. ` +
                    `The ${analysis.orphansInAdo.length} linked ADO TC(s) have titles that don't parse into the TC_${userStoryId}_<nn> convention, ` +
                    `and no draft TC number matches any ADO TC number.`,
                  adoTcsWithUnparseableTitles: analysis.adoTcsWithUnparseableTitles,
                  draftTcNumbers: data.testCases.map((t) => t.tcNumber),
                  options: [
                    { key: "A", label: "Cancel and fix draft manually", action: "Stop. Either restore '(ADO #<id>)' suffixes on the draft TC titles, or rename the ADO TCs so their titles follow the TC_<us>_<nn> convention." },
                    { key: "B", label: "Create new alongside", action: `Re-run qa_publish_push with insertAnyway: true. Creates ${data.testCases.length} brand-new TC(s) in ADO, leaving the ${analysis.orphansInAdo.length} existing ones untouched.` },
                  ],
                  resolvedSoFar: { userStoryId, draftCount: data.testCases.length, orphanCount: analysis.orphansInAdo.length },
                }, null, 2) }],
                isError: true,
              };
            }

            // Even when mapping was not possible for ALL drafts, as long as we have SOMETHING to propose
            // (mappingProposal OR unmappable creates), return a preview so the user can confirm.
            return {
              content: [{ type: "text" as const, text: JSON.stringify({
                status: "needs-confirmation",
                reason: "mapping-preview",
                message:
                  `ℹ️ INFO: Mapping preview for US ${userStoryId}. ` +
                  `${analysis.mappingProposal.length} draft TC(s) would be mapped to existing ADO TCs (UPDATE). ` +
                  `${analysis.unmappableDraftTcs.length} draft TC(s) have no matching ADO TC and would be CREATED. ` +
                  `${analysis.orphansInAdo.length - analysis.mappingProposal.length} ADO TC(s) would be left untouched.`,
                mappingProposal: analysis.mappingProposal,
                unmappableDraftTcs: analysis.unmappableDraftTcs,
                orphansInAdo: analysis.orphansInAdo,
                adoTcsWithUnparseableTitles: analysis.adoTcsWithUnparseableTitles,
                prompt: "Reply **YES** to confirm this mapping and proceed, or **no** to cancel.",
                onYes: "Re-run qa_publish_push with acknowledgeMapping: true AND userConfirmedMapping set to the EXACT mappingProposal array from this response (verbatim — do not edit or invent entries).",
                onNo: "Stop. No changes.",
                resolvedSoFar: { userStoryId, mappingCount: analysis.mappingProposal.length, createCount: analysis.unmappableDraftTcs.length },
              }, null, 2) }],
              isError: true,
            };
          }

          // ── Gate 4: acknowledgeMapping=true — apply the user-confirmed mapping before proceeding. ──
          if (acknowledgeMapping === true) {
            const confirmed = userConfirmedMapping ?? [];
            // Validate: every confirmed entry must match a current mappingProposal entry exactly.
            const proposalLookup = new Map(analysis.mappingProposal.map((m) => [m.tcNumber, m.adoId]));
            const drifted: Array<{ tcNumber: number; adoId: number; expectedAdoId?: number }> = [];
            for (const c of confirmed) {
              const expected = proposalLookup.get(c.tcNumber);
              if (expected == null || expected !== c.adoId) {
                drifted.push({ tcNumber: c.tcNumber, adoId: c.adoId, expectedAdoId: expected });
              }
            }
            if (confirmed.length === 0 || drifted.length > 0) {
              return {
                content: [{ type: "text" as const, text: JSON.stringify({
                  status: "needs-confirmation",
                  reason: "mapping-drift",
                  message:
                    `⚠️ WARN: The confirmed mapping for US ${userStoryId} doesn't match the current mapping proposal. ` +
                    `This usually means the ADO state changed between the preview and the confirm. ` +
                    `Re-generate the preview to see the current state.`,
                  drifted,
                  currentProposal: analysis.mappingProposal,
                  options: [
                    { key: "A", label: "Re-preview", action: "Re-run qa_publish_push with attemptMapping: true (and WITHOUT acknowledgeMapping / userConfirmedMapping) to regenerate the preview." },
                    { key: "B", label: "Cancel", action: "Stop. No changes." },
                  ],
                  resolvedSoFar: { userStoryId, confirmedCount: confirmed.length, driftCount: drifted.length },
                }, null, 2) }],
                isError: true,
              };
            }
            // Apply the mapping in-memory: patch data.testCases[].adoWorkItemId from confirmed entries.
            const confirmLookup = new Map(confirmed.map((c) => [c.tcNumber, c.adoId]));
            data.testCases = data.testCases.map((tc) => {
              const adoId = confirmLookup.get(tc.tcNumber);
              return adoId != null ? { ...tc, adoWorkItemId: adoId } : tc;
            });
            // Recompute analysis after applying mapping — subsequent gates run on the updated state.
            const updatedDraftViews = data.testCases.map((t) => ({
              tcNumber: t.tcNumber,
              adoWorkItemId: t.adoWorkItemId,
              titleHint: t.useCaseSummary,
            }));
            analysis = analyzePushState(updatedDraftViews, adoTcs, userStoryId);
          }

          // ── Gate 5: extras-in-ado — draft is a strict subset of ADO, and we're not repushing. ──
          if (
            analysis.orphansInAdo.length > 0 &&
            analysis.toUpdate.length > 0 &&
            analysis.toCreate.length === 0 &&
            !acknowledgeExtras &&
            !isRepush
          ) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({
                status: "needs-confirmation",
                reason: "extras-in-ado",
                message:
                  `ℹ️ INFO: US ${userStoryId} has ${analysis.orphansInAdo.length} ADO TC(s) that are NOT represented in the draft. ` +
                  `Proceeding will UPDATE the ${analysis.toUpdate.length} TC(s) in the draft and leave the extras untouched.`,
                orphansInAdo: analysis.orphansInAdo,
                updateList: analysis.toUpdate,
                prompt: `Reply **YES** to proceed (update ${analysis.toUpdate.length} TC(s); leave ${analysis.orphansInAdo.length} untouched) or **no** to cancel.`,
                onYes: "Re-run qa_publish_push with acknowledgeExtras: true.",
                onNo: "Stop. No changes.",
                resolvedSoFar: { userStoryId, updateCount: analysis.toUpdate.length, orphanCount: analysis.orphansInAdo.length },
              }, null, 2) }],
              isError: true,
            };
          }

          // ── Gate 6: mixed update+create — some TCs will update, others create. ──
          const hasMixedUpdates = analysis.toUpdate.length > 0 && analysis.toCreate.length > 0;
          const hasMappedPlusCreates = analysis.mappingProposal.length > 0 && analysis.toCreate.length > 0;
          if ((hasMixedUpdates || hasMappedPlusCreates) && !acknowledgeMixedOp) {
            const updateList = [
              ...analysis.toUpdate,
              // Mapping entries act as updates (once user confirms mapping).
              ...analysis.mappingProposal.map((m) => ({ tcNumber: m.tcNumber, adoId: m.adoId })),
            ];
            const createList = analysis.toCreate.map((c) => {
              const tc = data.testCases.find((t) => t.tcNumber === c.tcNumber);
              return {
                tcNumber: c.tcNumber,
                suggestedTitle: tc?.useCaseSummary ?? `TC_${userStoryId}_${String(c.tcNumber).padStart(2, "0")}`,
              };
            });
            return {
              content: [{ type: "text" as const, text: JSON.stringify({
                status: "needs-confirmation",
                reason: "mixed-update-create",
                message:
                  `ℹ️ INFO: US ${userStoryId} push will update ${updateList.length} existing TC(s) AND create ${createList.length} new TC(s). ` +
                  `Review the breakdown below before proceeding.`,
                updateList,
                createList,
                prompt: `Reply **YES** to proceed with this mixed update+create plan, or **no** to cancel.`,
                onYes: "Re-run qa_publish_push with acknowledgeMixedOp: true.",
                onNo: "Stop. No changes.",
                resolvedSoFar: { userStoryId, updateCount: updateList.length, createCount: createList.length },
              }, null, 2) }],
              isError: true,
            };
          }
        }

        // Always ensure the Sprint → Epic → US suite hierarchy exists before creating
        // test cases. Plans cannot be created on the fly, so if the US's AreaPath has
        // no matching testPlanMapping entry (or Iteration can't be parsed for sprint),
        // surface a structured needs-input response so the agent can ask the user for
        // a planId / sprintNumber override and re-run.
        //
        // Precedence for effective plan: explicit planId arg > draft planId > auto-derive.
        // Passing a known planId as an override is harmless — ensureSuiteHierarchyForUs
        // cross-validates it against the US's AreaPath and only blocks on real mismatch.
        const effectivePlanIdOverride = planIdOverride ?? data.planId;
        let planId: number;
        try {
          const hierarchyResult = await ensureSuiteHierarchyForUs(
            adoClient,
            userStoryId,
            effectivePlanIdOverride,
            sprintNumber,
            confirmMismatch
          );
          planId = hierarchyResult.planId;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("has no AreaPath or IterationPath")) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({
                status: "needs-input",
                reason: "missing-fields",
                message,
                suggestion: "Provide both planId and sprintNumber overrides on the next qa_publish_push call: { planId: 123456, sprintNumber: 14 }",
                resolvedSoFar: { userStoryId },
              }, null, 2) }],
              isError: true,
            };
          }
          if (message.includes("No test plan match for AreaPath") || message.includes("testPlanMapping not configured")) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({
                status: "needs-input",
                reason: "plan-resolution-failed",
                message,
                suggestion: "Provide planId override on the next qa_publish_push call: { planId: 123456 }",
                resolvedSoFar: { userStoryId },
              }, null, 2) }],
              isError: true,
            };
          }
          if (message.includes("Could not extract sprint from Iteration")) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({
                status: "needs-input",
                reason: "sprint-resolution-failed",
                message,
                suggestion: "Provide sprintNumber override on the next qa_publish_push call: { sprintNumber: 14 }",
                resolvedSoFar: { userStoryId },
              }, null, 2) }],
              isError: true,
            };
          }
          if (message.startsWith("OVERRIDE_MISMATCH:")) {
            const mismatchData = JSON.parse(message.slice("OVERRIDE_MISMATCH:".length));
            return {
              content: [{ type: "text" as const, text: JSON.stringify({
                status: "needs-confirmation",
                reason: "override-mismatch",
                mismatches: mismatchData.mismatches,
                message: `The override values don't match the US's auto-derived plan/sprint. This would create suites in a plan that doesn't match the US's AreaPath.`,
                suggestion: "If intentional, re-run qa_publish_push with confirmMismatch: true. Otherwise, re-run without the planId/sprintNumber overrides to use auto-derivation.",
                resolvedSoFar: { userStoryId, overridePlanId: mismatchData.overridePlanId, overrideSprintNumber: mismatchData.overrideSprintNumber },
              }, null, 2) }],
              isError: true,
            };
          }
          throw err;
        }

        const results: Array<{ tcNumber: number; id: number; title: string; op: "update" | "create" }> = [];
        const failures: Array<{ tcNumber: number; reason: string }> = [];

        // Fetch existing project tags once for the whole batch (match-only policy — never creates new tags).
        // Non-blocking: if fetch fails, listProjectTags() returns [] and push proceeds without tags.
        const projectTags = await adoClient.listProjectTags();
        const allSkippedTags = new Set<string>();

        // Known category prefixes recognised in TC titles (first featureTag segment).
        const KNOWN_CATEGORIES = ["Regression", "SIT", "E2E", "Smoke", "Accessibility", "Performance", "Security"];

        for (const tc of data.testCases) {
          // Collect requested tags: category extracted from TC title's first featureTag, if recognized.
          // (Explicit **Tags** metadata row in draft is a future extension — currently only
          // title-prefix drives tag resolution.)
          const requestedTags: string[] = [];
          if (tc.featureTags.length > 0) {
            const maybeCategory = tc.featureTags[0];
            if (KNOWN_CATEGORIES.some((k) => k.toLowerCase() === maybeCategory.toLowerCase())) {
              requestedTags.push(maybeCategory);
            }
          }

          const { matched: resolvedTags, skipped } = resolveTagsMatchOnly(requestedTags, projectTags);
          for (const s of skipped) allSkippedTags.add(s);

          const params: CreateTestCaseParams = {
            planId,
            userStoryId: data.userStoryId,
            tcNumber: tc.tcNumber,
            featureTags: tc.featureTags,
            useCaseSummary: tc.useCaseSummary,
            priority: tc.priority,
            prerequisites: mergePrerequisites(data.commonPrerequisites, tc.prerequisites),
            steps: tc.steps,
            areaPath: data.areaPath,
            iterationPath: data.iterationPath,
            tags: resolvedTags.length > 0 ? resolvedTags : undefined,
          };

          // At this point in the flow, having an adoWorkItemId means the push is
          // authorized to update (either repush gate or Phase B mapping/mixed-op gate passed).
          // No ID → authorized create. We do NOT retry on failure — surface a clear error.
          try {
            const result = tc.adoWorkItemId
              ? await updateTestCaseFromParams(adoClient, tc.adoWorkItemId, params)
              : await createTestCase(adoClient, params);
            results.push({
              tcNumber: tc.tcNumber,
              id: result.id,
              title: result.title,
              op: tc.adoWorkItemId ? "update" : "create",
            });
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            failures.push({ tcNumber: tc.tcNumber, reason });
            break;
          }
        }

        // Batch failure: report successes + first failure, stop here. Do NOT write the draft
        // back to APPROVED since state is inconsistent.
        if (failures.length > 0) {
          const succeededSummary = results.length
            ? results
                .map((r) => `  TC_${userStoryId}_${String(r.tcNumber).padStart(2, "0")} → [ADO #${r.id}](${adoWorkItemUrl(adoClient, r.id)}) (${r.op})`)
                .join("\n")
            : "  (none)";
          const failed = failures[0];
          const failedNumbers = failures.map((f) => f.tcNumber).concat(
            data.testCases
              .map((t) => t.tcNumber)
              .filter((n) => !results.some((r) => r.tcNumber === n) && !failures.some((f) => f.tcNumber === n)),
          );
          return {
            content: [{ type: "text" as const, text:
              `Error pushing draft to ADO for US ${userStoryId}: TC_${userStoryId}_${String(failed.tcNumber).padStart(2, "0")} failed.\n\n` +
              `Succeeded (${results.length}):\n${succeededSummary}\n\n` +
              `Not pushed (${failedNumbers.length}): ${failedNumbers.map((n) => `TC_${userStoryId}_${String(n).padStart(2, "0")}`).join(", ")}\n\n` +
              `First failure reason: ${failed.reason}`,
            }],
            isError: true,
          };
        }

        if (allSkippedTags.size > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            `[qa_publish_push] ${allSkippedTags.size} tag(s) were requested in drafts but don't exist in the project and were skipped: ${[...allSkippedTags].join(", ")}. Title-prefix category still applies as WIQL-filterable carrier.`
          );
        }

        // Update draft with ADO IDs and APPROVED status
        const updatedTestCases: TcDraftTestCase[] = data.testCases.map((tc) => {
          const r = results.find((x) => x.tcNumber === tc.tcNumber);
          return { ...tc, adoWorkItemId: r?.id };
        });

        const updatedData: TcDraftData = {
          ...data,
          planId,
          status: "APPROVED",
          lastUpdated: new Date().toISOString().slice(0, 10),
          testCases: updatedTestCases,
        };

        // In-place write-back: flip Status DRAFT→APPROVED + append (ADO #N) to each TC title.
        // Preserves every other byte of the draft — Test Data rows, per-TC Pre-requisite blocks,
        // Coverage Checklists, Reviewer Notes, emoji tables, any custom sections. See
        // applyPostPushEditsInPlace docstring for rationale.
        const idMap = results.map((r) => ({ tcNumber: r.tcNumber, adoId: r.id }));
        const { updatedMd, titlesSkipped } = applyPostPushEditsInPlace(mdContent, userStoryId, idMap);
        writeFileSync(mdPath, updatedMd, "utf-8");
        if (titlesSkipped.length > 0) {
          // Surfaced to caller via warnings array on the response payload
          // (non-fatal — ADO push succeeded, but local title matching did not
          // update these TCs; user can re-run to reconcile).
          // eslint-disable-next-line no-console
          console.warn(`[qa_publish_push] In-place title update skipped for TCs: ${titlesSkipped.join(", ")}. Re-run or inspect draft for unusual formatting.`);
        }

        // Generate JSON co-located with the markdown (same folder)
        const mdDir = join(mdPath, "..");
        const jsonPath = join(mdDir, `US_${userStoryId}_test_cases.json`);
        writeFileSync(
          jsonPath,
          JSON.stringify(
            { ...updatedData, testCases: updatedTestCases.map(({ adoWorkItemId: _, ...t }) => t) },
            null,
            2
          ),
          "utf-8"
        );

        // Break out updated vs created in the success summary when the push was mixed.
        // Single-section summary when all were updates OR all were creates.
        const updated = results.filter((r) => r.op === "update");
        const created = results.filter((r) => r.op === "create");
        const renderLine = (r: { tcNumber: number; id: number }) =>
          `TC_${userStoryId}_${String(r.tcNumber).padStart(2, "0")} → [ADO #${r.id}](${adoWorkItemUrl(adoClient, r.id)})`;

        let summary: string;
        if (updated.length > 0 && created.length > 0) {
          summary =
            `  Updated ${updated.length} existing: ${updated.map(renderLine).join(", ")}\n` +
            `  Created ${created.length} new: ${created.map(renderLine).join(", ")}`;
        } else {
          summary = results.map((r) => `  ${renderLine(r)}`).join("\n");
        }

        const mdFileName = `US_${userStoryId}_test_cases.md`;
        const mdFileUri = toFileUri(mdPath);
        return {
          content: [{
            type: "text" as const,
            text: `✅ SUCCESS: Pushed ${results.length} test case(s) to ADO for US ${userStoryId}.\n\n${summary}\n\n**Draft:** [${mdFileName}](${mdFileUri}) — updated to APPROVED.`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: msg.startsWith("No draft") || msg.startsWith("No ") ? msg : `Error pushing draft to ADO: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_draft_doc_save",
    {
      title: "Save Draft Supporting Doc",
      description: "Save a supporting document (solution_design_summary, qa_cheat_sheet, or regression_tests) for a User Story into tc-drafts/US_<id>/. Creates the US folder if missing. Pass workspaceRoot or draftsPath.",
      inputSchema: {
        userStoryId: z.number().int().positive().describe("User Story work item ID"),
        docType: z.enum(["solution_summary", "qa_cheat_sheet", "regression_tests"]).describe("Type of supporting document to save"),
        markdown: z.string().describe("Full markdown content of the supporting document"),
        workspaceRoot: z.string().optional().describe("Project folder path; saves to workspaceRoot/tc-drafts/US_<id>/"),
        draftsPath: z.string().optional().describe("Exact path to drafts folder; overrides workspaceRoot"),
      },
    },
    async ({ userStoryId, docType, markdown, workspaceRoot, draftsPath }) => {
      try {
        const tcDraftsDir = resolveTcDraftsDir(workspaceRoot, draftsPath);
        const usFolder = resolveUsFolder(tcDraftsDir, userStoryId);
        mkdirSync(usFolder, { recursive: true });

        const fileMap: Record<string, string> = {
          solution_summary: `US_${userStoryId}_solution_design_summary.md`,
          qa_cheat_sheet: `US_${userStoryId}_qa_cheat_sheet.md`,
          regression_tests: `US_${userStoryId}_regression_tests.md`,
        };
        const fileName = fileMap[docType];
        const mdPath = join(usFolder, fileName);
        writeFileSync(mdPath, markdown, "utf-8");

        const fileUri = toFileUri(mdPath);
        return {
          content: [{
            type: "text" as const,
            text: `Saved ${docType.replace("_", " ")} successfully!\n\n**File:** [${fileName}](${fileUri})\n**Folder:** tc-drafts/US_${userStoryId}/\n**Path:** ${mdPath}`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: msg.startsWith("No draft") || msg.startsWith("No ") ? msg : `Error saving supporting doc: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}

function mergePrerequisites(
  common?: TcDraftData["commonPrerequisites"],
  tc?: TcDraftTestCase["prerequisites"]
): NonNullable<CreateTestCaseParams["prerequisites"]> {
  // Merge preConditionsTable additively when both sides present AND headers match.
  // Common headers always win; TC-specific rows conforming to those headers get appended.
  // When only one side has a structured table, use it directly.
  // When headers disagree, drop the TC-specific table (fall back to flat rows via preConditions).
  let mergedTable: { headers: string[]; rows: string[][] } | undefined;
  if (common?.preConditionsTable && tc?.preConditionsTable) {
    const headersMatch =
      common.preConditionsTable.headers.length === tc.preConditionsTable.headers.length &&
      common.preConditionsTable.headers.every(
        (h, i) => h.toLowerCase() === tc.preConditionsTable!.headers[i]?.toLowerCase(),
      );
    if (headersMatch) {
      mergedTable = {
        headers: common.preConditionsTable.headers,
        rows: [...common.preConditionsTable.rows, ...tc.preConditionsTable.rows],
      };
    } else {
      mergedTable = common.preConditionsTable;
    }
  } else if (common?.preConditionsTable) {
    mergedTable = common.preConditionsTable;
  } else if (tc?.preConditionsTable) {
    mergedTable = tc.preConditionsTable;
  }

  return {
    personas: undefined, // Always use config defaults (all three); no override
    preConditions: [...(common?.preConditions ?? []), ...(tc?.preConditions ?? [])],
    preConditionsTable: mergedTable,
    testData: tc?.testData ?? common?.testData,
  };
}

// ── Canonical read-result builders ──

/**
 * Build the CanonicalReadResult for `qa_draft_read`.
 *
 * - `item.type` = "tc-draft" (the draft is the read target; the markdown
 *   file on disk is the artifact).
 * - When parsing succeeded, `item.title` includes the story title,
 *   `item.summary` reports status + TC count, and each test case becomes
 *   a child with `relationship: "pushed"` (has ADO ID) or `"drafted"`
 *   (no ADO ID yet).
 * - When parsing failed, children + summary are skipped; we still emit
 *   the item shell and the markdown-draft artifact so callers have a
 *   canonical record of *which* US and *where* the file is.
 * - `completeness.isPartial` = false; this tool reads a single draft
 *   file in one go.
 */
export function buildTcDraftCanonicalResult(
  userStoryId: number,
  parsed: TcDraftData | null,
  mdPath: string,
): CanonicalReadResult {
  return {
    item: {
      id: userStoryId,
      type: "tc-draft",
      title: parsed?.storyTitle
        ? `Draft for US #${userStoryId}: ${parsed.storyTitle}`
        : `Draft for US #${userStoryId}`,
      summary: parsed
        ? `Status: ${parsed.status}; ${parsed.testCases.length} test case${parsed.testCases.length === 1 ? "" : "s"}`
        : undefined,
    },
    children: (parsed?.testCases ?? []).map((tc) => ({
      id: tc.adoWorkItemId ?? `TC_${userStoryId}_${String(tc.tcNumber).padStart(2, "0")}`,
      type: "test-case",
      title: `TC_${userStoryId}_${String(tc.tcNumber).padStart(2, "0")}: ${tc.useCaseSummary}`,
      relationship: tc.adoWorkItemId ? "pushed" : "drafted",
    })),
    artifacts: [
      {
        kind: "markdown-draft",
        title: `US_${userStoryId}_test_cases.md`,
        url: toFileUri(mdPath),
      },
    ],
    completeness: { isPartial: false },
  };
}

/**
 * Build the CanonicalReadResult for `qa_drafts_list`.
 *
 * - `item.type` = "tc-draft-index" (the index itself is the read target).
 * - `children[]` = one entry per draft file found, each tagged with
 *   `relationship: "approved"` (status=APPROVED) or `"draft"`.
 * - `completeness.isPartial` = false; the directory scan returns every
 *   draft it can see in one pass.
 */
export function buildTcDraftIndexCanonicalResult(
  tcDraftsDir: string,
  drafts: Array<{ userStoryId: number; storyTitle?: string; status: string }>,
): CanonicalReadResult {
  return {
    item: {
      id: "tc-drafts-index",
      type: "tc-draft-index",
      title: "Test Case Drafts",
      summary: `${drafts.length} draft${drafts.length === 1 ? "" : "s"} in ${tcDraftsDir}`,
    },
    children: drafts.map((d) => ({
      id: d.userStoryId,
      type: "tc-draft",
      title: d.storyTitle ? `US #${d.userStoryId}: ${d.storyTitle}` : `US #${d.userStoryId}`,
      relationship: d.status === "APPROVED" ? "approved" : "draft",
    })),
    completeness: { isPartial: false },
  };
}

