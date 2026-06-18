/**
 * Per-call ConfluenceClient resolver.
 *
 * Resolution order: roots/list → explicit workspaceRoot arg.
 *
 * Returns null when no Confluence credentials can be found. Confluence
 * is optional, so a null return is graceful — `ado_story` and other
 * consumers skip Confluence enrichment when null.
 *
 * No legacy file fallback. No boot-time client. No cwd-based read.
 */

import { resolve as resolvePath } from "node:path";
import { ConfluenceClient, createConfluenceClient } from "../confluence-client.ts";
import { loadCredentialsForWorkspace } from "../credentials.ts";
import { fetchClientRoots } from "./fetch-roots.ts";
import { validateClientRoot } from "./validate-root.ts";

function buildFromCreds(creds: {
  confluence_base_url?: string;
  confluence_email?: string;
  confluence_api_token?: string;
}): ConfluenceClient | null {
  if (creds.confluence_base_url && creds.confluence_email && creds.confluence_api_token) {
    return createConfluenceClient(
      creds.confluence_base_url,
      creds.confluence_email,
      creds.confluence_api_token,
    );
  }
  return null;
}

export async function resolveConfluenceClientForCall(
  extra: { sendRequest?: unknown } | undefined,
  workspaceRoot: string | null | undefined,
): Promise<ConfluenceClient | null> {
  // Step 1 — roots/list. Skip any junk URIs (empty, non-absolute,
  // non-existent paths). See validate-root.ts for the rationale.
  const roots = await fetchClientRoots(extra ?? {});
  for (const root of roots) {
    const validation = validateClientRoot(root);
    if ("reason" in validation) continue;
    try {
      const result = await loadCredentialsForWorkspace(validation.path);
      if (result.credentials) {
        const built = buildFromCreds(result.credentials);
        if (built) return built;
      }
    } catch {
      // try next root
    }
  }

  // Step 2 — explicit workspaceRoot arg.
  if (workspaceRoot?.trim()) {
    try {
      const result = await loadCredentialsForWorkspace(resolvePath(workspaceRoot.trim()));
      if (result.credentials) {
        const built = buildFromCreds(result.credentials);
        if (built) return built;
      }
    } catch {
      // fall through
    }
  }

  return null;
}
