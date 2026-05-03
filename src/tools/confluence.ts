import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfluenceClient } from "../confluence-client.ts";
import type { ConfluencePageResult } from "../types.ts";
import {
  READ_OUTPUT_SCHEMA,
  type CanonicalReadResult,
} from "./read-result.ts";

/**
 * Build the CanonicalReadResult for `confluence_read`.
 *
 * - `item.type` = "confluence-page".
 * - `item.summary` is a first-500-char excerpt of the page body
 *   (body is already plaintext after ConfluenceClient.getPageContent).
 * - `completeness.isPartial` = false. This tool does a single-page
 *   fetch without hierarchy walking, so there's no truncation signal
 *   to report — when Port-Commit 4 adds child-walking, this will flip
 *   to a computed partial/not-partial based on walk depth.
 */
export function buildConfluencePageCanonicalResult(
  pageId: string,
  page: ConfluencePageResult,
): CanonicalReadResult {
  return {
    item: {
      id: pageId,
      type: "confluence-page",
      title: page.title,
      summary: page.body.slice(0, 500) || undefined,
    },
    completeness: { isPartial: false },
  };
}

export function registerConfluenceTools(server: McpServer, confluenceClient: ConfluenceClient | null) {
  server.registerTool(
    "confluence_read",
    {
      description:
        "Read a Confluence page by ID for Solution Design reference (requires CONFLUENCE_* env vars)",
      inputSchema: {
        pageId: z.string().describe("Confluence page ID"),
      },
      outputSchema: READ_OUTPUT_SCHEMA,
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
        const prose = `# ${page.title}\n\n${page.body}`;
        const canonical = buildConfluencePageCanonicalResult(pageId, page);
        return {
          content: [{
            type: "text" as const,
            text: prose,
          }],
          structuredContent: canonical as unknown as Record<string, unknown>,
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
