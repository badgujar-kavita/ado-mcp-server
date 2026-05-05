import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoClient } from "../ado-client.ts";
import { AdoClientError } from "../ado-client.ts";
import type { ConfluenceClient } from "../confluence-client.ts";
import type { AdoWorkItem, JsonPatchOperation, TestCaseResult } from "../types.ts";
import { loadConventionsConfig } from "../config.ts";
import { buildTcTitle } from "../helpers/tc-title-builder.ts";
import { buildPrerequisitesHtml } from "../helpers/prerequisites.ts";
import { buildStepsXml } from "../helpers/steps-builder.ts";
import { adoWorkItemUrl } from "../helpers/ado-urls.ts";
import { stripHtml } from "../helpers/strip-html.ts";
import {
  READ_OUTPUT_SCHEMA,
  type CanonicalReadResult,
  type CanonicalReadChild,
  type CanonicalReadArtifact,
} from "./read-result.ts";

// Formatting (bold, lists, persona sub-bullets, TO BE TESTED FOR expansion) is applied
// via buildPrerequisitesHtml and buildStepsXml for ALL paths: createTestCase (qa_publish_push),
// qa_tc_update, and any future create_test_case tool.

const StepSchema = z.object({
  action: z.string(),
  expectedResult: z.string(),
});

const PrerequisitesSchema = z.object({
  personas: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
  preConditions: z.array(z.string()).nullable().optional(),
  testData: z.string().nullable().optional(),
}).optional();

