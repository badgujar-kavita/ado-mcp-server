/**
 * Per-call ConfluenceClient resolver — same pattern as
 * `resolveAdoClientForCall`, but for Confluence credentials. The boot
 * time confluenceClient is null in the standard Cursor topology
 * (cwd ≠ workspace folder); per-call resolution from roots/list +
 * workspaceRoot fixes that.
 *
 * Returns null when no Confluence credentials can be found via any
 * source — Confluence is optional, so a null return is graceful.
 */

import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import { ConfluenceClient, createConfluenceClient } from "../confluence-client.ts";
import { loadCredentialsForWorkspace, loadCredentials } from "../credentials.ts";
import { fetchClientRoots } from "./fetch-roots.ts";

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
  bootClient: ConfluenceClient | null,
): Promise<ConfluenceClient | null> {
  // Step 1 — roots/list.
  const roots = await fetchClientRoots(extra ?? {});
  for (const root of roots) {
    if (!root.uri.startsWith("file://")) continue;
    try {
      const path = fileURLToPath(root.uri);
      const result = await loadCredentialsForWorkspace(path);
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

  // Step 3 — boot-time client.
  if (bootClient) return bootClient;

  // Step 4 — last-resort retry of cached/legacy load.
  const legacy = loadCredentials();
  if (legacy) {
    const built = buildFromCreds(legacy);
    if (built) return built;
  }

  return null;
}
