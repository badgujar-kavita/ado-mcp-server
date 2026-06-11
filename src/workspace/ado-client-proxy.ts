/**
 * Build a lazy `AdoClient` proxy that resolves a real client on demand
 * from the active call context (see `call-context.ts`).
 *
 * Shape: returns an object that implements every public method of the
 * real `AdoClient` (`get`, `post`, `patch`, `delete`, `getBinary`,
 * `listProjectTags`, `clearProjectTagsCache`) plus the public `baseUrl`
 * field. Each method, on first call, resolves the underlying real
 * client via `resolveAdoClientForCall(extra, workspaceRoot)` using the
 * active `CallContext`, caches the resolved client for the remainder
 * of the handler invocation, and forwards the call.
 *
 * Caching strategy: keyed by AsyncLocalStorage's CallContext object
 * identity. A `WeakMap<CallContext, Promise<AdoClient | null>>` ensures
 * we only resolve once per handler invocation — even if the handler
 * makes 50 ADO calls. A different invocation gets its own resolution.
 *
 * `baseUrl` is the one synchronous field on the real AdoClient. We
 * synthesise it from a synchronous mirror cache populated when the
 * resolution promise settles. The handler instrumentation pre-warms
 * the proxy BEFORE the handler body runs, so URL builders that read
 * `proxy.baseUrl` synchronously see the real URL. When no resolution
 * is possible, baseUrl returns a placeholder so logging code that
 * reads it doesn't crash.
 *
 * Throws (on every method) when the active context can't resolve to a
 * real client — surfaces a clear "credentials not configured" message
 * pointing the user at /vortex-ado/ado-connect.
 */

import type { AdoClient as RealAdoClient, BinaryResponse } from "../ado-client.ts";
import { getCallContext } from "./call-context.ts";
import { resolveAdoClientForCall, type ResolvedAdoClient } from "./ado-client-for-call.ts";

const cache = new WeakMap<object, Promise<ResolvedAdoClient>>();
// Synchronous mirror of `cache` populated when a resolution promise
// settles. Used by the synchronous `baseUrl` getter (which can't await).
const settledCache = new WeakMap<object, RealAdoClient>();

async function resolveForActiveContext(): Promise<RealAdoClient> {
  const ctx = getCallContext();
  if (!ctx) {
    throw new Error(
      "AdoClient proxy: no active call context. " +
        "This indicates a tool method was invoked outside the handler-instrumentation " +
        "scope (runWithCallContext). Verify the tool call goes through the registered handler.",
    );
  }
  let pending = cache.get(ctx);
  if (!pending) {
    pending = resolveAdoClientForCall(ctx.extra, ctx.workspaceRoot).then(
      (resolved) => {
        // Mirror into the synchronous cache as soon as the promise settles
        // so `baseUrl` (sync getter) can read the real URL on subsequent
        // accesses without an extra await.
        if (resolved.client) settledCache.set(ctx, resolved.client);
        return resolved;
      },
    );
    cache.set(ctx, pending);
  }
  const resolved = await pending;
  if (!resolved.client) {
    // Distinguish "not configured" (no error) from "configured but the
    // read failed" (error populated). The latter is most often a hung
    // macOS keychain prompt or a malformed config — sending the user to
    // /ado-connect would just have them re-encounter the same problem.
    if (resolved.error) {
      throw new Error(`AdoClient proxy: ${resolved.error}`);
    }
    throw new Error(
      "AdoClient proxy: could not resolve credentials for this workspace. " +
        "Run /vortex-ado/ado-connect to set up <workspace>/.vortex-ado/config.json " +
        "and store your PAT in the OS keychain. /ado-check will tell you exactly which " +
        "step is missing.",
    );
  }
  return resolved.client;
}

/**
 * Pre-warm the per-context client resolution. Called by the handler
 * instrumentation BEFORE the handler runs so that synchronous reads of
 * `proxy.baseUrl` (e.g. from `adoWorkItemUrl(client, id)` URL builders)
 * see the real org/project URL instead of the not-yet-resolved
 * placeholder. Failures are swallowed — the handler will hit the same
 * resolution path on its first method call and surface the error there.
 */
export async function prewarmAdoClientProxy(): Promise<void> {
  try {
    await resolveForActiveContext();
  } catch {
    // Swallow — handler will surface the error on first real call.
  }
}

/**
 * Public type for the proxy. Structurally identical to `AdoClient` so it
 * drops into existing call sites without `as any`.
 */
export type AdoClientProxy = RealAdoClient;

export function createAdoClientProxy(): AdoClientProxy {
  const proxy = {
    get baseUrl(): string {
      const ctx = getCallContext();
      if (ctx) {
        const settled = settledCache.get(ctx);
        if (settled) return settled.baseUrl;
      }
      return "https://ado-client-not-yet-resolved.invalid";
    },
    async get<T>(
      path: string,
      apiVersion?: string,
      queryParams?: Record<string, string>,
    ): Promise<T> {
      const real = await resolveForActiveContext();
      return real.get<T>(path, apiVersion, queryParams);
    },
    async getBinary(
      path: string,
      apiVersion?: string,
      queryParams?: Record<string, string>,
    ): Promise<BinaryResponse> {
      const real = await resolveForActiveContext();
      return real.getBinary(path, apiVersion, queryParams);
    },
    async post<T>(
      path: string,
      body: unknown,
      contentType?: string,
      apiVersion?: string,
    ): Promise<T> {
      const real = await resolveForActiveContext();
      return real.post<T>(path, body, contentType, apiVersion);
    },
    async patch<T>(
      path: string,
      body: unknown,
      contentType?: string,
      apiVersion?: string,
    ): Promise<T> {
      const real = await resolveForActiveContext();
      return real.patch<T>(path, body, contentType, apiVersion);
    },
    async delete<T>(
      path: string,
      apiVersion?: string,
      queryParams?: Record<string, string>,
    ): Promise<T> {
      const real = await resolveForActiveContext();
      return real.delete<T>(path, apiVersion, queryParams);
    },
    async listProjectTags(): Promise<string[]> {
      const real = await resolveForActiveContext();
      return real.listProjectTags();
    },
    clearProjectTagsCache(): void {
      // Sync method — only forward when we already have a settled client
      // for the active context. No active context means no work to do.
      const ctx = getCallContext();
      if (!ctx) return;
      const settled = settledCache.get(ctx);
      if (settled) settled.clearProjectTagsCache();
    },
  };

  // Cast to RealAdoClient — we've structurally implemented every public
  // surface point. The runtime shape is correct; TypeScript needs the
  // assertion because `AdoClient` is a class and our object isn't an
  // instanceof it.
  return proxy as unknown as RealAdoClient;
}
