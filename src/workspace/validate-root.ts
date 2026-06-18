/**
 * Validator for `roots/list` URIs returned by the MCP client.
 *
 * Why this exists. Cursor (and other MCP clients) sometimes report a
 * workspace root with a URI that converts to an empty / unusable path:
 * `file://`, `file:///` with no body, or a `file://`-prefixed string with
 * trailing junk that `fileURLToPath` doesn't reject. The previous
 * resolver shape was:
 *
 *   const path = fileURLToPath(root.uri);
 *   const result = await loadCredentialsForWorkspace(path);
 *
 * which silently fed `""` to the loader, which then built
 * `join("", ".vortex-ado", "config.json")` = `/.vortex-ado/config.json`,
 * called `existsSync` on a path nobody owns, and returned "no creds."
 * The user saw "Run /ado-connect" — but `/ado-connect` couldn't help
 * because the credentials WERE on disk in the open project folder.
 *
 * This helper rejects junk URIs up-front and returns either a verified
 * absolute, existing directory path, or a structured reason string the
 * caller can surface to the user. Callers should iterate over every
 * root and skip those that come back with a `reason`.
 */

import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientRoot } from "./resolve.ts";

export interface ValidatedRoot {
  /** Absolute, existing, directory path. Safe to feed to readers. */
  path: string;
}

export interface RejectedRoot {
  /** The original URI as Cursor sent it — useful for error reporting. */
  uri: string;
  /** Human-readable reason the URI was rejected. */
  reason: string;
}

/**
 * Validate a single client root. Returns `{path}` on success or
 * `{uri, reason}` on rejection. Never throws — callers can build a
 * structured "all roots are junk" error from the rejection list.
 */
export function validateClientRoot(root: ClientRoot): ValidatedRoot | RejectedRoot {
  if (!root.uri) {
    return { uri: String(root.uri), reason: "empty URI" };
  }
  if (!root.uri.startsWith("file://")) {
    return { uri: root.uri, reason: `non-file URI scheme (got "${root.uri}")` };
  }
  let path: string;
  try {
    path = fileURLToPath(root.uri);
  } catch (err) {
    return {
      uri: root.uri,
      reason: `malformed file URI: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!path) {
    return { uri: root.uri, reason: "URI converts to empty path" };
  }
  if (!isAbsolute(path)) {
    return { uri: root.uri, reason: `URI converts to non-absolute path "${path}"` };
  }
  // Filesystem root ("/" on POSIX, "C:\\" on Windows) is technically
  // absolute and exists, but no user workspace lives there. Treat as
  // junk to avoid `join("/", ".vortex-ado", "config.json")` silently
  // probing `/.vortex-ado/config.json`. This is the actual symptom we
  // hit: Cursor builds with broken roots/list responses sometimes
  // collapse to "/" because `fileURLToPath("file://")` returns "/"
  // instead of throwing.
  const trimmed = path.replace(/[\/\\]+$/, "");
  // POSIX root: "/" → trimmed = "". Windows drive root: "C:\\" → trimmed = "C:".
  if (trimmed.length <= 2) {
    return {
      uri: root.uri,
      reason: `URI converts to filesystem root ("${path}"), which can't host a workspace`,
    };
  }
  if (!existsSync(path)) {
    return { uri: root.uri, reason: `path does not exist on disk: ${path}` };
  }
  let stat;
  try {
    stat = statSync(path);
  } catch (err) {
    return {
      uri: root.uri,
      reason: `cannot stat path ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!stat.isDirectory()) {
    return { uri: root.uri, reason: `path is not a directory: ${path}` };
  }
  return { path };
}

/**
 * Build the "Cursor returned malformed workspace roots" error message
 * for the case where every root in `roots/list` was rejected. The
 * message lists each junk URI and its rejection reason so users can
 * see what their MCP client actually sent.
 */
export function malformedRootsMessage(rejections: RejectedRoot[]): string {
  if (rejections.length === 0) {
    // Caller should never hit this — defensive only.
    return "No workspace roots were reported by the MCP client.";
  }
  const lines = rejections.map((r) => `  - "${r.uri}" → ${r.reason}`);
  return (
    "Cursor (or your MCP client) reported workspace roots that don't resolve to a real folder:\n" +
    lines.join("\n") +
    '\n\nFix: pass `workspaceRoot=/absolute/path/to/your/project` to the tool, or fully quit Cursor (Cmd+Q) and re-open the project folder via File → Open Folder. ' +
    "If this keeps happening, your Cursor build may have a bug in its MCP roots/list response — the explicit workspaceRoot argument is the safe workaround."
  );
}
