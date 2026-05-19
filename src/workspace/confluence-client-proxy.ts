/**
 * Lazy ConfluenceClient proxy. Mirrors `ado-client-proxy.ts`:
 *
 *   - Per-call resolution from the active CallContext (roots/list →
 *     workspaceRoot → bootClient → legacy).
 *   - WeakMap cache keyed by CallContext so multiple calls in one
 *     handler resolve once.
 *   - Synchronous mirror cache for `baseUrl` reads.
 *
 * Differences from the AdoClient proxy:
 *
 *   - `null` is a legitimate resolved value. Confluence is optional —
 *     when no creds are found anywhere, the proxy returns null (not a
 *     proxy that throws on call). This preserves the existing
 *     "if (confluenceClient)" guards in tools/work-items.ts and
 *     helpers/confluence-attachments.ts.
 *   - The proxy is exposed as a function `resolveConfluenceClient()`
 *     that callers `await` to get a real `ConfluenceClient | null`,
 *     rather than being a structurally-typed sync surface. Reason:
 *     ConfluenceClient is consumed by helpers that already use it
 *     async-only — there's no synchronous read pattern to preserve
 *     (unlike AdoClient.baseUrl).
 */

import type { ConfluenceClient } from "../confluence-client.ts";
import { getCallContext } from "./call-context.ts";
import { resolveConfluenceClientForCall } from "./confluence-client-for-call.ts";

const cache = new WeakMap<object, Promise<ConfluenceClient | null>>();

/**
 * Resolve a ConfluenceClient for the active call context. Caches the
 * result in a WeakMap so multiple calls in one handler share a single
 * resolution.
 *
 * Returns null when:
 *   - no active CallContext (called outside a handler), AND no boot client
 *   - workspace + workspaceRoot + boot + legacy all yielded no creds
 *
 * Tools should treat null as "Confluence not configured" — same as the
 * boot-time null they handled before.
 */
export async function resolveConfluenceClientForActiveCall(
  bootClient: ConfluenceClient | null,
): Promise<ConfluenceClient | null> {
  const ctx = getCallContext();
  if (!ctx) {
    // Outside a handler — fall back to boot.
    return bootClient;
  }
  let pending = cache.get(ctx);
  if (!pending) {
    pending = resolveConfluenceClientForCall(ctx.extra, ctx.workspaceRoot, bootClient);
    cache.set(ctx, pending);
  }
  return pending;
}
