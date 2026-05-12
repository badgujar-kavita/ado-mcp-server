/**
 * Resolve the conventions config for an active tool call.
 *
 * The Phase 1+2 fix established that every tool handler must read the
 * tenant's `<workspace>/.vortex-ado/config.json` rather than relying on
 * `process.cwd()` (which, for MCP processes Cursor spawns, points at the
 * installer dir — not the user's project folder). This helper centralises
 * the "how do I find the right config in a tool handler" pattern so each
 * handler doesn't reinvent it.
 *
 * Resolution order:
 *   1. MCP `roots/list` (preferred). Cursor's open workspace.
 *   2. Explicit `workspaceRoot` arg from the agent — for callers that
 *      want to operate on a specific folder regardless of what Cursor
 *      reports (testing, power-user flows).
 *   3. Last-resort fallback to the cwd-based `loadConventionsConfig()`.
 *      Phase 4 will delete this fallback once every consumer is on
 *      explicit-workspace plumbing.
 */

import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import {
  loadConventionsConfig,
  loadConventionsConfigForWorkspace,
} from "../config.ts";
import { fetchClientRoots } from "./fetch-roots.ts";
import type { ConventionsConfig } from "../types.ts";

export async function resolveConfigForCall(
  extra: { sendRequest?: unknown } | undefined,
  workspaceRoot?: string | null,
): Promise<ConventionsConfig> {
  // Step 1 — roots/list.
  const roots = await fetchClientRoots(extra ?? {});
  for (const root of roots) {
    if (!root.uri.startsWith("file://")) continue;
    try {
      const path = fileURLToPath(root.uri);
      return loadConventionsConfigForWorkspace(path);
    } catch {
      // Malformed file URI or malformed config — try next root.
    }
  }
  // Step 2 — explicit arg.
  if (workspaceRoot?.trim()) {
    try {
      return loadConventionsConfigForWorkspace(resolvePath(workspaceRoot.trim()));
    } catch {
      // Fall through to legacy.
    }
  }
  // Step 3 — legacy.
  return loadConventionsConfig();
}
