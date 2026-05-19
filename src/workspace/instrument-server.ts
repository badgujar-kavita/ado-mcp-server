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
import { runWithCallContext } from "./call-context.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

export function instrumentServerWithCallContext(server: McpServer): void {
  const original = server.registerTool.bind(server) as AnyFn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).registerTool = (name: string, config: unknown, handler: AnyFn) => {
    const wrapped = (
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
        () => handler(args, extra),
      );
    return original(name, config, wrapped);
  };
}
