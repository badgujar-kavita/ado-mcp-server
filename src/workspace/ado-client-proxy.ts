/**
 * Build a lazy `AdoClient` proxy that resolves a real client on demand
 * from the active call context (see `call-context.ts`).
 *
 * Shape: returns an object that implements every public method of the
 * real `AdoClient` (`get`, `post`, `patch`, `delete`, `getBinary`,
 * `listProjectTags`, `clearProjectTagsCache`) plus the public `baseUrl`
 * field. Each method, on first call, resolves the underlying real
 * client via `resolveAdoClientForCall(extra, workspaceRoot, bootClient)`
 * using the active `CallContext`, caches the resolved client for the
 * remainder of the handler invocation, and forwards the call.
 *
 * Caching strategy: keyed by AsyncLocalStorage's CallContext object
 * identity. A `WeakMap<CallContext, Promise<AdoClient | null>>` ensures
 * we only resolve once per handler invocation — even if the handler
 * makes 50 ADO calls. A different invocation gets its own resolution
 * (different `extra` → different roots/list response → potentially
 * different workspace).
 *
 * `baseUrl` is the one synchronous field on the real AdoClient. We
 * synthesise it from the cached real client when available; otherwise
 * return a placeholder that signals "not yet resolved" without
 * crashing logging code that touches `client.baseUrl`.
 */

import type { AdoClient as RealAdoClient, BinaryResponse } from "../ado-client.ts";
import { getCallContext } from "./call-context.ts";
import { resolveAdoClientForCall } from "./ado-client-for-call.ts";

const cache = new WeakMap<object, Promise<RealAdoClient | null>>();

/**
 * Resolve the real client for the active call context (or return null
 * when no resolution succeeds). Throws when called outside a handler
 * scope — that indicates programmer error.
 */
async function resolveForActiveContext(
  bootClient: RealAdoClient | null,
): Promise<RealAdoClient> {
  const ctx = getCallContext();
  if (!ctx) {
    // Outside a handler — shouldn't happen in production. Tests that
    // bypass the handler instrumentation should pass a real `AdoClient`
    // directly, not the proxy.
    if (bootClient) return bootClient;
    throw new Error(
      "AdoClient proxy: no active call context AND no boot-time client. " +
        "This indicates a tool method was invoked outside the handler-instrumentation " +
        "scope (runWithCallContext). Verify the tool call goes through the registered handler.",
    );
  }
  let pending = cache.get(ctx);
  if (!pending) {
    pending = resolveAdoClientForCall(ctx.extra, ctx.workspaceRoot, bootClient);
    cache.set(ctx, pending);
  }
  const resolved = await pending;
  if (!resolved) {
    throw new Error(
      "AdoClient proxy: could not resolve credentials for this workspace. " +
        "Run /vortex-ado/ado-connect to set up <workspace>/.vortex-ado/config.json " +
        "and store your PAT in the OS keychain. /ado-check will tell you exactly which " +
        "step is missing.",
    );
  }
  return resolved;
}

/**
 * Public type for the proxy. Structurally identical to `AdoClient` so it
 * drops into existing call sites without `as any`.
 */
export type AdoClientProxy = RealAdoClient;

export function createAdoClientProxy(
  bootClient: RealAdoClient | null,
): AdoClientProxy {
  // We expose the same methods + baseUrl getter that `AdoClient` exposes.
  // Each method awaits the resolved real client for THIS call context,
  // then forwards verbatim. `baseUrl` synthesises a best-effort string
  // — when no client has been resolved yet for the active context, we
  // return a placeholder; in practice baseUrl is read from logs/error
  // messages AFTER a real call has been made, by which point the cache
  // is populated.
  const proxy = {
    get baseUrl(): string {
      const ctx = getCallContext();
      if (ctx) {
        const cached = cache.get(ctx);
        if (cached) {
          // Best-effort sync read: if the resolution promise is already
          // settled, expose the URL. Otherwise fall back.
          // (This is for log lines that read client.baseUrl right after
          // an awaited call — by that point the cache holds a settled
          // value and we can reach into it via the real client.)
          // We can't await here, so we keep this best-effort.
          let resolved: RealAdoClient | null = null;
          cached.then((c) => { resolved = c; }).catch(() => {});
          if (resolved) return (resolved as RealAdoClient).baseUrl;
        }
      }
      if (bootClient) return bootClient.baseUrl;
      return "https://ado-client-not-yet-resolved.invalid";
    },
    async get<T>(
      path: string,
      apiVersion?: string,
      queryParams?: Record<string, string>,
    ): Promise<T> {
      const real = await resolveForActiveContext(bootClient);
      return real.get<T>(path, apiVersion, queryParams);
    },
    async getBinary(
      path: string,
      apiVersion?: string,
      queryParams?: Record<string, string>,
    ): Promise<BinaryResponse> {
      const real = await resolveForActiveContext(bootClient);
      return real.getBinary(path, apiVersion, queryParams);
    },
    async post<T>(
      path: string,
      body: unknown,
      contentType?: string,
      apiVersion?: string,
    ): Promise<T> {
      const real = await resolveForActiveContext(bootClient);
      return real.post<T>(path, body, contentType, apiVersion);
    },
    async patch<T>(
      path: string,
      body: unknown,
      contentType?: string,
      apiVersion?: string,
    ): Promise<T> {
      const real = await resolveForActiveContext(bootClient);
      return real.patch<T>(path, body, contentType, apiVersion);
    },
    async delete<T>(
      path: string,
      apiVersion?: string,
      queryParams?: Record<string, string>,
    ): Promise<T> {
      const real = await resolveForActiveContext(bootClient);
      return real.delete<T>(path, apiVersion, queryParams);
    },
    async listProjectTags(): Promise<string[]> {
      const real = await resolveForActiveContext(bootClient);
      return real.listProjectTags();
    },
    clearProjectTagsCache(): void {
      // Sync method — only forward when we already have a cached client.
      // If not, there's nothing to clear (no fetch has happened).
      const ctx = getCallContext();
      if (!ctx) {
        if (bootClient) bootClient.clearProjectTagsCache();
        return;
      }
      const cached = cache.get(ctx);
      if (!cached) return;
      cached.then((real) => real?.clearProjectTagsCache()).catch(() => {});
    },
  };

  // Cast to RealAdoClient — we've structurally implemented every public
  // surface point. The runtime shape is correct; TypeScript needs the
  // assertion because `AdoClient` is a class and our object isn't an
  // instanceof it.
  return proxy as unknown as RealAdoClient;
}
