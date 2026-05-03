import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfluenceClient } from "../confluence-client.ts";

export function registerConfluenceTools(server: McpServer, confluenceClient: ConfluenceClient | null) {
  server.tool(
    "get_confluence_page",
    "Read a Confluence page by ID for Solution Design reference (requires CONFLUENCE_* env vars)",
    {
      pageId: z.string().describe("Confluence page ID"),
    },
    async ({ pageId }) => {
      if (!confluenceClient) {
        return {
          content: [{
            type: "text" as const,
            text:
              "Confluence is not configured. Add confluence_base_url, confluence_email, and confluence_api_token to ~/.ado-testforge-mcp/credentials.json, " +
              "or set CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_API_TOKEN environment variables. See docs/setup-guide.md Step 4b.",
          }],
          isError: true,
        };
      }

      try {
        const page = await confluenceClient.getPageContent(pageId);
        return {
          content: [{
            type: "text" as const,
            text: `# ${page.title}\n\n${page.body}`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `Error fetching Confluence page ${pageId}: ${err}\n\nPlease check the page ID and your Confluence credentials.`,
          }],
          isError: true,
        };
      }
    }
  );

}
