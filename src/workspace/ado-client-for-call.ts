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

import { resolve as resolvePath } from "node:path";
import { AdoClient } from "../ado-client.ts";
import { loadCredentialsForWorkspace } from "../credentials.ts";
import { fetchClientRoots } from "./fetch-roots.ts";
import {
  validateClientRoot,
  malformedRootsMessage,
  type RejectedRoot,
} from "./validate-root.ts";

export interface ResolvedAdoClient {
  client: AdoClient | null;
  /**
   * Populated when the workspace is configured but reading the
   * credentials failed (e.g. hung keychain), OR when the MCP client
   * sent only malformed workspace roots. Distinct from "no credentials
   * configured" — callers that want to differentiate the "tell user to
   * run /ado-connect" path from the "fix your keychain / Cursor sent
   * junk" path should branch on this.
   */
  error: string | null;
}

export async function resolveAdoClientForCall(
  extra: { sendRequest?: unknown } | undefined,
  workspaceRoot: string | null | undefined,
): Promise<ResolvedAdoClient> {
  // Step 1 — roots/list (Cursor's open workspace).
  const roots = await fetchClientRoots(extra ?? {});
  const rejectedRoots: RejectedRoot[] = [];
  for (const root of roots) {
    const validation = validateClientRoot(root);
    if ("reason" in validation) {
      rejectedRoots.push(validation);
      continue;
    }
    const result = await loadCredentialsForWorkspace(validation.path);
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

  // No usable workspace AND no usable credentials. If roots/list returned
  // ONLY junk URIs, surface that as an explicit error so the user can see
  // their Cursor is misbehaving — instead of the generic "Run /ado-connect"
  // hint, which sends them in a loop because /ado-connect writes to the
  // real folder but every read goes through this path that can't find it.
  if (roots.length > 0 && rejectedRoots.length === roots.length && !workspaceRoot?.trim()) {
    return { client: null, error: malformedRootsMessage(rejectedRoots) };
  }

  return { client: null, error: null };
}
