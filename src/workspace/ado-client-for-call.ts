/**
 * Resolve an `AdoClient` for an active tool call.
 *
 * Resolution order:
 *   1. MCP `roots/list` (Cursor's open workspace).
 *   2. Explicit `workspaceRoot` arg from the agent.
 *
 * Returns `{ client, error }`:
 *   - `client` is the resolved AdoClient or null.
 *   - `error` is null when the workspace is genuinely unconfigured (so
 *     the proxy emits the "Run /ado-connect" hint), or a human-readable
 *     message when the workspace IS configured but reading credentials
 *     failed (typically a hung macOS keychain prompt). The proxy
 *     surfaces the error verbatim so the user doesn't get the
 *     misleading "credentials not configured" message for a workspace
 *     that already has them.
 *
 * No legacy file fallback. No boot-time client. No cwd-based read.
 * Per-workspace config + OS keychain is the only source of truth.
 */

import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import { AdoClient } from "../ado-client.ts";
import { loadCredentialsForWorkspace } from "../credentials.ts";
import { fetchClientRoots } from "./fetch-roots.ts";

export interface ResolvedAdoClient {
  client: AdoClient | null;
  /**
   * Populated when the workspace is configured but reading the
   * credentials failed (e.g. hung keychain). Distinct from "no
   * credentials configured" — callers that want to differentiate the
   * "tell user to run /ado-connect" path from the "tell user to fix
   * their keychain" path should branch on this.
   */
  error: string | null;
}

export async function resolveAdoClientForCall(
  extra: { sendRequest?: unknown } | undefined,
  workspaceRoot: string | null | undefined,
): Promise<ResolvedAdoClient> {
  // Step 1 — roots/list (Cursor's open workspace).
  const roots = await fetchClientRoots(extra ?? {});
  for (const root of roots) {
    if (!root.uri.startsWith("file://")) continue;
    let path: string;
    try {
      path = fileURLToPath(root.uri);
    } catch {
      // Malformed file URI — try the next root.
      continue;
    }
    const result = await loadCredentialsForWorkspace(path);
    if (result.credentials) {
      return {
        client: new AdoClient(
          result.credentials.ado_org,
          result.credentials.ado_project,
          result.credentials.ado_pat,
        ),
        error: null,
      };
    }
    if (result.error) {
      // Configured workspace, read failed — surface the error rather
      // than falling through to "no credentials configured."
      return { client: null, error: result.error };
    }
  }

  // Step 2 — explicit workspaceRoot arg.
  if (workspaceRoot?.trim()) {
    const result = await loadCredentialsForWorkspace(resolvePath(workspaceRoot.trim()));
    if (result.credentials) {
      return {
        client: new AdoClient(
          result.credentials.ado_org,
          result.credentials.ado_project,
          result.credentials.ado_pat,
        ),
        error: null,
      };
    }
    if (result.error) {
      return { client: null, error: result.error };
    }
  }

  return { client: null, error: null };
}
