/**
 * Resolve an `AdoClient` for an active tool call using the same workspace
 * resolution rules as `resolveConfigForCall`.
 *
 * Why this exists: `index.ts` constructs a single `AdoClient` at boot from
 * `loadCredentials()`, which reads `process.cwd()/.vortex-ado/config.json`.
 * For MCP processes Cursor spawns via `~/.vortex-ado/bin/bootstrap.mjs`,
 * `cwd` is the installer dir — NOT the user's project folder. When the
 * workspace config lives under the user's project (the supported tenant
 * layout), boot-time resolution falls through to the legacy global
 * `~/.vortex-ado/credentials.json`, which is a placeholder template after
 * the keychain migration. The boot-time `adoClient` is therefore `null`
 * for the common case, and any tool that calls `adoClient.get(...)` blows
 * up with `Cannot read properties of null (reading 'get')`.
 *
 * The fix: tools that hit ADO call this helper at the start of their
 * handler. We use the same precedence as `resolveConfigForCall` (roots/
 * list first, then explicit `workspaceRoot` arg, then legacy fallback),
 * but resolved at call time so the answer reflects the workspace Cursor
 * has open NOW — not whatever cwd the MCP process inherited at launch.
 *
 * Returns the boot-time client when it was non-null AND the per-call
 * resolution found nothing — preserves existing tests + power-user flows
 * that prime credentials via env / cwd. Returns `null` only when neither
 * source produced credentials.
 */

import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import { AdoClient } from "../ado-client.ts";
import { loadCredentialsForWorkspace, loadCredentials } from "../credentials.ts";
import { fetchClientRoots } from "./fetch-roots.ts";

export async function resolveAdoClientForCall(
  extra: { sendRequest?: unknown } | undefined,
  workspaceRoot: string | null | undefined,
  bootClient: AdoClient | null,
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

  // Step 3 — boot-time client (may be null if creds were absent at startup).
  if (bootClient) return bootClient;

  // Step 4 — last-resort retry of cached/legacy load. Useful for tests that
  // bootstrap creds via env without a workspace config.
  const legacy = loadCredentials();
  if (legacy) {
    return new AdoClient(legacy.ado_org, legacy.ado_project, legacy.ado_pat);
  }

  return null;
}
