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

const NO_PATH_MSG =
  "No draft location specified. Open a folder in your workspace (drafts will go to <folder>/tc-drafts) or provide draftsPath, or set TC_DRAFTS_PATH / tc_drafts_path in credentials.";

/** Convert an absolute file path to a file:// URI that Cursor can open on click. */
function toFileUri(absolutePath: string): string {
  const encoded = absolutePath.split("/").map(encodeURIComponent).join("/");
  return `file://${encoded}`;
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
      description: "Push a reviewed test case draft to ADO. Creates all test cases and updates the draft markdown to APPROVED. Only call after explicit user confirmation (e.g. user typed YES). Pass workspaceRoot or draftsPath. Supports both new subfolder and legacy flat layout. Set repush=true to update existing test cases when draft was revised after initial push. If the User Story already has test cases linked in ADO and the draft has no ADO IDs, the tool returns an error listing them; set insertAnyway=true to add new TCs alongside existing ones, or use repush=true to update existing ones.",
      inputSchema: {
        userStoryId: z.number().int().positive(),
        workspaceRoot: z.string().optional().describe("Project folder path; reads from workspaceRoot/tc-drafts"),
        draftsPath: z.string().optional().describe("Exact path to drafts folder; overrides workspaceRoot"),
        repush: z.boolean().optional().describe("If true, update existing test cases (by ADO ID in draft) instead of creating new ones. Use when draft was revised after initial push."),
        insertAnyway: z.boolean().optional().describe("If true, skip the duplicate-TC check and insert new test cases even when the US already has test cases linked in ADO. Only set after the user has seen the existing TCs and explicitly confirmed they want new ones alongside."),
      },
    },
    async ({ userStoryId, workspaceRoot, draftsPath, repush, insertAnyway }) => {
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

        if (data.status === "APPROVED" && !isRepush) {
          return {
            content: [{ type: "text" as const, text: `Draft for US ${userStoryId} is already APPROVED. Set repush=true to update existing test cases from revised draft.` }],
            isError: true,
          };
        }

        if (isRepush && !allHaveAdoIds) {
          return {
            content: [{ type: "text" as const, text: `Repush requires all test cases to have ADO IDs in the draft. Some TCs are missing (ADO #xxx). Delete and re-push, or add ADO IDs manually.` }],
            isError: true,
          };
        }

        // Duplicate-TC preflight: when creating new TCs (not a repush) and the draft has no
        // ADO IDs, check whether the US already has linked TCs in ADO. Only surface a prompt
        // when there's real risk (orphans exist). If none, proceed silently.
        if (!isRepush && !allHaveAdoIds && !insertAnyway) {
          let linkedIds: number[];
          try {
            linkedIds = await fetchLinkedTestCaseIds(adoClient, userStoryId);
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

          if (linkedIds.length > 0) {
            const existingCount = linkedIds.length;
            const newCount = data.testCases.length;
            return {
              content: [{
                type: "text" as const,
                text:
                  `## US ${userStoryId} — existing test cases detected\n\n` +
                  `ADO already has **${existingCount} test case(s)** linked to this User Story, ` +
                  `but your local draft has no ADO IDs for them.\n\n` +
                  `Publishing now will **CREATE ${newCount} new test case(s) alongside the existing ${existingCount}** — ` +
                  `if they cover the same scenarios, you'll end up with duplicates.\n\n` +
                  `Reply with a letter:\n` +
                  `  **A.** Proceed — create ${newCount} new TCs alongside the existing ones ` +
                  `(agent then calls qa_publish_push with insertAnyway: true).\n` +
                  `  **B.** Inspect first — see titles/steps of the existing test cases before deciding ` +
                  `(agent then calls qa_tests and qa_tc_read for each).\n` +
                  `  **C.** Cancel — do nothing.`,
              }],
              isError: true,
            };
          }
        }

        // Auto-derive planId if not in draft
        let planId = data.planId;
        if (!planId) {
          const hierarchyResult = await ensureSuiteHierarchyForUs(adoClient, userStoryId);
          planId = hierarchyResult.planId;
        }

        const results: Array<{ tcNumber: number; id: number; title: string }> = [];

        for (const tc of data.testCases) {
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
          };

          const result =
            isRepush && tc.adoWorkItemId
              ? await updateTestCaseFromParams(adoClient, tc.adoWorkItemId, params)
              : await createTestCase(adoClient, params);
          results.push({ tcNumber: tc.tcNumber, id: result.id, title: result.title });
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

        const markdown = formatTcDraftToMarkdown(updatedData);
        writeFileSync(mdPath, markdown, "utf-8");

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

        const summary = results
          .map((r) => `  TC_${userStoryId}_${String(r.tcNumber).padStart(2, "0")} → [ADO #${r.id}](${adoWorkItemUrl(adoClient, r.id)})`)
          .join("\n");

        const mdFileName = `US_${userStoryId}_test_cases.md`;
        const mdFileUri = toFileUri(mdPath);
        return {
          content: [{
            type: "text" as const,
            text: `Pushed ${results.length} test case(s) to ADO.\n\n${summary}\n\n**Draft:** [${mdFileName}](${mdFileUri}) — updated to APPROVED.`,
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
  return {
    personas: undefined, // Always use config defaults (all three); no override
    preConditions: [...(common?.preConditions ?? []), ...(tc?.preConditions ?? [])],
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

