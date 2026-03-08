import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoClient } from "../ado-client.ts";
import type { ConfluenceClient } from "../confluence-client.ts";

import { registerWorkItemTools } from "./work-items.ts";
import { registerTestPlanTools } from "./test-plans.ts";
import { registerTestSuiteTools } from "./test-suites.ts";
import { registerTestCaseTools } from "./test-cases.ts";
import { registerTcDraftTools } from "./tc-drafts.ts";
import { registerConfluenceTools } from "./confluence.ts";

export function registerAllTools(
  server: McpServer,
  adoClient: AdoClient,
  confluenceClient: ConfluenceClient | null
) {
  registerWorkItemTools(server, adoClient, confluenceClient);
  registerTestPlanTools(server, adoClient);
  registerTestSuiteTools(server, adoClient);
  registerTestCaseTools(server, adoClient, confluenceClient);
  registerTcDraftTools(server, adoClient);
  registerConfluenceTools(server, confluenceClient);
}
