/**
 * Fetch the client's workspace roots via the MCP `roots/list` request.
 *
 * Why: Cursor (and other MCP clients) expose the open workspace folder
 * through the standard MCP `roots/list` server-to-client request, NOT
 * through `process.cwd()` of the spawned MCP process. We have to ask
 * the client.
 *
 * This helper wraps `extra.sendRequest({ method: "roots/list" }, ...)` with
 * a few defensive layers:
 *
 *   - **Soft failure on unsupported clients.** If the client doesn't
 *     implement roots/list (older Cursor, generic MCP clients, tests),
 *     this returns an empty array rather than throwing. Tool handlers
 *     can then fall back to the explicit `workspaceRoot` argument.
 *   - **Soft failure on transport errors.** Same reason.
 *   - **Optional override hook.** Tests and legacy callers can pass a
 *     pre-resolved `clientRoots` array via the dependency-injected variant
 *     (`fetchClientRootsWithOverride`) without going through the SDK.
 */

import { ListRootsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ClientRoot } from "./resolve.ts";

/**
 * Loose type for the `extra` arg the SDK passes to tool handlers.
 * The SDK's exact RequestHandlerExtra type pins `sendRequest` to a
 * narrow union of server-issued requests; we want roots/list to flow
 * through that channel without fighting the union, so we type-erase
 * via `unknown` and trust the SDK's runtime to route the request.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolHandlerExtra = { sendRequest?: any };

/**
 * Fetch client roots from the MCP client via `roots/list`.
 *
 * Returns `[]` on any failure (unsupported client, transport error,
 * malformed response). Tool handlers should treat empty as "no roots
 * available" and fall back to the explicit `workspaceRoot` argument.
 */
export async function fetchClientRoots(extra: ToolHandlerExtra): Promise<ClientRoot[]> {
  if (!extra?.sendRequest) {
    return [];
  }
  try {
    const result = (await extra.sendRequest(
      { method: "roots/list" },
      ListRootsResultSchema,
    )) as { roots?: ClientRoot[] };
    return result.roots ?? [];
  } catch {
    // Method not found, transport error, schema mismatch, etc. Fall back
    // gracefully — the tool will use whatever explicit arg the caller
    // supplied, or surface a clear error to the user.
    return [];
  }
}
