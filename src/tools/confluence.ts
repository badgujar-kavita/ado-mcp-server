import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfluenceClient } from "../confluence-client.ts";
import type { ConfluencePageResult } from "../types.ts";
import {
  extractConfluencePageIdFromUrl,
  extractTinyUrlPath,
} from "../helpers/confluence-url.ts";
import {
  READ_OUTPUT_SCHEMA,
  type CanonicalReadResult,
} from "./read-result.ts";

/**
 * Resolve any of the inputs `confluence_read` accepts (numeric pageId,
 * canonical `/pages/{id}/...` URL, query-param URL, or `/wiki/x/{token}`
 * tiny URL) to a numeric pageId string. Returns null if the input doesn't
 * contain a recognizable pageId AND tiny-URL resolution didn't succeed.
 *
 * Pure pageIds are returned as-is (no network round-trip), so existing
 * callers that pass a numeric ID see no extra latency or failure mode.
 */
async function resolveToPageId(
  input: string,
  confluenceClient: ConfluenceClient,
): Promise<string | null> {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;

  const direct = extractConfluencePageIdFromUrl(trimmed);
  if (direct) return direct;

  if (extractTinyUrlPath(trimmed)) {
    const resolvedUrl = await confluenceClient.resolveTinyUrl(trimmed);
    if (resolvedUrl) {
      return extractConfluencePageIdFromUrl(resolvedUrl);
    }
  }

  return null;
}

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
        "Read a Confluence page for Solution Design reference. Accepts a numeric page ID, a canonical /pages/{id}/... URL, a ?pageId= URL, or a /wiki/x/{token} short ('tiny') URL — short URLs are resolved automatically. Requires Confluence to be enabled in <workspace>/.vortex-ado/config.json with the API token stored in the OS keychain (run /vortex-ado/ado-connect to set up).",
      inputSchema: {
        pageId: z
          .string()
          .describe(
            "Confluence page ID, page URL, or tiny URL (https://*.atlassian.net/wiki/x/...)",
          ),
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

      const resolvedPageId = await resolveToPageId(pageId, confluenceClient);
      if (!resolvedPageId) {
        return {
          content: [{
            type: "text" as const,
            text:
              `Could not resolve "${pageId}" to a Confluence page ID. ` +
              "Pass a numeric page ID, a /pages/{id}/... URL, a ?pageId= URL, or a /wiki/x/{token} short URL. " +
              "If you passed a short URL, the page may not be visible to the configured Confluence credentials.",
          }],
          isError: true,
        };
      }

      try {
        const page = await confluenceClient.getPageContent(resolvedPageId);
        const prose = `# ${page.title}\n\n${page.body}`;
        const canonical = buildConfluencePageCanonicalResult(resolvedPageId, page);
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
            text: `Error fetching Confluence page ${resolvedPageId}: ${err}\n\nPlease check the page ID and your Confluence credentials.`,
          }],
          isError: true,
        };
      }
    }
  );

}
