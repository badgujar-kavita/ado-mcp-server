/**
 * Resolve an `AdoClient` for an active tool call.
 *
 * Resolution order:
 *   1. MCP `roots/list` (Cursor's open workspace).
 *   2. Explicit `workspaceRoot` arg from the agent.
 *
 * Returns null when neither source produces credentials. The caller
 * (the AdoClient proxy) surfaces a clear "credentials not configured"
 * error pointing the user at `/vortex-ado/ado-connect`.
 *
 * No legacy file fallback. No boot-time client. No cwd-based read.
 * Per-workspace config + OS keychain is the only source of truth.
 */

import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import { AdoClient } from "../ado-client.ts";
import { loadCredentialsForWorkspace } from "../credentials.ts";
import { fetchClientRoots } from "./fetch-roots.ts";

export async function resolveAdoClientForCall(
  extra: { sendRequest?: unknown } | undefined,
  workspaceRoot: string | null | undefined,
): Promise<AdoClient | null> {
  // Step 1 — roots/list (Cursor's open workspace).
  const roots = await fetchClientRoots(extra ?? {});
  for (const root of roots) {
    if (!root.uri.startsWith("file://")) continue;
    try {
      const path = fileURLToPath(root.uri);
      const result = await loadCredentialsForWorkspace(path);
      if (result.credentials) {
        return new AdoClient(
          result.credentials.ado_org,
          result.credentials.ado_project,
          result.credentials.ado_pat,
        );
      }
    } catch {
      // Malformed file URI — try the next root.
    }
  }

  // Step 2 — explicit workspaceRoot arg.
  if (workspaceRoot?.trim()) {
    try {
      const result = await loadCredentialsForWorkspace(resolvePath(workspaceRoot.trim()));
      if (result.credentials) {
        return new AdoClient(
          result.credentials.ado_org,
          result.credentials.ado_project,
          result.credentials.ado_pat,
        );
      }
    } catch {
      // Fall through.
    }
  }

  return null;
}
