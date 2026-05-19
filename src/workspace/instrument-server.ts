/**
 * Wrap `server.registerTool` so every tool handler runs inside a
 * `runWithCallContext` scope. The wrapper captures the `extra` arg the
 * MCP SDK passes (which carries `sendRequest` for `roots/list` calls)
 * and any `workspaceRoot` field the agent passed in `args`. Every ADO
 * call below the handler — even several `await`s deep, even from
 * helpers that don't accept `extra` — can then read those via
 * `getCallContext()` and resolve real credentials on demand.
 *
 * Why monkey-patch instead of edit each `registerTool` call site:
 *
 *   - Zero churn in `tools/*.ts`. None of the dozens of existing
 *     handlers need a one-line change.
 *   - Tests stub the server with their own `registerTool` shim — they
 *     don't go through the instrumentation, and that's fine: tests pass
 *     real `AdoClient` instances directly, not the proxy.
 *   - The instrumentation point matches the existing layering: the SDK
 *     server is the boundary between "MCP transport" and "our tools",
 *     so wrapping it is semantically the right place to inject context.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoClient } from "../ado-client.ts";
import { runWithCallContext } from "./call-context.ts";
import { prewarmAdoClientProxy } from "./ado-client-proxy.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

/**
 * Wrap `server.registerTool` so every handler runs inside a CallContext
 * scope AND the AdoClient proxy's per-context cache is pre-warmed
 * BEFORE the handler body executes. Pre-warming matters for synchronous
 * reads of `client.baseUrl` (used by URL builders like `adoWorkItemUrl`)
 * — without it, those reads fire before any awaited call and see the
 * not-yet-resolved placeholder.
 */
export function instrumentServerWithCallContext(
  server: McpServer,
  bootClient: AdoClient | null,
): void {
  const original = server.registerTool.bind(server) as AnyFn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).registerTool = (name: string, config: unknown, handler: AnyFn) => {
    const wrapped = async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extra: any,
    ) =>
      runWithCallContext(
        {
          extra,
          workspaceRoot: typeof args?.workspaceRoot === "string" ? args.workspaceRoot : null,
        },
        async () => {
          await prewarmAdoClientProxy(bootClient);
          return handler(args, extra);
        },
      );
    return original(name, config, wrapped);
  };
}
