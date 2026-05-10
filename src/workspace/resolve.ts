/**
 * Resolve the current workspace per tool call.
 *
 * Resolution order (matches Jira MCP's pattern, intentionally strict):
 *   1. MCP roots/list (primary) — must be passed in by the caller as
 *      `clientRoots` after the tool handler has fetched them.
 *   2. Explicit `workspace` argument provided by the agent at tool-call time.
 *   3. Hard fail with WorkspaceError("UNRESOLVED").
 *
 * Deliberate non-behaviors:
 *   - NEVER falls back to process.cwd, $HOME, $PWD, or any cached default.
 *   - NEVER searches parent directories for a marker file.
 *
 * Why so strict? Two projects open in two Cursor windows must be ABSOLUTELY
 * isolated. The slightest fallback risks the wrong window grabbing the wrong
 * workspace and silently mutating the wrong project's files.
 */

import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceError } from "./errors.ts";

export interface ClientRoot {
  /** Typically "file:///absolute/path"; the MCP roots/list contract. */
  uri: string;
  name?: string;
}

export interface ResolveWorkspaceOptions {
  /**
   * Roots returned by the MCP client's roots/list. The first valid file://
   * URI wins. Cursor typically supplies one root pointing at the open
   * workspace folder; multi-root workspaces would expose multiples here.
   */
  clientRoots?: ClientRoot[];
  /**
   * Explicit absolute path passed by the agent. Used when a tool wants to
   * operate on a workspace OTHER than the one Cursor has open (rare —
   * mostly for testing and power-user flows).
   */
  explicit?: string;
}

/**
 * Resolve the workspace path. Throws WorkspaceError on any failure.
 *
 * The returned path is absolute, exists, is a directory, and is writable.
 */
export function resolveWorkspace(opts: ResolveWorkspaceOptions): string {
  // Step 1: client roots — preferred path.
  if (opts.clientRoots && opts.clientRoots.length > 0) {
    for (const root of opts.clientRoots) {
      if (root.uri.startsWith("file://")) {
        try {
          const path = fileURLToPath(root.uri);
          return validateWorkspacePath(path);
        } catch {
          // Malformed file URI; try next root.
        }
      }
    }
  }

  // Step 2: explicit arg.
  if (opts.explicit !== undefined) {
    if (!isAbsolute(opts.explicit)) {
      throw new WorkspaceError("NOT_FOUND", {
        reason: "workspace argument must be an absolute path",
        provided: opts.explicit,
      });
    }
    return validateWorkspacePath(resolvePath(opts.explicit));
  }

  // Step 3: hard fail.
  throw new WorkspaceError("UNRESOLVED");
}

/**
 * Stat the path and verify it's a writable directory. Throws on any
 * mismatch with a code that surfaces a clear error to the caller.
 */
function validateWorkspacePath(path: string): string {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new WorkspaceError("NOT_FOUND", { path });
  }
  if (!stat.isDirectory()) {
    throw new WorkspaceError("NOT_DIRECTORY", { path });
  }
  try {
    accessSync(path, constants.W_OK);
  } catch {
    throw new WorkspaceError("NOT_WRITABLE", { path });
  }
  return path;
}
