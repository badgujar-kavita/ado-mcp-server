/**
 * Lazy ConfluenceClient resolver. Mirrors `ado-client-proxy.ts`:
 *
 *   - Per-call resolution from the active CallContext (roots/list →
 *     workspaceRoot).
 *   - WeakMap cache keyed by CallContext so multiple calls in one
 *     handler resolve once.
 *
 * Differences from the AdoClient proxy:
 *
 *   - `null` is a legitimate resolved value. Confluence is optional —
 *     when no creds are found anywhere, the proxy returns null (not
 *     throws). This preserves the existing "if (confluenceClient)"
 *     guards in tools/work-items.ts and helpers/confluence-attachments.ts.
 *   - Exposed as `resolveConfluenceClientForActiveCall()` that callers
 *     `await` to get a real `ConfluenceClient | null`, rather than as a
 *     structurally-typed sync surface. ConfluenceClient is consumed
 *     async-only; there's no synchronous read pattern to preserve
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
 *   - no active CallContext (called outside a handler), OR
 *   - the workspace config doesn't have Confluence enabled, OR
 *   - the keychain has no Confluence token for the configured org/project.
 *
 * Tools should treat null as "Confluence not configured" — same null
 * value they used to receive from the boot-time client.
 */
export async function resolveConfluenceClientForActiveCall(): Promise<ConfluenceClient | null> {
  const ctx = getCallContext();
  if (!ctx) return null;
  let pending = cache.get(ctx);
  if (!pending) {
    pending = resolveConfluenceClientForCall(ctx.extra, ctx.workspaceRoot);
    cache.set(ctx, pending);
  }
  return pending;
}
