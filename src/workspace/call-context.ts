/**
 * AsyncLocalStorage that captures the per-call MCP context for the
 * lifetime of a single tool handler invocation.
 *
 * Why this exists: `bootstrapCredentials()` runs once at server startup,
 * BEFORE any client connection — so the workspace's roots/list response
 * isn't reachable from there. Boot-time credential resolution is therefore
 * stuck reading `process.cwd()`, which Cursor sets to `$HOME` for MCPs
 * launched from the global `~/.cursor/mcp.json`. That's the wrong folder.
 * The boot-time `adoClient` ends up null in the standard deployment
 * topology, and every tool that touches ADO blows up with
 * `Cannot read properties of null (reading 'get')`.
 *
 * The right architecture: defer credential resolution to FIRST tool call.
 * MCP tool handlers receive an `extra` parameter that carries a working
 * `sendRequest` — that's how we can issue `roots/list` from inside a
 * handler. We capture `extra` (and any explicit workspaceRoot the agent
 * passed) at handler entry into AsyncLocalStorage, then the lazy
 * `AdoClient` proxy reads it on demand from any code path beneath that
 * handler — even several `await`s deep, even from helpers that don't
 * accept `extra` themselves.
 *
 * This is a one-instrumentation-point fix. Every existing call site in
 * tools/* keeps using `client.get(...)` exactly as before; the proxy
 * resolves a real client transparently.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface CallContext {
  extra: { sendRequest?: unknown } | undefined;
  workspaceRoot?: string | null | undefined;
}

const storage = new AsyncLocalStorage<CallContext>();

/**
 * Run `fn` inside an active call context. Anything `fn` does (and any
 * async work it spawns) can read the context via `getCallContext()`.
 */
export function runWithCallContext<T>(ctx: CallContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Read the active call context. Returns `undefined` when called outside
 * a `runWithCallContext` scope (e.g. at server boot, or from a test that
 * didn't set one up). Callers MUST treat `undefined` as "no roots/list
 * available" and fall back to other resolution paths.
 */
export function getCallContext(): CallContext | undefined {
  return storage.getStore();
}
