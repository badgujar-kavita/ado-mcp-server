import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoClient } from "../ado-client.ts";
import type { AdoTestSuite, AdoTestSuiteListResponse, AdoTestPlan, AdoWorkItem, SuiteHierarchyResult } from "../types.ts";
import {
  buildSprintFolderName,
  buildParentUsFolderName,
  buildUsFolderName,
  getNonEpicFolderName,
  buildSuiteQueryString,
  resolvePlanIdFromAreaPath,
  resolveSprintFromIteration,
} from "../helpers/suite-structure.ts";

export function registerTestSuiteTools(server: McpServer, client: AdoClient) {
  server.tool(
    "ensure_suite_hierarchy_for_us",
    "Build the full suite folder hierarchy for a User Story. Only needs User Story ID — derives plan and sprint from US AreaPath and Iteration. Creates if missing; updates naming if existing suite has wrong format.",
    {
      userStoryId: z.number().int().positive().describe("The User Story work item ID"),
    },
    async ({ userStoryId }) => {
      try {
        const result = await ensureSuiteHierarchyForUs(client, userStoryId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error ensuring suite hierarchy: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "ensure_suite_hierarchy",
    "Build the full suite folder hierarchy (sprint > parent-us/non-epic > us-query) for a User Story. Checks for existing suites at each level before creating.",
    {
      planId: z.number().int().positive().describe("The test plan ID (e.g., GPT_D-HUB plan ID)"),
      sprintNumber: z.number().int().positive().describe("Sprint number (e.g., 24 for SFTPM_24)"),
      userStoryId: z.number().int().positive().describe("The User Story work item ID"),
    },
    async ({ planId, sprintNumber, userStoryId }) => {
      try {
        const result = await ensureSuiteHierarchy(client, planId, sprintNumber, userStoryId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error ensuring suite hierarchy: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "find_or_create_test_suite",
    "Find a test suite by name under a parent suite, or create it if not found",
    {
      planId: z.number().int().positive().describe("The test plan ID"),
      parentSuiteId: z.number().int().positive().describe("Parent suite ID to search/create under"),
      suiteName: z.string().describe("Name of the suite to find or create"),
      suiteType: z.enum(["staticTestSuite", "dynamicTestSuite"]).default("staticTestSuite")
        .describe("Type of suite to create if not found"),
      queryString: z.string().optional().describe("WIQL query for dynamic suites"),
    },
    async ({ planId, parentSuiteId, suiteName, suiteType, queryString }) => {
      try {
        const result = await findOrCreateSuite(client, planId, parentSuiteId, suiteName, suiteType, queryString);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error finding/creating suite: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_test_suites",
    "List all test suites in a test plan",
    { planId: z.number().int().positive().describe("The test plan ID") },
    async ({ planId }) => {
      try {
        const result = await client.get<AdoTestSuiteListResponse>(
          `/_apis/testplan/Plans/${planId}/suites`,
          "7.1"
        );
        const suites = result.value.map((s) => ({
          id: s.id,
          name: s.name,
          suiteType: s.suiteType,
          parentSuiteId: s.parentSuite?.id,
          hasChildren: s.hasChildren,
        }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(suites, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error listing suites: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_test_suite",
    "Get details of a specific test suite",
    {
      planId: z.number().int().positive().describe("The test plan ID"),
      suiteId: z.number().int().positive().describe("The test suite ID"),
    },
    async ({ planId, suiteId }) => {
      try {
        const suite = await client.get<AdoTestSuite>(
          `/_apis/testplan/Plans/${planId}/suites/${suiteId}`,
          "7.1"
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(suite, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error fetching suite: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "create_test_suite",
    "Create a new test suite under a parent suite. Use find_or_create_test_suite if you need to find-or-create.",
    {
      planId: z.number().int().positive().describe("The test plan ID"),
      parentSuiteId: z.number().int().positive().describe("Parent suite ID to create under"),
      suiteName: z.string().describe("Name of the suite to create"),
      suiteType: z.enum(["staticTestSuite", "dynamicTestSuite"]).default("staticTestSuite")
        .describe("Type of suite"),
      queryString: z.string().optional().describe("WIQL query for dynamic suites"),
    },
    async ({ planId, parentSuiteId, suiteName, suiteType, queryString }) => {
      try {
        const result = await findOrCreateSuite(client, planId, parentSuiteId, suiteName, suiteType, queryString);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              created: result.created,
              suite: result.suite,
              message: result.created ? `Suite "${suiteName}" created.` : `Suite "${suiteName}" already existed.`,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error creating suite: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "update_test_suite",
    "Update an existing test suite (name, parent, query string). Only include fields you want to change.",
    {
      planId: z.number().int().positive().describe("The test plan ID"),
      suiteId: z.number().int().positive().describe("The test suite ID to update"),
      name: z.string().optional().describe("New suite name"),
      parentSuiteId: z.number().int().positive().optional().describe("New parent suite ID"),
      queryString: z.string().optional().describe("New WIQL query (for dynamic suites)"),
    },
    async ({ planId, suiteId, name, parentSuiteId, queryString }) => {
      try {
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (parentSuiteId !== undefined) body.parentSuite = { id: parentSuiteId };
        if (queryString !== undefined) body.queryString = queryString;
        if (Object.keys(body).length === 0) {
          return {
            content: [{ type: "text" as const, text: "No fields to update. Provide at least one of: name, parentSuiteId, queryString." }],
            isError: true,
          };
        }
        const suite = await client.patch<AdoTestSuite>(
          `/_apis/testplan/Plans/${planId}/suites/${suiteId}`,
          body,
          "application/json",
          "7.1"
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(suite, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error updating suite: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "delete_test_suite",
    "Delete a test suite. Test cases in the suite are not deleted—only their association with the suite is removed.",
    {
      planId: z.number().int().positive().describe("The test plan ID"),
      suiteId: z.number().int().positive().describe("The test suite ID to delete"),
    },
    async ({ planId, suiteId }) => {
      try {
        await client.delete(
          `/_apis/testplan/Plans/${planId}/suites/${suiteId}`,
          "7.1"
        );
        return {
          content: [{ type: "text" as const, text: `Test suite ${suiteId} deleted successfully.` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error deleting suite: ${err}` }],
          isError: true,
        };
      }
    }
  );
}

// ── Core Logic ──

export async function ensureSuiteHierarchyForUs(
  client: AdoClient,
  userStoryId: number
): Promise<SuiteHierarchyResult> {
  const usItem = await client.get<AdoWorkItem>(
    `/_apis/wit/workitems/${userStoryId}`,
    "7.0",
    { fields: "System.Title,System.Parent,System.AreaPath,System.IterationPath" }
  );
  const areaPath = (usItem.fields["System.AreaPath"] as string) || "";
  const iterationPath = (usItem.fields["System.IterationPath"] as string) || "";
  if (!areaPath || !iterationPath) {
    throw new Error(
      `User Story ${userStoryId} has no AreaPath or IterationPath. Cannot resolve test plan or sprint.`
    );
  }
  const planId = resolvePlanIdFromAreaPath(areaPath);
  const sprintNumber = resolveSprintFromIteration(iterationPath);
  return ensureSuiteHierarchy(client, planId, sprintNumber, userStoryId);
}

async function ensureSuiteHierarchy(
  client: AdoClient,
  planId: number,
  sprintNumber: number,
  userStoryId: number
): Promise<SuiteHierarchyResult> {
  const created: string[] = [];
  const existing: string[] = [];

  const plan = await client.get<AdoTestPlan>(`/_apis/testplan/plans/${planId}`, "7.1");
  const rootSuiteId = plan.rootSuite.id;
  const planAreaPath = plan.areaPath;

  const usItem = await client.get<AdoWorkItem>(
    `/_apis/wit/workitems/${userStoryId}`,
    "7.0",
    { fields: "System.Title,System.Parent" }
  );
  const usTitle = (usItem.fields["System.Title"] as string) || `US ${userStoryId}`;
  const parentId = (usItem.fields["System.Parent"] as number) || null;

  let parentTitle: string | null = null;
  if (parentId) {
    try {
      const parentItem = await client.get<AdoWorkItem>(
        `/_apis/wit/workitems/${parentId}`,
        "7.0",
        { fields: "System.Title" }
      );
      parentTitle = (parentItem.fields["System.Title"] as string) || null;
    } catch {
      parentTitle = `Parent ${parentId}`;
    }
  }

  // Level 1: Sprint folder
  const sprintName = buildSprintFolderName(sprintNumber);
  const sprintResult = await findOrCreateSuite(client, planId, rootSuiteId, sprintName, "staticTestSuite");
  (sprintResult.created ? created : existing).push(sprintName);

  // Level 2: Parent US folder or Non-Epic folder
  let level2Result: FindOrCreateResult;
  let level2Name: string;
  if (parentId && parentTitle) {
    level2Name = buildParentUsFolderName(parentId, parentTitle);
  } else {
    level2Name = getNonEpicFolderName();
  }
  level2Result = await findOrCreateSuite(client, planId, sprintResult.suite.id, level2Name, "staticTestSuite");
  (level2Result.created ? created : existing).push(level2Name);

  // Level 3: US folder (query-based suite)
  const usName = buildUsFolderName(userStoryId, usTitle);
  const queryString = buildSuiteQueryString(userStoryId, planAreaPath);
  const usResult = await findOrCreateSuite(
    client, planId, level2Result.suite.id, usName, "dynamicTestSuite", queryString
  );
  (usResult.created ? created : existing).push(usName);

  return {
    planId,
    leafSuiteId: usResult.suite.id,
    leafSuiteName: usName,
    created,
    existing,
  };
}

interface FindOrCreateResult {
  created: boolean;
  suite: AdoTestSuite;
}

async function findOrCreateSuite(
  client: AdoClient,
  planId: number,
  parentSuiteId: number,
  suiteName: string,
  suiteType: "staticTestSuite" | "dynamicTestSuite",
  queryString?: string
): Promise<FindOrCreateResult> {
  const allSuites = await client.get<AdoTestSuiteListResponse>(
    `/_apis/testplan/Plans/${planId}/suites`,
    "7.1"
  );

  const match = allSuites.value.find(
    (s) =>
      s.name.toLowerCase() === suiteName.toLowerCase() &&
      s.parentSuite?.id === parentSuiteId
  );

  if (match) {
    if (match.name !== suiteName) {
      const updated = await client.patch<AdoTestSuite>(
        `/_apis/testplan/Plans/${planId}/suites/${match.id}`,
        { name: suiteName },
        "application/json",
        "7.1"
      );
      return { created: false, suite: updated };
    }
    return { created: false, suite: match };
  }

  const body: Record<string, unknown> = {
    suiteType,
    name: suiteName,
    parentSuite: { id: parentSuiteId },
  };

  if (suiteType === "dynamicTestSuite" && queryString) {
    body.queryString = queryString;
  }

  const newSuite = await client.post<AdoTestSuite>(
    `/_apis/testplan/Plans/${planId}/suites`,
    body,
    "application/json",
    "7.1"
  );

  return { created: true, suite: newSuite };
}
