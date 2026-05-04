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
import {
  READ_OUTPUT_SCHEMA,
  type CanonicalReadResult,
} from "./read-result.ts";

export function registerTestSuiteTools(server: McpServer, client: AdoClient) {
  server.registerTool(
    "qa_suite_setup",
    {
      title: "Set Up Suite Hierarchy",
      description: "Build the full suite folder hierarchy for a User Story. Only needs User Story ID — auto-derives plan and sprint from US AreaPath and Iteration. Optionally override planId and/or sprintNumber for manual control.",
      inputSchema: {
        userStoryId: z.number().int().positive().describe("The User Story work item ID"),
        planId: z.number().int().positive().optional().describe("Override: test plan ID (skips AreaPath lookup)"),
        sprintNumber: z.number().int().positive().optional().describe("Override: sprint number (skips Iteration parsing)"),
      },
    },
    async ({ userStoryId, planId, sprintNumber }) => {
      try {
        const result = await ensureSuiteHierarchyForUs(client, userStoryId, planId, sprintNumber);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Structured ask-response for resolution failures
        if (message.includes("has no AreaPath or IterationPath")) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              status: "needs-input",
              reason: "missing-fields",
              message,
              suggestion: "Provide both planId and sprintNumber overrides: { planId: 123456, sprintNumber: 14 }",
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
              suggestion: "Provide planId override: { planId: 123456 }",
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
              suggestion: "Provide sprintNumber override: { sprintNumber: 14 }",
              resolvedSoFar: { userStoryId },
            }, null, 2) }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: `Error ensuring suite hierarchy: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "ado_suites",
    {
      title: "List Test Suites",
      description: "List all test suites in a test plan",
      inputSchema: {
        planId: z.number().int().positive().describe("The test plan ID"),
      },
      outputSchema: READ_OUTPUT_SCHEMA,
    },
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
        const prose = JSON.stringify(suites, null, 2);
        const canonical = buildSuiteListCanonicalResult(planId, result.value);
        return {
          content: [{ type: "text" as const, text: prose }],
          structuredContent: canonical as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error listing suites: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "ado_suite",
    {
      title: "Read Test Suite",
      description: "Get details of a specific test suite",
      inputSchema: {
        planId: z.number().int().positive().describe("The test plan ID"),
        suiteId: z.number().int().positive().describe("The test suite ID"),
      },
      outputSchema: READ_OUTPUT_SCHEMA,
    },
    async ({ planId, suiteId }) => {
      try {
        const suite = await client.get<AdoTestSuite>(
          `/_apis/testplan/Plans/${planId}/suites/${suiteId}`,
          "7.1"
        );
        const prose = JSON.stringify(suite, null, 2);
        const canonical = buildSuiteCanonicalResult(suite);
        return {
          content: [{ type: "text" as const, text: prose }],
          structuredContent: canonical as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error fetching suite: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_suite_update",
    {
      title: "Update Test Suite",
      description: "Update an existing test suite (name, parent, query string). Only include fields you want to change.",
      inputSchema: {
        planId: z.number().int().positive().describe("The test plan ID"),
        suiteId: z.number().int().positive().describe("The test suite ID to update"),
        name: z.string().optional().describe("New suite name"),
        parentSuiteId: z.number().int().positive().optional().describe("New parent suite ID"),
        queryString: z.string().optional().describe("New WIQL query (for dynamic suites)"),
      },
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

  server.registerTool(
    "qa_suite_delete",
    {
      title: "Delete Test Suite",
      description: "Delete a test suite. Test cases in the suite are not deleted—only their association with the suite is removed.",
      inputSchema: {
        planId: z.number().int().positive().describe("The test plan ID"),
        suiteId: z.number().int().positive().describe("The test suite ID to delete"),
      },
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

// ── Canonical read-result builders ──

/**
 * Build the CanonicalReadResult for `ado_suites`.
 *
 * - `item` represents the test plan itself (the read target).
 * - `children[]` = every suite in the plan, `relationship: "child"` when
 *   it has a parent suite, `relationship: "root"` for the plan's root
 *   suite (no `parentSuite`).
 * - `completeness.isPartial` = false; the ADO `/suites` endpoint returns
 *   the full plan tree in one response.
 */
export function buildSuiteListCanonicalResult(
  planId: number,
  suites: AdoTestSuite[],
): CanonicalReadResult {
  return {
    item: {
      id: planId,
      type: "test-plan",
      title: `Test Plan #${planId}`,
      summary: `${suites.length} suite${suites.length === 1 ? "" : "s"} in plan ${planId}`,
    },
    children: suites.map((suite) => ({
      id: suite.id,
      type: "test-suite",
      title: suite.name,
      relationship: suite.parentSuite ? "child" : "root",
    })),
    completeness: { isPartial: false },
  };
}

/**
 * Build the CanonicalReadResult for `ado_suite`.
 *
 * - `item` = the suite itself. `summary` carries the suite type if
 *   present.
 * - `children[]` surfaces the parent suite as a single entry with
 *   `relationship: "parent"` when one exists.
 * - `artifacts[]` exposes the WIQL `queryString` of a query-based suite
 *   as an artifact — test-design-relevant because it tells the agent
 *   which test cases auto-populate this suite.
 * - `completeness.isPartial` = false.
 */
