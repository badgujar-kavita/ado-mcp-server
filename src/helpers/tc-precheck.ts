import { AdoClient, AdoClientError } from "../ado-client.ts";
import type { AdoWorkItem } from "../types.ts";

export interface TcPrecheckRecord {
  id: number;
  type: string;
  title: string;
  parentUsId: number | null;
}

export interface TcPrecheckBlock {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
}

export interface TcPrecheckResult {
  ok: boolean;
  prechecks: TcPrecheckRecord[];
  block?: TcPrecheckBlock;
}

export interface TcPrecheckOptions {
  ids: number[];
  acknowledgeCrossUs?: boolean;
  /** Verb shown in the structured response messages (e.g. "update", "comment", "attachment-copy"). */
  operation: string;
}

/**
 * Shared precheck used by `qa_tc_update`, `qa_tc_comment_add`, and
 * `qa_tc_attachments_copy`:
 *   1. Fetch each ID with `$expand=relations`.
 *   2. Refuse non-Test-Case work items (typeRefusals).
 *   3. Surface fetch failures (404/401/403/etc.) as fetchFailures.
 *   4. If bulk and TCs span multiple parent USs and `acknowledgeCrossUs` is
 *      not set, return a `needs-confirmation` block.
 *
 * On any blocking condition, returns `{ ok: false, block }` with a fully-built
 * MCP response the caller returns verbatim. On success returns the per-ID
 * `prechecks[]` (each carrying `parentUsId`) so the caller can drive the
 * mutation step without re-fetching.
 */
export async function runTcPrecheck(
  client: AdoClient,
  opts: TcPrecheckOptions
): Promise<TcPrecheckResult> {
  const { ids, acknowledgeCrossUs, operation } = opts;
  const isBulk = ids.length > 1;

  const prechecks: TcPrecheckRecord[] = [];
  const typeRefusals: Array<{ id: number; type: string; title: string }> = [];
  const fetchFailures: Array<{ id: number; reason: string }> = [];

  for (const id of ids) {
    try {
      const wi = await client.get<AdoWorkItem>(
        `/_apis/wit/workitems/${id}`,
        "7.0",
        { "$expand": "relations" }
      );
      const type = (wi.fields?.["System.WorkItemType"] as string) ?? "(unknown)";
      const wiTitle = (wi.fields?.["System.Title"] as string) ?? "(no title)";
      if (type !== "Test Case") {
        typeRefusals.push({ id, type, title: wiTitle });
        continue;
      }
      const rels = wi.relations ?? [];
      const testedBy = rels.find((r) => r.rel === "Microsoft.VSTS.Common.TestedBy-Reverse");
      let parentUsId: number | null = null;
      if (testedBy) {
        const parts = testedBy.url.split("/");
        const n = parseInt(parts[parts.length - 1], 10);
        parentUsId = Number.isNaN(n) ? null : n;
      }
      prechecks.push({ id, type, title: wiTitle, parentUsId });
    } catch (err) {
      if (err instanceof AdoClientError && err.statusCode === 404) {
        fetchFailures.push({ id, reason: "Work item not found — ID may be wrong or already deleted." });
      } else if (err instanceof AdoClientError && err.statusCode === 401) {
        fetchFailures.push({ id, reason: "Authentication failed. Run /vortex-ado/ado-connect to update credentials." });
      } else if (err instanceof AdoClientError && err.statusCode === 403) {
        fetchFailures.push({ id, reason: "Insufficient permissions. PAT needs Work Items (Read & Write)." });
      } else {
        fetchFailures.push({ id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  if (typeRefusals.length > 0 || fetchFailures.length > 0) {
    return {
      ok: false,
      prechecks,
      block: {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({
          status: "needs-input",
          reason: "precheck-failed",
          message:
            `🚫 BLOCK: ${isBulk ? `Batch of ${ids.length} test case ${operation}(s)` : `${operation} for work item ${ids[0]}`} refused — ` +
            `${typeRefusals.length} ID(s) are not Test Cases, ${fetchFailures.length} could not be fetched. ` +
            `No changes were made. Review the lists below and re-run with the corrected IDs.`,
          typeRefusals,
          fetchFailures,
          suggestion: isBulk
            ? "Remove non-Test-Case IDs and unreachable IDs from the list, then re-run with the corrected array."
            : "Double-check the ID. If you intended to act on a different work item type, do it directly in the ADO UI — this tool only mutates Test Cases.",
          resolvedSoFar: { requestedIds: ids, validTcIds: prechecks.map((p) => p.id) },
        }, null, 2) }],
      },
    };
  }

  if (isBulk) {
    const byUs = new Map<number | "none", TcPrecheckRecord[]>();
    for (const p of prechecks) {
      const key = p.parentUsId ?? "none";
      const bucket = byUs.get(key) ?? [];
      bucket.push(p);
      byUs.set(key, bucket);
    }
    const usCount = byUs.size;
    if (usCount > 1 && !acknowledgeCrossUs) {
      const breakdown = [...byUs.entries()].map(([us, items]) => ({
        parentUsId: us === "none" ? null : us,
        tcCount: items.length,
        tcIds: items.map((i) => i.id),
      }));
      return {
        ok: false,
        prechecks,
        block: {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({
            status: "needs-confirmation",
            reason: "cross-us-bulk-update",
            message:
              `⚠️ WARN: These ${ids.length} test case(s) belong to ${usCount} different User Stories (or are unlinked). ` +
              `Applying the same ${operation} across User Stories is valid but unusual — confirm this is intentional.`,
            breakdown,
            prompt: `Reply **YES** to apply the ${operation} to all ${ids.length} TC(s) across ${usCount} User Stor${usCount === 1 ? "y" : "ies"}, or **no** to cancel.`,
            onYes: "Re-run the same call with `acknowledgeCrossUs: true`.",
            onNo: "Stop. No changes.",
            resolvedSoFar: { requestedIds: ids, parentUsCount: usCount },
          }, null, 2) }],
        },
      };
    }
  }

  return { ok: true, prechecks };
}
