/**
 * Per-workspace conventions config loader.
 *
 * Phase 4 final shape — no legacy fallbacks. The server reads:
 *
 *   1. `<workspace>/.vortex-ado/config.json` (the workspace overlay, written
 *      by `/ado-connect` Tab 2). Merged on top of framework defaults.
 *   2. Framework defaults (`src/config/defaults.ts`) when no workspace
 *      config is found.
 *
 * Two entry points:
 *
 *   - `loadConventionsConfigForWorkspace(workspaceRoot)` — preferred. Takes
 *     the workspace path explicitly. No module cache. Safe to call from
 *     any tool handler that resolved its workspace via `roots/list`.
 *   - `loadConventionsConfig()` — legacy, cwd-based. Module-cached. The
 *     only remaining caller pattern is the optional-arg fallback in
 *     helpers (`config: ConventionsConfig = loadConventionsConfig()`).
 *     The cwd path can be wrong for MCP processes Cursor spawns (cwd is
 *     `~/.vortex-ado/` — the installer dir, not the user's project), so
 *     this is best-effort. Tool handlers should call
 *     `resolveConfigForCall()` instead.
 *
 * The legacy `~/.vortex-ado/conventions.config.json` and bundled
 * `conventions.config.json` fallbacks were removed in Phase 4. If those
 * files exist on a user's machine they are ignored; users can delete
 * them safely.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ConventionsConfig } from "./types.ts";
import { mergeConfig } from "./config/merge.ts";
import { WorkspaceConfigSchema, type WorkspaceConfig } from "./config/schema.ts";

/** Module cache for `loadConventionsConfig()`'s cwd-based path. */
let _config: ConventionsConfig | null = null;
let _configSource: string | null = null;

/**
 * Path of the per-workspace config file, computed from process.cwd().
 * Each Cursor window's MCP process has its own cwd, so this returns the
 * right per-workspace path automatically — when cwd is the workspace.
 * For MCP processes spawned by Cursor (cwd = `~/.vortex-ado/`), this
 * resolves to a non-existent file and the loader falls back to
 * framework defaults.
 */
function workspaceConfigPath(): string {
  return join(process.cwd(), ".vortex-ado", "config.json");
}

/**
 * Load the conventions config for the current cwd.
 *
 * Resolution order:
 *   1. `<cwd>/.vortex-ado/config.json` (when cwd is the user's workspace).
 *   2. Framework defaults (no overlay).
 *
 * Module-cached — first call wins; tests use `__resetConventionsCacheForTests`.
 *
 * Most callers should use `loadConventionsConfigForWorkspace(root)` or
 * `resolveConfigForCall(extra, workspaceRoot)` instead — those don't
 * depend on `process.cwd()` being correct.
 */
export function loadConventionsConfig(): ConventionsConfig {
  if (_config) return _config;

  const wsPath = workspaceConfigPath();
  if (existsSync(wsPath)) {
    try {
      const raw = JSON.parse(readFileSync(wsPath, "utf-8"));
      const workspace = WorkspaceConfigSchema.parse(raw) as WorkspaceConfig;
      _config = mergeConfig(workspace);
      _configSource = wsPath;
      return _config;
    } catch (err) {
      throw new Error(
        `Failed to parse workspace config at ${wsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  _config = mergeConfig({ version: 1 });
  _configSource = "(framework defaults only)";
  return _config;
}

/** Test seam — reset cache so tests can change cwd and reload. */
export function __resetConventionsCacheForTests(): void {
  _config = null;
  _configSource = null;
}

/**
 * Load conventions for an EXPLICIT workspace path.
 *
 * Unlike `loadConventionsConfig()`, this:
 *   - Takes the workspace root as an argument — no `process.cwd()` lookup.
 *   - Has NO module-level cache — safe to call from any tool handler that
 *     received its workspace via `roots/list`. Two Cursor windows on two
 *     different projects can call this from the same MCP process and get
 *     different configs without interference.
 *   - Reads ONLY `<workspaceRoot>/.vortex-ado/config.json`. No legacy or
 *     bundled fallbacks. If the file is absent, returns the merged
 *     framework defaults (an empty workspace overlay).
 *   - Throws on malformed `config.json` rather than silently masking the
 *     error — surface real bugs to the user.
 */
export function loadConventionsConfigForWorkspace(
  workspaceRoot: string,
): ConventionsConfig {
  const wsConfigPath = join(workspaceRoot, ".vortex-ado", "config.json");
  if (!existsSync(wsConfigPath)) {
    return mergeConfig({ version: 1 });
  }
  const raw = JSON.parse(readFileSync(wsConfigPath, "utf-8"));
  const workspace = WorkspaceConfigSchema.parse(raw) as WorkspaceConfig;
  return mergeConfig(workspace);
}

/** Diagnostic — what file (if any) was the loaded config read from? */
export function getConventionsConfigSource(): string | null {
  if (!_config) loadConventionsConfig();
  return _configSource;
}