export function buildSuiteCanonicalResult(suite: AdoTestSuite): CanonicalReadResult {
  const result: CanonicalReadResult = {
    item: {
      id: suite.id,
      type: "test-suite",
      title: suite.name,
      ...(suite.suiteType ? { summary: `Type: ${suite.suiteType}` } : {}),
    },
    completeness: { isPartial: false },
  };
  if (suite.parentSuite) {
    result.children = [
      {
        id: suite.parentSuite.id,
        type: "test-suite",
        title: suite.parentSuite.name ?? `Parent Suite ${suite.parentSuite.id}`,
        relationship: "parent",
      },
    ];
  }
  if (suite.queryString) {
    result.artifacts = [
      {
        kind: "query",
        title: "Query-based suite WIQL",
        summary: suite.queryString.slice(0, 200),
      },
    ];
  }
  return result;
}

// ── Core Logic ──

export async function ensureSuiteHierarchyForUs(
  client: AdoClient,
  userStoryId: number,
  overridePlanId?: number,
  overrideSprintNumber?: number
): Promise<SuiteHierarchyResult> {
  const usItem = await client.get<AdoWorkItem>(
    `/_apis/wit/workitems/${userStoryId}`,
    "7.0",
    { fields: "System.Title,System.Parent,System.AreaPath,System.IterationPath" }
  );
  const areaPath = (usItem.fields["System.AreaPath"] as string) || "";
  const iterationPath = (usItem.fields["System.IterationPath"] as string) || "";

  // Only require AreaPath/IterationPath when we need them for auto-derivation
  if (!overridePlanId && !areaPath) {
    throw new Error(
      `User Story ${userStoryId} has no AreaPath or IterationPath. Cannot resolve test plan or sprint.`
    );
  }
  if (!overrideSprintNumber && !iterationPath) {
    throw new Error(
      `User Story ${userStoryId} has no AreaPath or IterationPath. Cannot resolve test plan or sprint.`
    );
  }

  const planId = overridePlanId ?? resolvePlanIdFromAreaPath(areaPath);
  const sprintNumber = overrideSprintNumber ?? resolveSprintFromIteration(iterationPath);

  // Cross-validate: if planId was overridden, check if it matches auto-derivation
  const overrideWarnings: string[] = [];
  if (overridePlanId && areaPath) {
    try {
      const autoPlanId = resolvePlanIdFromAreaPath(areaPath);
      if (autoPlanId !== overridePlanId) {
        overrideWarnings.push(
          `Plan ID mismatch: US ${userStoryId} AreaPath "${areaPath}" maps to plan ${autoPlanId}, but you overrode with plan ${overridePlanId}. The suite was created in plan ${overridePlanId}. If this was unintentional, delete the suite and re-run without the planId override.`
        );
      }
    } catch {
      // Auto-derivation failed (no mapping) — override is the only option, no warning needed
    }
  }
  if (overrideSprintNumber && iterationPath) {
    try {
      const autoSprint = resolveSprintFromIteration(iterationPath);
      if (autoSprint !== overrideSprintNumber) {
        overrideWarnings.push(
          `Sprint mismatch: US ${userStoryId} Iteration "${iterationPath}" maps to sprint ${autoSprint}, but you overrode with sprint ${overrideSprintNumber}.`
        );
      }
    } catch {
      // Auto-derivation failed — override is the only option, no warning needed
    }
  }

  const result = await ensureSuiteHierarchy(client, planId, sprintNumber, userStoryId);
  if (overrideWarnings.length > 0) {
    result.warnings = [...(result.warnings ?? []), ...overrideWarnings];
  }
  return result;
}

async function ensureSuiteHierarchy(
  client: AdoClient,
  planId: number,
  sprintNumber: number,
  userStoryId: number
): Promise<SuiteHierarchyResult> {
  const created: string[] = [];
  const existing: string[] = [];
  const warnings: string[] = [];

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
      warnings.push(`Could not fetch title for parent work item ${parentId}; using fallback name.`);
    }
  }

  // Level 1: Sprint folder
  const sprintName = buildSprintFolderName(sprintNumber);
  const sprintResult = await findOrCreateSuite(client, planId, rootSuiteId, sprintName, "staticTestSuite");
  (sprintResult.created ? created : existing).push(sprintName);
  if (sprintResult.warning) warnings.push(sprintResult.warning);

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
  if (level2Result.warning) warnings.push(level2Result.warning);

  // Level 3: US folder (query-based suite)
  const usName = buildUsFolderName(userStoryId, usTitle);
  const queryString = buildSuiteQueryString(userStoryId, planAreaPath);
  const usResult = await findOrCreateSuite(
    client, planId, level2Result.suite.id, usName, "dynamicTestSuite", queryString
  );
  (usResult.created ? created : existing).push(usName);
  if (usResult.warning) warnings.push(usResult.warning);

  return {
    planId,
    leafSuiteId: usResult.suite.id,
    leafSuiteName: usName,
    created,
    existing,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

interface FindOrCreateResult {
  created: boolean;
  suite: AdoTestSuite;
  warning?: string;
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
      return { created: false, suite: updated, warning: `Renamed suite '${match.name}' → '${suiteName}' (case correction)` };
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
