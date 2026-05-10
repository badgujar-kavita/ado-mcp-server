/**
 * Errors raised by workspace resolution.
 *
 * The resolver is deliberately strict — it never falls back to process.cwd,
 * $HOME, or directory walking. When it can't resolve, it throws one of these
 * with a code that callers (typically tool handlers) translate into a
 * structured needs-input response for the agent.
 */

export type WorkspaceErrorCode =
  | "UNRESOLVED" // No clientRoots, no explicit arg
  | "NOT_FOUND" // Path doesn't exist on disk
  | "NOT_DIRECTORY" // Path exists but isn't a directory
  | "NOT_WRITABLE"; // Path is a directory but not writable by this process

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: WorkspaceErrorCode, details?: Record<string, unknown>) {
    super(messageFor(code, details));
    this.name = "WorkspaceError";
    this.code = code;
    this.details = details;
  }
}

function messageFor(code: WorkspaceErrorCode, details?: Record<string, unknown>): string {
  switch (code) {
    case "UNRESOLVED":
      return (
        "No workspace could be resolved. Open your project folder in Cursor " +
        "(so MCP can read its workspace root), or pass an absolute `workspace` " +
        "argument explicitly to the tool."
      );
    case "NOT_FOUND":
      return `Workspace path does not exist: ${details?.path ?? "(unknown)"}`;
    case "NOT_DIRECTORY":
      return `Workspace path is not a directory: ${details?.path ?? "(unknown)"}`;
    case "NOT_WRITABLE":
      return `Workspace path is not writable: ${details?.path ?? "(unknown)"}`;
  }
}
