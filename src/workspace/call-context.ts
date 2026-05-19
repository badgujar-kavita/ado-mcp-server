/**
 * AsyncLocalStorage that captures the per-call MCP context for the
 * lifetime of a single tool handler invocation.
 *
 * Why this exists: there is no boot-time credential loader. The MCP
 * server cannot resolve credentials at startup because `roots/list`
 * (the protocol that exposes the user's open workspace folder)
 * requires an active client connection, which doesn't exist before
 * tool registration. So credentials must be resolved per-tool-call,
 * not at boot.
 *
 * MCP tool handlers receive an `extra` parameter that carries a
 * working `sendRequest` — that's how we issue `roots/list` from inside
 * a handler. We capture `extra` (and any explicit workspaceRoot the
 * agent passed) at handler entry into AsyncLocalStorage, then the
 * lazy `AdoClient` proxy reads it on demand from any code path
 * beneath that handler — even several `await`s deep, even from
 * helpers that don't accept `extra` themselves.
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
