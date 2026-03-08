import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoClient } from "../ado-client.ts";
import type { AdoTestPlan, AdoTestPlanListResponse } from "../types.ts";

export function registerTestPlanTools(server: McpServer, client: AdoClient) {
  server.tool(
    "list_test_plans",
    "List all test plans in the ADO project",
    {},
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

        return {
          content: [{ type: "text" as const, text: JSON.stringify(plans, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error listing test plans: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_test_plan",
    "Get a specific test plan by ID (includes area path, root suite, etc.)",
    { planId: z.number().int().positive().describe("The test plan ID") },
    async ({ planId }) => {
      try {
        const plan = await client.get<AdoTestPlan>(
          `/_apis/testplan/plans/${planId}`,
          "7.1"
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error fetching plan#${planId}: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "create_test_plan",
    "Create a new test plan (future use -- existing plans like GPT_D-HUB are typically used)",
    {
      name: z.string().describe("Name for the new test plan"),
      areaPath: z.string().optional().describe("Area path for the plan"),
      iteration: z.string().optional().describe("Iteration path for the plan"),
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
