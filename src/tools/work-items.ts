import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoClient } from "../ado-client.ts";
import type { ConfluenceClient } from "../confluence-client.ts";
import type { AdoWorkItem, UserStoryContext } from "../types.ts";
import { extractConfluencePageId, extractConfluenceUrl } from "../helpers/confluence-url.ts";
import { adoWorkItemUrl } from "../helpers/ado-urls.ts";
import { loadConventionsConfig } from "../config.ts";

function getSolutionDesignFieldRef(): string {
  const config = loadConventionsConfig();
  return config.solutionDesign?.adoFieldRef ?? "Custom.TechnicalSolution";
}

export function registerWorkItemTools(
  server: McpServer,
  client: AdoClient,
  confluenceClient: ConfluenceClient | null
) {
  server.tool(
    "get_user_story",
    "Fetch a User Story from ADO with description, acceptance criteria, parent info, Solution Design content from Confluence, and all relations",
    { workItemId: z.number().int().positive().describe("The ADO work item ID of the User Story") },
    async ({ workItemId }) => {
      try {
        const item = await client.get<AdoWorkItem>(
          `/_apis/wit/workitems/${workItemId}`,
          "7.0",
          { "$expand": "relations" }
        );

        const context = await extractUserStoryContext(item, confluenceClient);
        const withUrl = { ...context, webUrl: adoWorkItemUrl(client, context.id) };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(withUrl, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error fetching US#${workItemId}: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_test_cases_linked_to_user_story",
    "Get test case work item IDs linked to a User Story via Tests/Tested By relation. Use before cloning test cases from one US to another.",
    { userStoryId: z.number().int().positive().describe("The User Story work item ID") },
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
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              userStoryId,
              userStoryWebUrl: adoWorkItemUrl(client, userStoryId),
              testCases,
              testCaseIds: ids,
              count: ids.length,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error listing linked test cases: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_work_item_fields",
    "List all work item field definitions in the ADO project. Returns reference names (e.g. Custom.PrerequisiteforTest, System.Title) and metadata. Use to verify field names before updating work items.",
    {
      expand: z.string().optional().describe("Optional. Use 'ExtensionFields' to include extension fields."),
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
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ count: fields.length, value: fields }, null, 2) }],
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

async function extractUserStoryContext(
  item: AdoWorkItem,
  confluenceClient: ConfluenceClient | null
): Promise<UserStoryContext> {
  const fields = item.fields;
  const relations = item.relations ?? [];

  let parentId: number | null = null;
  let parentTitle: string | null = null;
  const parentRelation = relations.find((r) => r.rel === "System.LinkTypes.Hierarchy-Reverse");
  if (parentRelation) {
    const urlParts = parentRelation.url.split("/");
    parentId = parseInt(urlParts[urlParts.length - 1], 10) || null;
    parentTitle = (parentRelation.attributes?.["name"] as string) || null;
  }

  if (!parentTitle && fields["System.Parent"]) {
    parentId = fields["System.Parent"] as number;
  }

  const solutionFieldRef = getSolutionDesignFieldRef();
  const rawSolutionField = (fields[solutionFieldRef] as string) ?? null;
  const solutionDesignUrl = extractConfluenceUrl(rawSolutionField);
  let solutionDesignContent: string | null = null;

  if (confluenceClient && solutionDesignUrl) {
    const pageId = extractConfluencePageId(rawSolutionField);
    if (pageId) {
      try {
        const page = await confluenceClient.getPageContent(pageId);
        solutionDesignContent = `# ${page.title}\n\n${page.body}`;
      } catch {
        solutionDesignContent = null;
      }
    }
  }

  return {
    id: item.id,
    title: (fields["System.Title"] as string) || "",
    description: (fields["System.Description"] as string) || "",
    acceptanceCriteria: (fields["Microsoft.VSTS.Common.AcceptanceCriteria"] as string) || "",
    areaPath: (fields["System.AreaPath"] as string) || "",
    iterationPath: (fields["System.IterationPath"] as string) || "",
    state: (fields["System.State"] as string) || "",
    parentId,
    parentTitle,
    relations,
    solutionDesignUrl,
    solutionDesignContent,
  };
}
