import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoClient } from "../ado-client.ts";
import { AdoClientError } from "../ado-client.ts";
import type { ConfluenceClient } from "../confluence-client.ts";
import type { AdoWorkItem, JsonPatchOperation, TestCaseResult } from "../types.ts";
import { loadConventionsConfig } from "../config.ts";
import { buildTcTitle } from "../helpers/tc-title-builder.ts";
import { buildPrerequisitesHtml } from "../helpers/prerequisites.ts";
import { buildStepsXml } from "../helpers/steps-builder.ts";
import { adoWorkItemUrl } from "../helpers/ado-urls.ts";
import { stripHtml } from "../helpers/strip-html.ts";
import {
  READ_OUTPUT_SCHEMA,
  type CanonicalReadResult,
  type CanonicalReadChild,
  type CanonicalReadArtifact,
} from "./read-result.ts";

// Formatting (bold, lists, persona sub-bullets, TO BE TESTED FOR expansion) is applied
// via buildPrerequisitesHtml and buildStepsXml for ALL paths: createTestCase (qa_publish_push),
// qa_tc_update, and any future create_test_case tool.

const StepSchema = z.object({
  action: z.string(),
  expectedResult: z.string(),
});

const PrerequisitesSchema = z.object({
  personas: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
  preConditions: z.array(z.string()).nullable().optional(),
  testData: z.string().nullable().optional(),
}).optional();

