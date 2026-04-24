import { z } from "zod";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoClient } from "../ado-client.ts";
import { getTcDraftsDir } from "../credentials.ts";
import { formatTcDraftToMarkdown, type TcDraftData, type TcDraftTestCase } from "../helpers/tc-draft-formatter.ts";
import { parseTcDraftFromMarkdown } from "../helpers/tc-draft-parser.ts";
import { createTestCase, updateTestCaseFromParams, type CreateTestCaseParams } from "./test-cases.ts";
import { ensureSuiteHierarchyForUs } from "./test-suites.ts";

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

/** Parse header fields from markdown for list_tc_drafts. */
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
  server.tool(
    "save_tc_draft",
    "Save a test case draft to tc-drafts/ as markdown only. JSON is created only when pushing to ADO. Pass workspaceRoot (open folder) or draftsPath (user-specified location). Creates tc-drafts folder if missing. No hardcoded default path.",
    SaveTcDraftShape,
    async (input) => {
      try {
        const tcDraftsDir = resolveTcDraftsDir(input.workspaceRoot, input.draftsPath);
        mkdirSync(tcDraftsDir, { recursive: true });

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

        const mdPath = join(tcDraftsDir, `US_${input.userStoryId}_test_cases.md`);

        const markdown = formatTcDraftToMarkdown(data);
        writeFileSync(mdPath, markdown, "utf-8");

        const fileName = `US_${input.userStoryId}_test_cases.md`;
        const fileUri = toFileUri(mdPath);
        return {
          content: [{
            type: "text" as const,
            text: `Draft saved successfully!\n\n**File:** [${fileName}](${fileUri})\n**Path:** ${mdPath}\n**Version:** ${input.version}\n**Test Cases:** ${input.testCases.length}\n\n_JSON will be generated when you push to ADO._`,
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

  server.tool(
    "get_tc_draft",
    "Read and return the markdown content of a test case draft for a User Story. Use to show the draft during review. Pass workspaceRoot or draftsPath.",
    {
      userStoryId: z.number().int().positive(),
      workspaceRoot: z.string().optional().describe("Project folder path; reads from workspaceRoot/tc-drafts"),
      draftsPath: z.string().optional().describe("Exact path to drafts folder; overrides workspaceRoot"),
    },
    async ({ userStoryId, workspaceRoot, draftsPath }) => {
      try {
        const tcDraftsDir = resolveTcDraftsDir(workspaceRoot, draftsPath);
        const mdPath = join(tcDraftsDir, `US_${userStoryId}_test_cases.md`);
        if (!existsSync(mdPath)) {
          return {
            content: [{ type: "text" as const, text: `No draft found for US ${userStoryId}.` }],
            isError: true,
          };
        }
        const content = readFileSync(mdPath, "utf-8");
        return {
          content: [{ type: "text" as const, text: content }],
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

  server.tool(
    "list_tc_drafts",
    "List all test case drafts in tc-drafts/ with US ID, title, status, and version. Pass workspaceRoot or draftsPath.",
    {
      workspaceRoot: z.string().optional().describe("Project folder path; lists from workspaceRoot/tc-drafts"),
      draftsPath: z.string().optional().describe("Exact path to drafts folder; overrides workspaceRoot"),
    },
    async ({ workspaceRoot, draftsPath }) => {
      try {
        const tcDraftsDir = resolveTcDraftsDir(workspaceRoot, draftsPath);
        if (!existsSync(tcDraftsDir)) {
          return {
            content: [{ type: "text" as const, text: `No drafts yet. tc-drafts/ is empty. (Path: ${tcDraftsDir})` }],
          };
        }

        const entries: Array<{ userStoryId: number; title: string; status: string; version: number }> = [];
        const files = readdirSync(tcDraftsDir, { withFileTypes: true });

        for (const f of files) {
          if (f.isFile() && f.name.endsWith(".md")) {
            const match = f.name.match(/^US_(\d+)_test_cases\.md$/);
            if (match) {
              const usId = parseInt(match[1], 10);
              const mdPath = join(tcDraftsDir, f.name);
              try {
                const raw = readFileSync(mdPath, "utf-8");
                const parsed = parseMarkdownHeader(raw);
                if (parsed) {
                  entries.push({
                    userStoryId: parsed.userStoryId,
                    title: parsed.title,
                    status: parsed.status,
                    version: parsed.version,
                  });
                } else {
                  entries.push({ userStoryId: usId, title: `US ${usId}`, status: "?", version: 0 });
                }
              } catch {
                entries.push({ userStoryId: usId, title: `US ${usId}`, status: "?", version: 0 });
              }
            }
          }
        }

        const text =
          entries.length === 0
            ? "No drafts found."
            : entries
                .map(
                  (e) =>
                    `US_${e.userStoryId}: ${e.title} | Status: ${e.status} | v${e.version}`
                )
                .join("\n");

        return {
          content: [{ type: "text" as const, text }],
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

  server.tool(
    "save_tc_clone_preview",
    "Save a clone-and-enhance preview to tc-drafts/Clone_US_{sourceId}_to_US_{targetId}_preview.md. Use after analyzing source TCs and target US+Solution Design. Pass workspaceRoot or draftsPath.",
    {
      sourceUserStoryId: z.number().int().positive().describe("Source User Story ID"),
      targetUserStoryId: z.number().int().positive().describe("Target User Story ID"),
      markdown: z.string().describe("Full markdown content of the clone preview (classification, steps, prerequisites per TC)"),
      workspaceRoot: z.string().optional().describe("Project folder path; drafts go to workspaceRoot/tc-drafts"),
      draftsPath: z.string().optional().describe("Exact path to drafts folder; overrides workspaceRoot"),
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

  server.tool(
    "push_tc_draft_to_ado",
    "Push a reviewed test case draft to ADO. Creates all test cases and updates the draft markdown to APPROVED. Only call after explicit user confirmation (e.g. user typed YES). Pass workspaceRoot or draftsPath. Set repush=true to update existing test cases when draft was revised after initial push.",
    {
      userStoryId: z.number().int().positive(),
      workspaceRoot: z.string().optional().describe("Project folder path; reads from workspaceRoot/tc-drafts"),
      draftsPath: z.string().optional().describe("Exact path to drafts folder; overrides workspaceRoot"),
      repush: z.boolean().optional().describe("If true, update existing test cases (by ADO ID in draft) instead of creating new ones. Use when draft was revised after initial push."),
    },
    async ({ userStoryId, workspaceRoot, draftsPath, repush }) => {
      try {
        const tcDraftsDir = resolveTcDraftsDir(workspaceRoot, draftsPath);
        const mdPath = join(tcDraftsDir, `US_${userStoryId}_test_cases.md`);

        if (!existsSync(mdPath)) {
          return {
            content: [{ type: "text" as const, text: `No draft found for US ${userStoryId}. Run draft_test_cases first.` }],
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

        // Generate JSON only at push time (correct mappings for ADO)
        const jsonPath = join(tcDraftsDir, `US_${userStoryId}_test_cases.json`);
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
          .map((r) => `  TC_${userStoryId}_${String(r.tcNumber).padStart(2, "0")} → ADO #${r.id}`)
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

