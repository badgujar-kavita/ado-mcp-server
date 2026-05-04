import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoClient } from "../ado-client.ts";
import type { AdoTestPlan, AdoTestPlanListResponse } from "../types.ts";
import {
  READ_OUTPUT_SCHEMA,
  type CanonicalReadResult,
} from "./read-result.ts";

export function registerTestPlanTools(server: McpServer, client: AdoClient) {
  server.registerTool(
    "ado_plans",
    {
      title: "List Test Plans",
      description: "List all test plans in the ADO project",
      inputSchema: {},
      outputSchema: READ_OUTPUT_SCHEMA,
    },
    async () => {
      try {
        const result = await client.get<AdoTestPlanListResponse>(
          "/_apis/testplan/plans",
          "7.1"
        );

        const plans = result.value.map((p) => ({
          id: p.id,
          name: p.name,
          areaPath: p.areaPath,
          state: p.state,
          rootSuiteId: p.rootSuite?.id,
        }));

        const prose = JSON.stringify(plans, null, 2);
        const canonical = buildTestPlansListCanonicalResult(plans);
        return {
          content: [{ type: "text" as const, text: prose }],
          structuredContent: canonical as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error listing test plans: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "ado_plan",
    {
      title: "Read Test Plan",
      description: "Get a specific test plan by ID (includes area path, root suite, etc.)",
      inputSchema: { planId: z.number().int().positive().describe("The test plan ID") },
      outputSchema: READ_OUTPUT_SCHEMA,
    },
    async ({ planId }) => {
      try {
        const plan = await client.get<AdoTestPlan>(
          `/_apis/testplan/plans/${planId}`,
          "7.1"
        );

        const prose = JSON.stringify(plan, null, 2);
        const canonical = buildTestPlanCanonicalResult(plan);
        return {
          content: [{ type: "text" as const, text: prose }],
          structuredContent: canonical as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error fetching plan#${planId}: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "ado_plan_create",
    {
      title: "Create Test Plan",
      description: "Create a new test plan (future use -- existing plans configured in `conventions.config.json` testPlanMapping are typically used)",
      inputSchema: {
        name: z.string().describe("Name for the new test plan"),
        areaPath: z.string().optional().describe("Area path for the plan"),
        iteration: z.string().optional().describe("Iteration path for the plan"),
      },
    },
    async ({ name, areaPath, iteration }) => {
      try {
        const body: Record<string, unknown> = { name };
        if (areaPath) body.areaPath = areaPath;
        if (iteration) body.iteration = iteration;

        const plan = await client.post<AdoTestPlan>(
          "/_apis/testplan/plans",
          body,
          "application/json",
          "7.1"
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error creating test plan: ${err}` }],
          isError: true,
        };
      }
    }
  );
}

// ── Canonical read-result builders ──

/**
 * Shape of the flat plan summary list produced by `ado_plans`.
 * Kept local — this is the prose payload, not a domain type.
 */
interface TestPlanSummary {
  id: number;
  name: string;
  areaPath: string;
  state: string;
  rootSuiteId: number | undefined;
}

/**
 * Build the CanonicalReadResult for `ado_plans`.
 *
 * - `item.type` = "project" (the project is the implicit read target
 *   for a list of all plans).
 * - `children[]` = every test plan in the project, `relationship:
 *   "contained"`.
 * - `completeness.isPartial` = false; the ADO `/testplan/plans` endpoint
 *   returns the full list without server-side pagination we apply.
 */
export function buildTestPlansListCanonicalResult(
  plans: TestPlanSummary[],
): CanonicalReadResult {
  return {
    item: {
      id: "project-test-plans",
      type: "project",
      title: "Test Plans in Project",
      summary: `${plans.length} test plan${plans.length === 1 ? "" : "s"}`,
    },
    children: plans.map((plan) => ({
      id: plan.id,
      type: "test-plan",
      title: plan.name,
      relationship: "contained",
    })),
    completeness: { isPartial: false },
  };
}

/**
 * Build the CanonicalReadResult for `ado_plan`.
 *
 * - `item.type` = "test-plan".
 * - `children`: single entry for `plan.rootSuite` when present,
 *   `relationship: "root-suite"`. When the ADO response omits rootSuite
 *   (rare but possible), no children are emitted.
 * - `completeness.isPartial` = false.
 */
export function buildTestPlanCanonicalResult(
  plan: AdoTestPlan,
): CanonicalReadResult {
  const hasRootSuite = plan.rootSuite && typeof plan.rootSuite.id === "number";
  return {
    item: {
      id: plan.id,
      type: "test-plan",
      title: plan.name,
      summary: plan.areaPath ? `Area: ${plan.areaPath}` : undefined,
    },
    ...(hasRootSuite
      ? {
          children: [
            {
              id: plan.rootSuite.id,
              type: "test-suite",
              title: plan.rootSuite.name,
              relationship: "root-suite",
            },
          ],
        }
      : {}),
    completeness: { isPartial: false },
  };
}