export function registerTestCaseTools(
  server: McpServer,
  client: AdoClient,
  _confluenceClient: ConfluenceClient | null
) {
  // Note: create_test_case tool removed. Test cases are inserted only via the /qa-publish
  // command → qa_publish_push (after draft review and user confirmation).

  server.registerTool(
    "ado_suite_tests",
    {
      title: "List Test Cases in Suite",
      description: "List test cases within a specific test suite",
      inputSchema: {
        planId: z.number().int().positive().describe("The test plan ID"),
        suiteId: z.number().int().positive().describe("The test suite ID"),
      },
      outputSchema: READ_OUTPUT_SCHEMA,
    },
    async ({ planId, suiteId }) => {
      try {
        const result = await client.get<{ value: Array<{ testCase: { id: number; name: string } }> }>(
          `/_apis/testplan/Plans/${planId}/Suites/${suiteId}/TestCase`,
          "7.1"
        );
        const cases = result.value.map((tc) => ({
          id: tc.testCase.id,
          name: tc.testCase.name,
        }));
        const prose = JSON.stringify(cases, null, 2);
        const canonical = buildListTestCasesCanonicalResult(planId, suiteId, cases);
        return {
          content: [{ type: "text" as const, text: prose }],
          structuredContent: canonical as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error listing test cases: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_tc_read",
    {
      title: "Read Test Case",
      description: "Get a test case work item by ID with all fields",
      inputSchema: {
        workItemId: z.number().int().positive().describe("The test case work item ID"),
      },
      outputSchema: READ_OUTPUT_SCHEMA,
    },
    async ({ workItemId }) => {
      try {
        const item = await client.get<AdoWorkItem>(
          `/_apis/wit/workitems/${workItemId}`,
          "7.0",
          { "$expand": "relations" }
        );
        const withUrl = { ...item, webUrl: adoWorkItemUrl(client, item.id) };
        const prose = JSON.stringify(withUrl, null, 2);
        const canonical = buildTestCaseCanonicalResult(item);
        return {
          content: [{ type: "text" as const, text: prose }],
          structuredContent: canonical as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error fetching test case: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_tc_update",
    {
      title: "Update Test Case",
      description:
        "Update fields of one or more existing test cases. Accepts a single workItemId (number) or a bulk array (number[]) — when an array is given, the SAME field values are applied UNIFORMLY to every ID (this is intentional; for varying-per-TC updates, edit the draft and use /qa-publish). Before applying any patch, the tool verifies each ID is a Test Case (refuses User Story/Bug/Task/etc.) and surfaces cross-US span as a `needs-confirmation` response so the caller can get explicit user agreement. Set `acknowledgeCrossUs: true` only after the user has seen the per-US breakdown and explicitly confirmed. Returns a per-ID result table for bulk calls.",
      inputSchema: {
        workItemId: z.union([
          z.number().int().positive(),
          z.array(z.number().int().positive()).min(1),
        ]).describe("The test case work item ID, or an array of IDs for uniform bulk update"),
        title: z.string().optional().describe("Updated title (applied uniformly to all IDs in bulk mode)"),
        description: z.string().optional().describe("Raw HTML for Prerequisite for Test (use when providing pre-built HTML)"),
        prerequisites: PrerequisitesSchema.describe("Structured prerequisites; when provided, builds HTML and writes to prerequisite field"),
        steps: z.array(StepSchema).optional().describe("Updated test steps (applied uniformly to all IDs in bulk mode)"),
        priority: z.number().int().min(1).max(4).optional().describe("Updated priority"),
        state: z.string().optional().describe("Updated state"),
        assignedTo: z.string().optional().describe("Updated assigned to"),
        areaPath: z.string().optional().describe("Updated area path"),
        iterationPath: z.string().optional().describe("Updated iteration path"),
        acknowledgeCrossUs: z.boolean().optional().describe("Set to true only when the user has seen the per-US breakdown of a cross-US bulk update and explicitly confirmed. Skipped for single-ID calls. Defaults to false."),
      },
    },
    async ({ workItemId, title, description, prerequisites, steps, priority, state, assignedTo, areaPath, iterationPath, acknowledgeCrossUs }) => {
      const config = loadConventionsConfig();
      const prereqField = config.prerequisiteFieldRef ?? "System.Description";

      // Build the JSON Patch ops once — identical for every ID in the batch (uniform semantics).
      const ops: JsonPatchOperation[] = [];
      if (title) ops.push({ op: "replace", path: "/fields/System.Title", value: title });
      const prereqHtml = prerequisites ? buildPrerequisitesHtml(prerequisites) : description;
      if (prereqHtml) ops.push({ op: "replace", path: `/fields/${prereqField}`, value: prereqHtml });
      if (steps) ops.push({ op: "replace", path: "/fields/Microsoft.VSTS.TCM.Steps", value: buildStepsXml(steps) });
      if (priority) ops.push({ op: "replace", path: "/fields/Microsoft.VSTS.Common.Priority", value: priority });
      if (state) ops.push({ op: "replace", path: "/fields/System.State", value: state });
      if (assignedTo) ops.push({ op: "replace", path: "/fields/System.AssignedTo", value: assignedTo });
      if (areaPath) ops.push({ op: "replace", path: "/fields/System.AreaPath", value: areaPath });
      if (iterationPath) ops.push({ op: "replace", path: "/fields/System.IterationPath", value: iterationPath });

      if (ops.length === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update." }] };
      }

      const ids = Array.isArray(workItemId) ? workItemId : [workItemId];
      const isBulk = ids.length > 1;

      // ── Step 1: type-verify every ID before touching anything ──
      // Mirrors qa_tc_delete — refuse non-Test-Case work items so a typo'd ID
      // can't silently mutate a User Story or Bug.
      interface PrecheckRecord { id: number; type: string; title: string; parentUsId: number | null; }
      const prechecks: PrecheckRecord[] = [];
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
          // Find parent US via TestedBy relation (reverse direction on the TC).
          const rels = wi.relations ?? [];
          const testedBy = rels.find(
            (r) => r.rel === "Microsoft.VSTS.Common.TestedBy-Reverse"
          );
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

      // If any IDs failed precheck or were wrong type, refuse the whole batch — don't
      // partially mutate when the caller's intent is clearly off (bad ID list).
      if (typeRefusals.length > 0 || fetchFailures.length > 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            status: "needs-input",
            reason: "precheck-failed",
            message:
              `🚫 BLOCK: ${isBulk ? `Batch of ${ids.length} test case update(s)` : `Update for work item ${ids[0]}`} refused — ` +
              `${typeRefusals.length} ID(s) are not Test Cases, ${fetchFailures.length} could not be fetched. ` +
              `No changes were made. Review the lists below and re-run with the corrected IDs.`,
            typeRefusals,
            fetchFailures,
            suggestion: isBulk
              ? "Remove non-Test-Case IDs and unreachable IDs from the list, then re-run /qa-tc-update with the corrected array."
              : "Double-check the ID. If you intended to update a different work item type, do it directly in the ADO UI — this tool only mutates Test Cases.",
            resolvedSoFar: { requestedIds: ids, validTcIds: prechecks.map((p) => p.id) },
          }, null, 2) }],
          isError: true,
        };
      }

      // ── Step 2: cross-US span detection (bulk only) ──
      if (isBulk) {
        const byUs = new Map<number | "none", PrecheckRecord[]>();
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
            content: [{ type: "text" as const, text: JSON.stringify({
              status: "needs-confirmation",
              reason: "cross-us-bulk-update",
              message:
                `⚠️ WARN: These ${ids.length} test case(s) belong to ${usCount} different User Stories (or are unlinked). ` +
                `Applying the same field values across User Stories is valid but unusual — confirm this is intentional.`,
              breakdown,
              prompt: `Reply **YES** to apply the update to all ${ids.length} TC(s) across ${usCount} User Stor${usCount === 1 ? "y" : "ies"}, or **no** to cancel.`,
              onYes: "Re-run qa_tc_update with the same args plus acknowledgeCrossUs: true.",
              onNo: "Stop. No changes.",
              resolvedSoFar: { requestedIds: ids, parentUsCount: usCount },
            }, null, 2) }],
            isError: true,
          };
        }
      }

      // ── Step 3: apply the patch — per-ID, collecting both successes and failures ──
      // Continue on failure (user already confirmed; partial success is better than all-or-nothing
      // because some TCs may have state conflicts even when the patch is valid for others).
      const successes: Array<{ id: number; title: string; rev?: number; webUrl: string }> = [];
      const failures: Array<{ id: number; error: string }> = [];

      for (const id of ids) {
        try {
          const item = await client.patch<AdoWorkItem>(
            `/_apis/wit/workitems/${id}`,
            ops,
            "application/json-patch+json",
            "7.0"
          );
          const pre = prechecks.find((p) => p.id === id);
          const updatedTitle = (item.fields?.["System.Title"] as string) ?? pre?.title ?? `TC #${id}`;
          successes.push({ id: item.id, title: updatedTitle, rev: item.rev, webUrl: adoWorkItemUrl(client, item.id) });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failures.push({ id, error: message });
        }
      }

      // ── Step 4: report ──
      if (!isBulk) {
        // Single-ID path: preserve legacy JSON shape (back-compat with any caller parsing the response).
        if (failures.length > 0) {
          return {
            content: [{ type: "text" as const, text: `Error updating test case: ${failures[0].error}` }],
            isError: true,
          };
        }
        const s = successes[0];
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ id: s.id, rev: s.rev, url: s.webUrl }, null, 2) }],
        };
      }

      // Bulk: per-ID table summary. If any failures, mark isError but STILL return the partial-success summary
      // so the caller can see which IDs were already committed and which still need attention.
      const rows = [
        "| ID | Status | Title |",
        "| --- | --- | --- |",
        ...successes.map((s) => `| [${s.id}](${s.webUrl}) | ✅ Updated | ${s.title} |`),
        ...failures.map((f) => `| ${f.id} | ❌ Failed | ${f.error.replace(/\|/g, "\\|")} |`),
      ].join("\n");

      const headline = failures.length === 0
        ? `✅ SUCCESS: Updated ${successes.length} test case(s) uniformly.`
        : `⚠️ PARTIAL: ${successes.length}/${ids.length} updated, ${failures.length} failed. No retry was attempted — re-run qa_tc_update with the failed IDs only after investigating.`;

      return {
        content: [{ type: "text" as const, text: `${headline}\n\n${rows}` }],
        isError: failures.length > 0,
      };
    }
  );

  server.registerTool(
    "qa_suite_add_tests",
    {
      title: "Add Test Cases to Suite",
      description: "Add existing test case IDs to a static test suite (not needed for query-based suites)",
      inputSchema: {
        planId: z.number().int().positive().describe("The test plan ID"),
        suiteId: z.number().int().positive().describe("The target suite ID"),
        testCaseIds: z.array(z.number().int().positive()).min(1).describe("Array of test case work item IDs to add"),
      },
    },
    async ({ planId, suiteId, testCaseIds }) => {
      try {
        const body = testCaseIds.map((id) => ({ testCase: { id } }));
        const result = await client.post<{ value: unknown[] }>(
          `/_apis/testplan/Plans/${planId}/Suites/${suiteId}/TestCase`,
          body,
          "application/json",
          "7.1"
        );
        return {
          content: [{ type: "text" as const, text: `Added ${testCaseIds.length} test case(s) to suite ${suiteId}. Response count: ${result.value?.length ?? 0}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error adding test cases to suite: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "qa_tc_delete",
    {
      title: "Delete Test Case",
      description: "Delete a test case work item by ID. Verifies the work item type is 'Test Case' before deleting — refuses to delete any other type (User Story, Bug, Task, etc.). By default moves to Recycle Bin (restorable within 30 days via ADO UI). Set destroy=true to permanently delete (cannot be recovered).",
      inputSchema: {
        workItemId: z.number().int().positive().describe("The test case work item ID to delete"),
        destroy: z.boolean().optional().default(false).describe("If true, permanently delete (CANNOT be recovered). Default false (Recycle Bin, restorable within 30 days)."),
      },
    },
    async ({ workItemId, destroy }) => {
      // Step 1: fetch the work item to verify type
      let workItem: AdoWorkItem;
      try {
        workItem = await client.get<AdoWorkItem>(
          `/_apis/wit/workitems/${workItemId}`,
          "7.0",
          { fields: "System.WorkItemType,System.Title,System.State" }
        );
      } catch (err) {
        if (err instanceof AdoClientError) {
          if (err.statusCode === 401) {
            return {
              content: [{ type: "text" as const, text: `Cannot delete work item ${workItemId}: **Authentication failed.** Your ADO PAT is invalid or expired. Run /vortex-ado/ado-connect to update credentials.` }],
              isError: true,
            };
          }
          if (err.statusCode === 403) {
            return {
              content: [{ type: "text" as const, text: `Cannot delete work item ${workItemId}: **Insufficient permissions.** Your ADO PAT needs the **Work Items (Read & Write)** scope (and **Test Management (Read & Write)** for test case mutations). Create a new PAT with these scopes and run /vortex-ado/ado-connect to update credentials.` }],
              isError: true,
            };
          }
          if (err.statusCode === 404) {
            return {
              content: [{ type: "text" as const, text: `Work item ${workItemId} not found. It may already be deleted, or the ID may be wrong. Verify the ID in ADO and try again.` }],
              isError: true,
            };
          }
        }
        return {
          content: [{ type: "text" as const, text: `Error fetching work item ${workItemId}: ${err}` }],
          isError: true,
        };
      }

      // Step 2: enforce type — this tool ONLY deletes Test Cases
      const workItemType = (workItem.fields?.["System.WorkItemType"] as string) ?? "(unknown)";
      if (workItemType !== "Test Case") {
        const title = (workItem.fields?.["System.Title"] as string) ?? "(no title)";
        return {
          content: [{
            type: "text" as const,
            text: `**Refused to delete work item ${workItemId}.**\n\nThis tool only deletes **Test Cases**. The work item you referenced is a **${workItemType}**:\n\n- **Title:** ${title}\n- **Type:** ${workItemType}\n\nIf you intended to delete a test case, double-check the ID. If you intended to delete a ${workItemType}, do it directly in the ADO UI — this MCP server intentionally does not delete other work item types to prevent accidental data loss.`,
          }],
          isError: true,
        };
      }

      // Step 3: perform the delete
      try {
        const queryParams = destroy ? { destroy: "true" } : undefined;
        await client.delete(`/_apis/wit/workitems/${workItemId}`, "7.1", queryParams);
        const title = (workItem.fields?.["System.Title"] as string) ?? "";
        const msg = destroy
          ? `🔴 Test case ${workItemId}${title ? ` (${title})` : ""} **PERMANENTLY DELETED.** This cannot be recovered.`
          : `Test case ${workItemId}${title ? ` (${title})` : ""} deleted (moved to Recycle Bin — restorable within 30 days via ADO UI under Work Items → Recycle Bin).`;
        return { content: [{ type: "text" as const, text: msg }] };
      } catch (err) {
        if (err instanceof AdoClientError) {
          if (err.statusCode === 403) {
            return {
              content: [{ type: "text" as const, text: `Cannot delete test case ${workItemId}: **Insufficient permissions.** Your ADO PAT needs the **Work Items (Read & Write)** and **Test Management (Read & Write)** scopes.${destroy ? " Permanent-delete (destroy=true) also requires Project Administrator permission in ADO." : ""} Create a new PAT with these scopes and run /vortex-ado/ado-connect.` }],
              isError: true,
            };
          }
          if (err.statusCode === 401) {
            return {
              content: [{ type: "text" as const, text: `Cannot delete test case ${workItemId}: **Authentication failed.** Your ADO PAT is invalid or expired.` }],
              isError: true,
            };
          }
        }
        return {
          content: [{ type: "text" as const, text: `Error deleting test case ${workItemId}: ${err}` }],
          isError: true,
        };
      }
    }
  );
}

// ── Canonical read-result builders ──

/**
 * Build the CanonicalReadResult for `ado_suite_tests` from the flat
 * list returned by the ADO test-plan API.
 *
 * - `item.type` = "test-suite" (the suite is the read target).
 * - `children[]` = every test case in the suite, `relationship:
 *   "contained"`.
 * - `completeness.isPartial` = false; the ADO `/TestCase` endpoint
 *   returns the full suite contents in one page.
 */
export function buildListTestCasesCanonicalResult(
  planId: number,
  suiteId: number,
  cases: Array<{ id: number; name: string }>,
): CanonicalReadResult {
  return {
    item: {
      id: suiteId,
      type: "test-suite",
      title: `Test Suite ${suiteId}`,
      summary: `${cases.length} test case${cases.length === 1 ? "" : "s"} in suite ${suiteId} (plan ${planId})`,
    },
    children: cases.map((tc) => ({
      id: tc.id,
      type: "test-case",
      title: tc.name,
      relationship: "contained",
    })),
    completeness: { isPartial: false },
  };
}

/**
 * Build the CanonicalReadResult for `qa_tc_read` from the raw
 * AdoWorkItem returned by the ADO API.
 *
 * - `item.type` = "test-case".
 * - `children`: derived from `item.relations` — one entry per work-item
 *   relation (parent, tested-by, tested, related, …). Non work-item
 *   relations (attachments, hyperlinks) are routed to `artifacts`.
 * - `artifacts`: attachment relations if any.
 * - `completeness.isPartial` = false (this tool returns the full item
 *   shape in prose; no truncation is applied).
 */
export function buildTestCaseCanonicalResult(item: AdoWorkItem): CanonicalReadResult {
  const relations = item.relations ?? [];
  const children: CanonicalReadChild[] = [];
  const artifacts: CanonicalReadArtifact[] = [];

  for (const rel of relations) {
    if (rel.rel === "AttachedFile") {
      const name = (rel.attributes?.["name"] as string | undefined) ?? "attachment";
      artifacts.push({ kind: "attachment", title: name, url: rel.url });
      continue;
    }
    if (rel.rel === "Hyperlink") {
      const comment = (rel.attributes?.["comment"] as string | undefined) ?? rel.url;
      artifacts.push({ kind: "hyperlink", title: comment, url: rel.url });
      continue;
    }
    // Otherwise treat as a related work item.
    const parts = rel.url.split("/");
    const idStr = parts[parts.length - 1] ?? "";
    const idNum = parseInt(idStr, 10);
    const id: string | number = Number.isNaN(idNum) ? rel.url : idNum;
    const title = (rel.attributes?.["name"] as string | undefined) ?? rel.rel;
    children.push({
      id,
      type: "work-item",
      title,
      relationship: rel.rel,
    });
  }

  const title = (item.fields["System.Title"] as string) ?? `Test Case ${item.id}`;
  const descriptionHtml = (item.fields["System.Description"] as string) ?? "";
  const summary = stripHtml(descriptionHtml).slice(0, 500) || undefined;

  return {
    item: {
      id: item.id,
      type: "test-case",
      title,
      summary,
    },
    ...(children.length > 0 ? { children } : {}),
    ...(artifacts.length > 0 ? { artifacts } : {}),
    completeness: { isPartial: false },
  };
}

// ── Core Logic (exported for qa_publish_push) ──

export interface CreateTestCaseParams {
  planId: number;
  userStoryId: number;
  tcNumber?: number;
  featureTags: string[];
  useCaseSummary: string;
  priority?: number;
  prerequisites?: {
    personas?: string | string[] | null;
    preConditions?: string[] | null;
    /** Multi-column structured Pre-requisite table — merges common + per-TC additively. */
    preConditionsTable?: { headers: string[]; rows: string[][] } | null;
    testData?: string | null;
  };
  steps: Array<{ action: string; expectedResult: string }>;
  areaPath?: string | null;
  iterationPath?: string | null;
  assignedTo?: string;
  /**
   * Tags to apply to System.Tags. Match-only policy — caller should have already
   * resolved these against the project's existing tags; unmatched tags are NOT
   * created. Pass resolved matches here; undefined/empty = no tag write op.
   */
  tags?: string[];
}

export async function createTestCase(client: AdoClient, params: CreateTestCaseParams): Promise<TestCaseResult> {
  const config = loadConventionsConfig();

  const usItem = await client.get<AdoWorkItem>(
    `/_apis/wit/workitems/${params.userStoryId}`,
    "7.0",
    { fields: "System.AreaPath,System.IterationPath" }
  );
  const usAreaPath = (usItem.fields["System.AreaPath"] as string) || "";
  const usIterationPath = (usItem.fields["System.IterationPath"] as string) || "";

  const tcNumber = params.tcNumber ?? await getNextTcNumber(client, params.userStoryId, usAreaPath);
  const title = buildTcTitle(params.userStoryId, tcNumber, params.featureTags, params.useCaseSummary);
  const description = buildPrerequisitesHtml(params.prerequisites);
  const stepsXml = buildStepsXml(params.steps);
  // Prefer User Story's paths (live from ADO) to avoid TF401347 Invalid tree name - draft parsing can differ
  const areaPath = usAreaPath || params.areaPath || "";
  const iterationPath = usIterationPath || params.iterationPath || "";
  const priority = params.priority ?? config.testCaseDefaults.priority;
  const state = config.testCaseDefaults.state;

  const ops: JsonPatchOperation[] = [
    { op: "add", path: "/fields/System.Title", value: title },
    { op: "add", path: "/fields/System.AreaPath", value: areaPath },
    { op: "add", path: "/fields/System.IterationPath", value: iterationPath },
    { op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: priority },
    { op: "add", path: "/fields/System.State", value: state },
    { op: "add", path: "/fields/Microsoft.VSTS.TCM.Steps", value: stepsXml },
  ];

  const prereqField = config.prerequisiteFieldRef ?? "System.Description";
  if (description) {
    ops.push({ op: "add", path: `/fields/${prereqField}`, value: description });
  }

  if (params.assignedTo) {
    ops.push({ op: "add", path: "/fields/System.AssignedTo", value: params.assignedTo });
  }

  // Apply pre-resolved tags (match-only policy — caller has already filtered
  // against project's existing tags via resolveTagsMatchOnly()).
  if (params.tags && params.tags.length > 0) {
    ops.push({ op: "add", path: "/fields/System.Tags", value: params.tags.join("; ") });
  }

  // Link to User Story via "Tests / Tested By" relation
  ops.push({
    op: "add",
    path: "/relations/-",
    value: {
      rel: "Microsoft.VSTS.Common.TestedBy-Reverse",
      url: `${client.baseUrl}/_apis/wit/workitems/${params.userStoryId}`,
      attributes: { comment: "Auto-linked by MCP server" },
    },
  });

  const item = await client.post<AdoWorkItem>(
    "/_apis/wit/workitems/$Test Case",
    ops,
    "application/json-patch+json",
    "7.0"
  );

  return {
    id: item.id,
    title: (item.fields["System.Title"] as string) || title,
    url: item.url,
    state: (item.fields["System.State"] as string) || state,
    priority,
  };
}

/**
 * Updates an existing test case with the same params as createTestCase.
 * Used for repush when draft is revised after initial push.
 */
export async function updateTestCaseFromParams(
  client: AdoClient,
  workItemId: number,
  params: CreateTestCaseParams
): Promise<TestCaseResult> {
  const config = loadConventionsConfig();
  const title = buildTcTitle(params.userStoryId, params.tcNumber ?? 0, params.featureTags, params.useCaseSummary);
  const prereqHtml = buildPrerequisitesHtml(params.prerequisites);
  const stepsXml = buildStepsXml(params.steps);
  const prereqField = config.prerequisiteFieldRef ?? "System.Description";
  const priority = params.priority ?? config.testCaseDefaults.priority;

  const ops: JsonPatchOperation[] = [
    { op: "replace", path: "/fields/System.Title", value: title },
    { op: "replace", path: `/fields/${prereqField}`, value: prereqHtml },
    { op: "replace", path: "/fields/Microsoft.VSTS.TCM.Steps", value: stepsXml },
    { op: "replace", path: "/fields/Microsoft.VSTS.Common.Priority", value: priority },
  ];

  // Tags are overwritten (not appended) on repush, matching title/prereq/steps/priority semantics.
  if (params.tags && params.tags.length > 0) {
    ops.push({ op: "replace", path: "/fields/System.Tags", value: params.tags.join("; ") });
  }

  const item = await client.patch<AdoWorkItem>(
    `/_apis/wit/workitems/${workItemId}`,
    ops,
    "application/json-patch+json",
    "7.0"
  );

  return {
    id: item.id,
    title: (item.fields["System.Title"] as string) || title,
    url: item.url,
    state: (item.fields["System.State"] as string) || config.testCaseDefaults.state,
    priority,
  };
}

async function getNextTcNumber(client: AdoClient, usId: number, areaPath: string): Promise<number> {
  const wiql = {
    query:
      `SELECT [System.Id] FROM WorkItems ` +
      `WHERE [System.WorkItemType] = 'Test Case' ` +
      `AND [System.AreaPath] UNDER '${areaPath}' ` +
      `AND [System.Title] CONTAINS 'TC_${usId}_' ` +
      `ORDER BY [System.Title] DESC`,
  };

  try {
    const result = await client.post<{ workItems: Array<{ id: number }> }>(
      "/_apis/wit/wiql",
      wiql,
      "application/json",
      "7.0"
    );
    return (result.workItems?.length ?? 0) + 1;
  } catch {
    return 1;
  }
}