export function registerTestCaseTools(
  server: McpServer,
  client: AdoClient,
  _confluenceClient: ConfluenceClient | null
) {
  // Note: create_test_case tool removed. Test cases are inserted only via the /qa-publish
  // command → qa_publish_push (after draft review and user confirmation).

  server.registerTool(
    "ado_suite_tests",
    {
      title: "List Test Cases in Suite",
      description: "List test cases within a specific test suite",
      inputSchema: {
        planId: z.number().int().positive().describe("The test plan ID"),
        suiteId: z.number().int().positive().describe("The test suite ID"),
      },
      outputSchema: READ_OUTPUT_SCHEMA,
    },
    async ({ planId, suiteId }) => {
      try {
        const result = await client.get<{ value: Array<{ testCase: { id: number; name: string } }> }>(
          `/_apis/testplan/Plans/${planId}/Suites/${suiteId}/TestCase`,
          "7.1"
        );
        const cases = result.value.map((tc) => ({
          id: tc.testCase.id,
          name: tc.testCase.name,
        }));
        const prose = JSON.stringify(cases, null, 2);
        const canonical = buildListTestCasesCanonicalResult(planId, suiteId, cases);
        return {
          content: [{ type: "text" as const, text: prose }],
          structuredContent: canonical as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error listing test cases: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_tc_read",
    {
      title: "Read Test Case",
      description: "Get a test case work item by ID with all fields",
      inputSchema: {
        workItemId: z.number().int().positive().describe("The test case work item ID"),
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
        const withUrl = { ...item, webUrl: adoWorkItemUrl(client, item.id) };
        const prose = JSON.stringify(withUrl, null, 2);
        const canonical = buildTestCaseCanonicalResult(item);
        return {
          content: [{ type: "text" as const, text: prose }],
          structuredContent: canonical as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error fetching test case: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_tc_update",
    {
      title: "Update Test Case",
      description: "Update fields or steps of an existing test case",
      inputSchema: {
        workItemId: z.number().int().positive().describe("The test case work item ID"),
        title: z.string().optional().describe("Updated title"),
        description: z.string().optional().describe("Raw HTML for Prerequisite for Test (use when providing pre-built HTML)"),
        prerequisites: PrerequisitesSchema.describe("Structured prerequisites; when provided, builds HTML and writes to prerequisite field"),
        steps: z.array(StepSchema).optional().describe("Updated test steps"),
        priority: z.number().int().min(1).max(4).optional().describe("Updated priority"),
        state: z.string().optional().describe("Updated state"),
        assignedTo: z.string().optional().describe("Updated assigned to"),
        areaPath: z.string().optional().describe("Updated area path"),
        iterationPath: z.string().optional().describe("Updated iteration path"),
      },
    },
    async ({ workItemId, title, description, prerequisites, steps, priority, state, assignedTo, areaPath, iterationPath }) => {
      try {
        const config = loadConventionsConfig();
        const ops: JsonPatchOperation[] = [];
        if (title) ops.push({ op: "replace", path: "/fields/System.Title", value: title });
        const prereqField = config.prerequisiteFieldRef ?? "System.Description";
        // buildPrerequisitesHtml applies full formatting (bold, lists, persona sub-bullets, ;/• expansion)
        const prereqHtml = prerequisites ? buildPrerequisitesHtml(prerequisites) : description;
        if (prereqHtml) ops.push({ op: "replace", path: `/fields/${prereqField}`, value: prereqHtml });
        // buildStepsXml applies formatStepContent (bold, A./B. lists) to action/expectedResult
        if (steps) ops.push({ op: "replace", path: "/fields/Microsoft.VSTS.TCM.Steps", value: buildStepsXml(steps) });
        if (priority) ops.push({ op: "replace", path: "/fields/Microsoft.VSTS.Common.Priority", value: priority });
        if (state) ops.push({ op: "replace", path: "/fields/System.State", value: state });
        if (assignedTo) ops.push({ op: "replace", path: "/fields/System.AssignedTo", value: assignedTo });
        if (areaPath) ops.push({ op: "replace", path: "/fields/System.AreaPath", value: areaPath });
        if (iterationPath) ops.push({ op: "replace", path: "/fields/System.IterationPath", value: iterationPath });

        if (ops.length === 0) {
          return { content: [{ type: "text" as const, text: "No fields to update." }] };
        }

        const item = await client.patch<AdoWorkItem>(
          `/_apis/wit/workitems/${workItemId}`,
          ops,
          "application/json-patch+json",
          "7.0"
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ id: item.id, rev: item.rev, url: item.url }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error updating test case: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_suite_add_tests",
    {
      title: "Add Test Cases to Suite",
      description: "Add existing test case IDs to a static test suite (not needed for query-based suites)",
      inputSchema: {
        planId: z.number().int().positive().describe("The test plan ID"),
        suiteId: z.number().int().positive().describe("The target suite ID"),
        testCaseIds: z.array(z.number().int().positive()).min(1).describe("Array of test case work item IDs to add"),
      },
    },
    async ({ planId, suiteId, testCaseIds }) => {
      try {
        const body = testCaseIds.map((id) => ({ testCase: { id } }));
        const result = await client.post<{ value: unknown[] }>(
          `/_apis/testplan/Plans/${planId}/Suites/${suiteId}/TestCase`,
          body,
          "application/json",
          "7.1"
        );
        return {
          content: [{ type: "text" as const, text: `Added ${testCaseIds.length} test case(s) to suite ${suiteId}. Response count: ${result.value?.length ?? 0}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error adding test cases to suite: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_tc_delete",
    {
      title: "Delete Test Case",
      description: "Delete a test case work item by ID. Verifies the work item type is 'Test Case' before deleting — refuses to delete any other type (User Story, Bug, Task, etc.). By default moves to Recycle Bin (restorable within 30 days via ADO UI). Set destroy=true to permanently delete (cannot be recovered).",
      inputSchema: {
        workItemId: z.number().int().positive().describe("The test case work item ID to delete"),
        destroy: z.boolean().optional().default(false).describe("If true, permanently delete (CANNOT be recovered). Default false (Recycle Bin, restorable within 30 days)."),
      },
    },
    async ({ workItemId, destroy }) => {
      // Step 1: fetch the work item to verify type
      let workItem: AdoWorkItem;
      try {
        workItem = await client.get<AdoWorkItem>(
          `/_apis/wit/workitems/${workItemId}`,
          "7.0",
          { fields: "System.WorkItemType,System.Title,System.State" }
        );
      } catch (err) {
        if (err instanceof AdoClientError) {
          if (err.statusCode === 401) {
            return {
              content: [{ type: "text" as const, text: `Cannot delete work item ${workItemId}: **Authentication failed.** Your ADO PAT is invalid or expired. Run /ado-testforge/ado-connect to update credentials.` }],
              isError: true,
            };
          }
          if (err.statusCode === 403) {
            return {
              content: [{ type: "text" as const, text: `Cannot delete work item ${workItemId}: **Insufficient permissions.** Your ADO PAT needs the **Work Items (Read & Write)** scope (and **Test Management (Read & Write)** for test case mutations). Create a new PAT with these scopes and run /ado-testforge/ado-connect to update credentials.` }],
              isError: true,
            };
          }
          if (err.statusCode === 404) {
            return {
              content: [{ type: "text" as const, text: `Work item ${workItemId} not found. It may already be deleted, or the ID may be wrong. Verify the ID in ADO and try again.` }],
              isError: true,
            };
          }
        }
        return {
          content: [{ type: "text" as const, text: `Error fetching work item ${workItemId}: ${err}` }],
          isError: true,
        };
      }

      // Step 2: enforce type — this tool ONLY deletes Test Cases
      const workItemType = (workItem.fields?.["System.WorkItemType"] as string) ?? "(unknown)";
      if (workItemType !== "Test Case") {
        const title = (workItem.fields?.["System.Title"] as string) ?? "(no title)";
        return {
          content: [{
            type: "text" as const,
            text: `**Refused to delete work item ${workItemId}.**\n\nThis tool only deletes **Test Cases**. The work item you referenced is a **${workItemType}**:\n\n- **Title:** ${title}\n- **Type:** ${workItemType}\n\nIf you intended to delete a test case, double-check the ID. If you intended to delete a ${workItemType}, do it directly in the ADO UI — this MCP server intentionally does not delete other work item types to prevent accidental data loss.`,
          }],
          isError: true,
        };
      }

      // Step 3: perform the delete
      try {
        const queryParams = destroy ? { destroy: "true" } : undefined;
        await client.delete(`/_apis/wit/workitems/${workItemId}`, "7.1", queryParams);
        const title = (workItem.fields?.["System.Title"] as string) ?? "";
        const msg = destroy
          ? `🔴 Test case ${workItemId}${title ? ` (${title})` : ""} **PERMANENTLY DELETED.** This cannot be recovered.`
          : `Test case ${workItemId}${title ? ` (${title})` : ""} deleted (moved to Recycle Bin — restorable within 30 days via ADO UI under Work Items → Recycle Bin).`;
        return { content: [{ type: "text" as const, text: msg }] };
      } catch (err) {
        if (err instanceof AdoClientError) {
          if (err.statusCode === 403) {
            return {
              content: [{ type: "text" as const, text: `Cannot delete test case ${workItemId}: **Insufficient permissions.** Your ADO PAT needs the **Work Items (Read & Write)** and **Test Management (Read & Write)** scopes.${destroy ? " Permanent-delete (destroy=true) also requires Project Administrator permission in ADO." : ""} Create a new PAT with these scopes and run /ado-testforge/ado-connect.` }],
              isError: true,
            };
          }
          if (err.statusCode === 401) {
            return {
              content: [{ type: "text" as const, text: `Cannot delete test case ${workItemId}: **Authentication failed.** Your ADO PAT is invalid or expired.` }],
              isError: true,
            };
          }
        }
        return {
          content: [{ type: "text" as const, text: `Error deleting test case ${workItemId}: ${err}` }],
          isError: true,
        };
      }
    }
  );
}

// ── Canonical read-result builders ──

/**
 * Build the CanonicalReadResult for `ado_suite_tests` from the flat
 * list returned by the ADO test-plan API.
 *
 * - `item.type` = "test-suite" (the suite is the read target).
 * - `children[]` = every test case in the suite, `relationship:
 *   "contained"`.
 * - `completeness.isPartial` = false; the ADO `/TestCase` endpoint
 *   returns the full suite contents in one page.
 */
export function buildListTestCasesCanonicalResult(
  planId: number,
  suiteId: number,
  cases: Array<{ id: number; name: string }>,
): CanonicalReadResult {
  return {
    item: {
      id: suiteId,
      type: "test-suite",
      title: `Test Suite ${suiteId}`,
      summary: `${cases.length} test case${cases.length === 1 ? "" : "s"} in suite ${suiteId} (plan ${planId})`,
    },
    children: cases.map((tc) => ({
      id: tc.id,
      type: "test-case",
      title: tc.name,
      relationship: "contained",
    })),
    completeness: { isPartial: false },
  };
}

/**
 * Build the CanonicalReadResult for `qa_tc_read` from the raw
 * AdoWorkItem returned by the ADO API.
 *
 * - `item.type` = "test-case".
 * - `children`: derived from `item.relations` — one entry per work-item
 *   relation (parent, tested-by, tested, related, …). Non work-item
 *   relations (attachments, hyperlinks) are routed to `artifacts`.
 * - `artifacts`: attachment relations if any.
 * - `completeness.isPartial` = false (this tool returns the full item
 *   shape in prose; no truncation is applied).
 */
export function buildTestCaseCanonicalResult(item: AdoWorkItem): CanonicalReadResult {
  const relations = item.relations ?? [];
  const children: CanonicalReadChild[] = [];
  const artifacts: CanonicalReadArtifact[] = [];

  for (const rel of relations) {
    if (rel.rel === "AttachedFile") {
      const name = (rel.attributes?.["name"] as string | undefined) ?? "attachment";
      artifacts.push({ kind: "attachment", title: name, url: rel.url });
      continue;
    }
    if (rel.rel === "Hyperlink") {
      const comment = (rel.attributes?.["comment"] as string | undefined) ?? rel.url;
      artifacts.push({ kind: "hyperlink", title: comment, url: rel.url });
      continue;
    }
    // Otherwise treat as a related work item.
    const parts = rel.url.split("/");
    const idStr = parts[parts.length - 1] ?? "";
    const idNum = parseInt(idStr, 10);
    const id: string | number = Number.isNaN(idNum) ? rel.url : idNum;
    const title = (rel.attributes?.["name"] as string | undefined) ?? rel.rel;
    children.push({
      id,
      type: "work-item",
      title,
      relationship: rel.rel,
    });
  }

  const title = (item.fields["System.Title"] as string) ?? `Test Case ${item.id}`;
  const descriptionHtml = (item.fields["System.Description"] as string) ?? "";
  const summary = stripHtml(descriptionHtml).slice(0, 500) || undefined;

  return {
    item: {
      id: item.id,
      type: "test-case",
      title,
      summary,
    },
    ...(children.length > 0 ? { children } : {}),
    ...(artifacts.length > 0 ? { artifacts } : {}),
    completeness: { isPartial: false },
  };
}

// ── Core Logic (exported for qa_publish_push) ──

export interface CreateTestCaseParams {
  planId: number;
  userStoryId: number;
  tcNumber?: number;
  featureTags: string[];
  useCaseSummary: string;
  priority?: number;
  prerequisites?: {
    personas?: string | string[] | null;
    preConditions?: string[] | null;
    testData?: string | null;
  };
  steps: Array<{ action: string; expectedResult: string }>;
  areaPath?: string | null;
  iterationPath?: string | null;
  assignedTo?: string;
}

export async function createTestCase(client: AdoClient, params: CreateTestCaseParams): Promise<TestCaseResult> {
  const config = loadConventionsConfig();

  const usItem = await client.get<AdoWorkItem>(
    `/_apis/wit/workitems/${params.userStoryId}`,
    "7.0",
    { fields: "System.AreaPath,System.IterationPath" }
  );
  const usAreaPath = (usItem.fields["System.AreaPath"] as string) || "";
  const usIterationPath = (usItem.fields["System.IterationPath"] as string) || "";

  const tcNumber = params.tcNumber ?? await getNextTcNumber(client, params.userStoryId, usAreaPath);
  const title = buildTcTitle(params.userStoryId, tcNumber, params.featureTags, params.useCaseSummary);
  const description = buildPrerequisitesHtml(params.prerequisites);
  const stepsXml = buildStepsXml(params.steps);
  // Prefer User Story's paths (live from ADO) to avoid TF401347 Invalid tree name - draft parsing can differ
  const areaPath = usAreaPath || params.areaPath || "";
  const iterationPath = usIterationPath || params.iterationPath || "";
  const priority = params.priority ?? config.testCaseDefaults.priority;
  const state = config.testCaseDefaults.state;

  const ops: JsonPatchOperation[] = [
    { op: "add", path: "/fields/System.Title", value: title },
    { op: "add", path: "/fields/System.AreaPath", value: areaPath },
    { op: "add", path: "/fields/System.IterationPath", value: iterationPath },
    { op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: priority },
    { op: "add", path: "/fields/System.State", value: state },
    { op: "add", path: "/fields/Microsoft.VSTS.TCM.Steps", value: stepsXml },
  ];

  const prereqField = config.prerequisiteFieldRef ?? "System.Description";
  if (description) {
    ops.push({ op: "add", path: `/fields/${prereqField}`, value: description });
  }

  if (params.assignedTo) {
    ops.push({ op: "add", path: "/fields/System.AssignedTo", value: params.assignedTo });
  }

  // Link to User Story via "Tests / Tested By" relation
  ops.push({
    op: "add",
    path: "/relations/-",
    value: {
      rel: "Microsoft.VSTS.Common.TestedBy-Reverse",
      url: `${client.baseUrl}/_apis/wit/workitems/${params.userStoryId}`,
      attributes: { comment: "Auto-linked by MCP server" },
    },
  });

  const item = await client.post<AdoWorkItem>(
    "/_apis/wit/workitems/$Test Case",
    ops,
    "application/json-patch+json",
    "7.0"
  );

  return {
    id: item.id,
    title: (item.fields["System.Title"] as string) || title,
    url: item.url,
    state: (item.fields["System.State"] as string) || state,
    priority,
  };
}

/**
 * Updates an existing test case with the same params as createTestCase.
 * Used for repush when draft is revised after initial push.
 */
export async function updateTestCaseFromParams(
  client: AdoClient,
  workItemId: number,
  params: CreateTestCaseParams
): Promise<TestCaseResult> {
  const config = loadConventionsConfig();
  const title = buildTcTitle(params.userStoryId, params.tcNumber ?? 0, params.featureTags, params.useCaseSummary);
  const prereqHtml = buildPrerequisitesHtml(params.prerequisites);
  const stepsXml = buildStepsXml(params.steps);
  const prereqField = config.prerequisiteFieldRef ?? "System.Description";
  const priority = params.priority ?? config.testCaseDefaults.priority;

  const ops: JsonPatchOperation[] = [
    { op: "replace", path: "/fields/System.Title", value: title },
    { op: "replace", path: `/fields/${prereqField}`, value: prereqHtml },
    { op: "replace", path: "/fields/Microsoft.VSTS.TCM.Steps", value: stepsXml },
    { op: "replace", path: "/fields/Microsoft.VSTS.Common.Priority", value: priority },
  ];

  const item = await client.patch<AdoWorkItem>(
    `/_apis/wit/workitems/${workItemId}`,
    ops,
    "application/json-patch+json",
    "7.0"
  );

  return {
    id: item.id,
    title: (item.fields["System.Title"] as string) || title,
    url: item.url,
    state: (item.fields["System.State"] as string) || config.testCaseDefaults.state,
    priority,
  };
}

async function getNextTcNumber(client: AdoClient, usId: number, areaPath: string): Promise<number> {
  const wiql = {
    query:
      `SELECT [System.Id] FROM WorkItems ` +
      `WHERE [System.WorkItemType] = 'Test Case' ` +
      `AND [System.AreaPath] UNDER '${areaPath}' ` +
      `AND [System.Title] CONTAINS 'TC_${usId}_' ` +
      `ORDER BY [System.Title] DESC`,
  };

  try {
    const result = await client.post<{ workItems: Array<{ id: number }> }>(
      "/_apis/wit/wiql",
      wiql,
      "application/json",
      "7.0"
    );
    return (result.workItems?.length ?? 0) + 1;
  } catch {
    return 1;
  }
}
