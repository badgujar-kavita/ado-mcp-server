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

export function registerConfluenceTools(server: McpServer, _confluenceClientUnused: ConfluenceClient | null) {
  server.registerTool(
    "confluence_read",
    {
      title: "Read Confluence Page",
      description:
        "Read a Confluence page by ID for Solution Design reference. Requires Confluence to be enabled in <workspace>/.vortex-ado/config.json with the API token stored in the OS keychain (run /vortex-ado/ado-connect to set up).",
      inputSchema: {
        pageId: z.string().describe("Confluence page ID"),
      },
      outputSchema: READ_OUTPUT_SCHEMA,
    },
    async ({ pageId }) => {
      // Per-call ConfluenceClient resolution from the active CallContext
      // (roots/list → workspaceRoot). Returns null when Confluence isn't
      // configured — surface the standard "not configured" message.
      const { resolveConfluenceClientForActiveCall } = await import("../workspace/confluence-client-proxy.ts");
      const confluenceClient = await resolveConfluenceClientForActiveCall();
      if (!confluenceClient) {
        return {
          content: [{
            type: "text" as const,
            text:
              "Confluence is not configured for this workspace. Run /vortex-ado/ado-connect to enable Confluence in <workspace>/.vortex-ado/config.json and store your API token in the OS keychain.",
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
