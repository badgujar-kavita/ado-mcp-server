/**
 * Shared utilities for generating reliable file URLs and markdown links.
 *
 * Uses Node's `pathToFileURL` to avoid broken links caused by spaces,
 * `#`, `%`, parentheses, or other special characters in workspace paths.
 */

import { pathToFileURL } from "url";
import { resolve, relative, dirname, basename } from "path";
import { existsSync } from "fs";

/** Structured file reference returned by MCP tool responses. */
export interface FileReference {
  fileName: string;
  absolutePath: string;
  workspaceRelativePath: string;
  fileUrl: string;
}

/**
 * Convert an absolute file-system path to a `file:///` URL.
 * Always use this instead of string concatenation.
 */
export function toFileUrl(absolutePath: string): string {
  return pathToFileURL(resolve(absolutePath)).href;
}

/**
 * Build a complete {@link FileReference} for an on-disk file.
 *
 * @param absolutePath  Fully resolved path to the file.
 * @param workspaceRoot Optional workspace root; when provided the response
 *                      includes a workspace-relative path for display.
 */
export function buildFileReference(
  absolutePath: string,
  workspaceRoot?: string | null,
): FileReference {
  const resolved = resolve(absolutePath);
  const wsRelative = workspaceRoot
    ? relative(resolve(workspaceRoot), resolved)
    : resolved;

  return {
    fileName: basename(resolved),
    absolutePath: resolved,
    workspaceRelativePath: wsRelative,
    fileUrl: toFileUrl(resolved),
  };
}

/**
 * Generate a markdown relative link between two sibling/child files.
 * Returns `null` if the target does not exist on disk so callers can
 * omit the link rather than emit a broken one.
 *
 * @param fromFilePath  The file that will contain the link.
 * @param targetPath    Absolute path of the link target.
 * @param label         Display text for the markdown link.
 */
export function safeRelativeMarkdownLink(
  fromFilePath: string,
  targetPath: string,
  label: string,
): string | null {
  const resolvedTarget = resolve(targetPath);
  if (!existsSync(resolvedTarget)) return null;

  const rel = relative(dirname(resolve(fromFilePath)), resolvedTarget);
  const normalized = rel.startsWith(".") ? rel : `./${rel}`;
  return `[${label}](${normalized})`;
}

/**
 * Format the MCP tool response text for a saved file, embedding all
 * link variants so at least one is clickable in any Cursor version.
 */
export function formatSavedFileResponse(ref: FileReference, extras?: string): string {
  const lines = [
    `**File:** [${ref.fileName}](${ref.fileUrl})`,
    `**Path:** ${ref.absolutePath}`,
  ];
  if (extras) lines.push(extras);
  return lines.join("\n");
}

/**
 * Log file-link details to stderr at save time for debugging.
 */
export function logFileLink(context: string, ref: FileReference, relativeTargets?: string[]): void {
  const info = [
    `[file-links] ${context}`,
    `  absolutePath : ${ref.absolutePath}`,
    `  fileUrl      : ${ref.fileUrl}`,
    `  wsRelative   : ${ref.workspaceRelativePath}`,
  ];
  if (relativeTargets?.length) {
    info.push(`  relTargets   : ${relativeTargets.join(", ")}`);
  }
  console.error(info.join("\n"));
}
