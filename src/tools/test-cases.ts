import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdoClient } from "../ado-client.ts";
import { AdoClientError } from "../ado-client.ts";
import type { ConfluenceClient } from "../confluence-client.ts";
import type { AdoWorkItem, JsonPatchOperation, TestCaseResult, ConventionsConfig } from "../types.ts";
import { loadConventionsConfig } from "../config.ts";
import { resolveConfigForCall } from "../workspace/config-for-call.ts";
import { buildTcTitle } from "../helpers/tc-title-builder.ts";
import { ALL_KNOWN_TAGS, tagToSuffix, tagToSuffixHint } from "../helpers/suffix-tag.ts";
import { parseTcTitle } from "../helpers/tc-draft-parser.ts";
import { buildPrerequisitesHtml } from "../helpers/prerequisites.ts";
import { buildStepsXml } from "../helpers/steps-builder.ts";
import { adoWorkItemUrl } from "../helpers/ado-urls.ts";
import { stripHtml } from "../helpers/strip-html.ts";
import { runTcPrecheck, type TcPrecheckRecord } from "../helpers/tc-precheck.ts";
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
        "Update fields of one or more existing test cases. Accepts a single workItemId (number) or a bulk array (number[]) — when an array is given, the SAME field values are applied UNIFORMLY to every ID (this is intentional; for varying-per-TC updates, edit the draft and use /qa-publish). Before applying any patch, the tool verifies each ID is a Test Case (refuses User Story/Bug/Task/etc.) and surfaces cross-US span as a `needs-confirmation` response so the caller can get explicit user agreement. Set `acknowledgeCrossUs: true` only after the user has seen the per-US breakdown and explicitly confirmed. Title preservation: when the existing TC follows the canonical `TC_<usId>(_<TAG>)?_<NN> -> <feature-tags> -> <use-case-summary>` shape, raw `title` writes are validated to keep that shape — pass `useCaseSummary` to swap just the trailing summary while preserving the TC ID prefix, feature tags, and category tag, or pass `forceTitleOverwrite: true` to opt out of validation entirely. Returns a per-ID result table for bulk calls.",
      inputSchema: {
        workItemId: z.union([
          z.number().int().positive(),
          z.array(z.number().int().positive()).min(1),
        ]).describe("The test case work item ID, or an array of IDs for uniform bulk update"),
        title: z.string().optional().describe("Updated title (applied uniformly to all IDs in bulk mode). When the existing TC has a structured title, the server validates the new value preserves the `TC_<usId>(_<TAG>)?_<NN> -> ...` shape and BLOCKS with `tc-title-shape-mismatch` if it doesn't — use `useCaseSummary` to update just the trailing summary, or `forceTitleOverwrite: true` to bypass validation."),
        useCaseSummary: z.string().optional().describe("Replace ONLY the trailing use-case-summary segment of the title; the server fetches each TC, parses its existing title, and reconstructs the full title preserving the TC ID prefix, feature tags, and category tag. Mutually exclusive with `title`. Errors on TCs whose existing title doesn't match the canonical shape."),
        forceTitleOverwrite: z.boolean().optional().describe("Power-user escape hatch: when true, write the supplied `title` exactly as given, skipping all shape validation. Use only when you genuinely want to break the TC ID convention (e.g. legacy cleanup). Ignored when `title` is not set."),
        description: z.string().optional().describe("Raw HTML for Prerequisite for Test (use when providing pre-built HTML)"),
        prerequisites: PrerequisitesSchema.describe("Structured prerequisites; when provided, builds HTML and writes to prerequisite field"),
        steps: z.array(StepSchema).optional().describe("Updated test steps (applied uniformly to all IDs in bulk mode)"),
        priority: z.number().int().min(1).max(4).optional().describe("Updated priority"),
        state: z.string().optional().describe("Updated state"),
        assignedTo: z.string().optional().describe("Updated assigned to"),
        areaPath: z.string().optional().describe("Updated area path"),
        iterationPath: z.string().optional().describe("Updated iteration path"),
        fields: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe("Generic per-field overrides keyed by ADO reference name (e.g. 'Custom.Regression_Needed', 'Microsoft.VSTS.TCM.AutomationStatus'). Use `ado_fields` to discover valid reference names for your tenant. Each entry emits a JSON Patch replace op alongside the typed-param ops. `System.Title` is rejected here — use `title` or `useCaseSummary` (they carry shape validation). When a key here collides with a typed param (e.g. both `priority` and `fields['Microsoft.VSTS.Common.Priority']` are set), the bag wins because its op is appended last. Picklist / type validation is delegated to ADO; invalid values surface as per-ID partial failures."),
        acknowledgeCrossUs: z.boolean().optional().describe("Set to true only when the user has seen the per-US breakdown of a cross-US bulk update and explicitly confirmed. Skipped for single-ID calls. Defaults to false."),
      },
    },
    async ({ workItemId, title, useCaseSummary, forceTitleOverwrite, description, prerequisites, steps, priority, state, assignedTo, areaPath, iterationPath, fields, acknowledgeCrossUs }, extra) => {
      const config = await resolveConfigForCall(extra);
      const prereqField = config.prerequisiteFieldRef ?? "System.Description";

      // Mutual exclusion between `title` and `useCaseSummary` — both target System.Title
      // via different paths (raw write vs reconstructed-from-prefix), so allowing both
      // would require deciding which wins; rejecting up-front keeps the contract crisp.
      if (title !== undefined && useCaseSummary !== undefined) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            status: "error",
            reason: "title-and-use-case-summary-both-supplied",
            message:
              "Both `title` and `useCaseSummary` were supplied, but they target the same field (System.Title) via different paths. " +
              "Pass `title` (raw write, full structured title) OR `useCaseSummary` (server reconstructs the title from the existing TC's prefix), not both.",
          }, null, 2) }],
          isError: true,
        };
      }

      // The generic `fields` bag is for tenant-specific custom fields and standard
      // ADO fields not exposed as typed params. Title is special — it has shape
      // validation on the typed params and the bag would bypass that — so refuse
      // it explicitly and point the caller at the typed path.
      if (fields && Object.prototype.hasOwnProperty.call(fields, "System.Title")) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            status: "error",
            reason: "system-title-in-fields-bag",
            message:
              "`fields['System.Title']` is not allowed — the typed `title` / `useCaseSummary` params carry TC title-shape validation that the generic bag would bypass. " +
              "Re-run with `title` (raw write, optionally with `forceTitleOverwrite: true`) or `useCaseSummary` (preserves the canonical prefix).",
          }, null, 2) }],
          isError: true,
        };
      }

      // Build the non-title JSON Patch ops once — identical for every ID in the batch.
      // Title is appended per-ID later because `useCaseSummary` reconstruction depends
      // on each TC's existing prefix.
      const baseOps: JsonPatchOperation[] = [];
      const prereqHtml = prerequisites ? buildPrerequisitesHtml(prerequisites, config) : description;
      if (prereqHtml) baseOps.push({ op: "replace", path: `/fields/${prereqField}`, value: prereqHtml });
      if (steps) baseOps.push({ op: "replace", path: "/fields/Microsoft.VSTS.TCM.Steps", value: buildStepsXml(steps) });
      if (priority) baseOps.push({ op: "replace", path: "/fields/Microsoft.VSTS.Common.Priority", value: priority });
      if (state) baseOps.push({ op: "replace", path: "/fields/System.State", value: state });
      if (assignedTo) baseOps.push({ op: "replace", path: "/fields/System.AssignedTo", value: assignedTo });
      if (areaPath) baseOps.push({ op: "replace", path: "/fields/System.AreaPath", value: areaPath });
      if (iterationPath) baseOps.push({ op: "replace", path: "/fields/System.IterationPath", value: iterationPath });

      // Generic field-bag ops. Appended LAST so a collision (e.g. caller passes both
      // `priority` and `fields['Microsoft.VSTS.Common.Priority']`) resolves to the
      // bag value — JSON Patch is applied in order, last write wins.
      if (fields) {
        for (const [refName, value] of Object.entries(fields)) {
          baseOps.push({ op: "replace", path: `/fields/${refName}`, value });
        }
      }

      const titleRequested = title !== undefined || useCaseSummary !== undefined;
      if (baseOps.length === 0 && !titleRequested) {
        return { content: [{ type: "text" as const, text: "No fields to update." }] };
      }

      const ids = Array.isArray(workItemId) ? workItemId : [workItemId];
      const isBulk = ids.length > 1;

      // ── Step 1+2: shared precheck (type-verify, fetch failures, cross-US span) ──
      const precheck = await runTcPrecheck(client, { ids, acknowledgeCrossUs, operation: "update" });
      if (!precheck.ok) {
        return precheck.block!;
      }
      const prechecks: TcPrecheckRecord[] = precheck.prechecks;

      // ── Step 2.5: title-shape validation / reconstruction (when caller targets the title) ──
      // This step decides — per ID — what System.Title value to write, then stores it in
      // `perIdTitleOps`. The patch loop below appends the per-ID title op (if any) onto baseOps.
      const perIdTitleOps = new Map<number, JsonPatchOperation>();

      if (titleRequested) {
        // Strict-validation path. `forceTitleOverwrite` skips validation entirely — power-user
        // escape hatch documented in option C of the `tc-title-shape-mismatch` response.
        if (forceTitleOverwrite && title !== undefined) {
          for (const id of ids) {
            perIdTitleOps.set(id, { op: "replace", path: "/fields/System.Title", value: title });
          }
        } else if (useCaseSummary !== undefined) {
          // Reconstruction path — preserve each TC's prefix (TC ID + featureTags + categoryTag),
          // swap in the new use-case summary. Per-TC because each TC has its own prefix.
          const reconstructionFailures: Array<{ id: number; existingTitle: string }> = [];
          for (const pre of prechecks) {
            const parsed = parseTcTitle(pre.title);
            if (!parsed || pre.parentUsId == null) {
              reconstructionFailures.push({ id: pre.id, existingTitle: pre.title });
              continue;
            }
            const reconstructionSuffix = parsed.categoryTag ? tagToSuffix(parsed.categoryTag) : undefined;
            const newTitle = buildTcTitle(
              pre.parentUsId,
              parsed.tcNumber,
              parsed.featureTags,
              useCaseSummary,
              config,
              reconstructionSuffix,
            );
            perIdTitleOps.set(pre.id, { op: "replace", path: "/fields/System.Title", value: newTitle });
          }
          if (reconstructionFailures.length > 0) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({
                status: "error",
                reason: "use-case-summary-unparseable-existing-title",
                message:
                  "`useCaseSummary` only works for TCs whose existing title follows the canonical " +
                  "`TC_<usId>(_<TAG>)?_<NN> -> <feature-tags> -> <use-case-summary>` shape. " +
                  "The TCs below have non-conventional titles — pass the full structured title via `title`, " +
                  "or `forceTitleOverwrite: true` if you genuinely want to overwrite the legacy shape.",
                unparseableTcs: reconstructionFailures,
              }, null, 2) }],
              isError: true,
            };
          }
        } else if (title !== undefined) {
          // Validation path — does the new title parse? Does the existing title parse?
          // Decision matrix per spec.
          const newParses = parseTcTitle(title) !== null;
          const failedValidation: Array<{ id: number; existingTitle: string }> = [];
          for (const pre of prechecks) {
            const existingParses = parseTcTitle(pre.title) !== null;
            if (newParses) {
              // New title is structured — write as-is, even if existing is legacy.
              perIdTitleOps.set(pre.id, { op: "replace", path: "/fields/System.Title", value: title });
            } else if (!existingParses) {
              // Legacy → legacy: the convention isn't applicable to this TC. Write as-is.
              perIdTitleOps.set(pre.id, { op: "replace", path: "/fields/System.Title", value: title });
            } else {
              // Existing parses, new doesn't, no opt-out — block.
              failedValidation.push({ id: pre.id, existingTitle: pre.title });
            }
          }
          if (failedValidation.length > 0) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({
                status: "needs-input",
                reason: "tc-title-shape-mismatch",
                message:
                  "The new title doesn't follow the `TC_<usId>(_<TAG>)?_<NN> -> <feature-tags> -> <use-case-summary>` " +
                  "convention used by this test case. Updating it as-is would lose the TC ID prefix, feature tags, " +
                  "and category tag.",
                options: [
                  {
                    key: "A",
                    label: "Update just the use-case summary",
                    action:
                      "Re-run qa_tc_update with `useCaseSummary: '<your text>'` instead of `title`. The server will " +
                      "preserve the existing TC ID prefix, feature tags, and category tag and only swap in the new summary.",
                  },
                  {
                    key: "B",
                    label: "Provide the full structured title",
                    action:
                      "Re-run qa_tc_update with the full title in the format " +
                      "`TC_<usId>(_<TAG>)?_<NN> -> <feature-tags> -> <use-case-summary>`.",
                  },
                  {
                    key: "C",
                    label: "Force overwrite (legacy)",
                    action:
                      "Re-run qa_tc_update with `title: '<your raw text>', forceTitleOverwrite: true` to write the " +
                      "title as-is without validation. Use when you genuinely want to break the convention.",
                  },
                ],
                existingTitles: failedValidation.map((f) => ({ id: f.id, title: f.existingTitle })),
                newTitleProvided: title,
              }, null, 2) }],
              isError: true,
            };
          }
        }
      }

      // Final guard: if nothing to write (e.g. only `forceTitleOverwrite: true` with no `title`,
      // or `useCaseSummary: undefined` slipped through somehow), refuse rather than firing a no-op PATCH.
      if (baseOps.length === 0 && perIdTitleOps.size === 0) {
        return { content: [{ type: "text" as const, text: "No fields to update." }] };
      }

      // ── Step 3: apply the patch — per-ID, collecting both successes and failures ──
      // Continue on failure (user already confirmed; partial success is better than all-or-nothing
      // because some TCs may have state conflicts even when the patch is valid for others).
      const successes: Array<{ id: number; title: string; rev?: number; webUrl: string }> = [];
      const failures: Array<{ id: number; error: string }> = [];

      for (const id of ids) {
        try {
          const titleOp = perIdTitleOps.get(id);
          const idOps = titleOp ? [titleOp, ...baseOps] : baseOps;
          const item = await client.patch<AdoWorkItem>(
            `/_apis/wit/workitems/${id}`,
            idOps,
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

  server.registerTool(
    "qa_tc_comment_add",
    {
      title: "Add Comment to Test Case(s)",
      description:
        "Post the SAME HTML comment to one or more existing test cases. Accepts a single workItemId (number) or a bulk array (number[]) — applied uniformly. Comment body supports basic HTML (`<a href>`, `<br>`, `<b>`, `<i>`, `<ul>`/`<li>`); script/style/event handlers are sanitized by ADO. Before posting, the tool verifies each ID is a Test Case (refuses User Story/Bug/Task/etc.) and surfaces cross-US span as a `needs-confirmation` response. Set `acknowledgeCrossUs: true` only after the user has explicitly confirmed. Comments land in the work item's Discussion timeline (same surface as the ADO web UI's Discussion box).",
      inputSchema: {
        workItemId: z.union([
          z.number().int().positive(),
          z.array(z.number().int().positive()).min(1),
        ]).describe("The test case work item ID, or an array of IDs to receive the same comment"),
        commentHtml: z.string().min(1).describe("Comment body — plain text or HTML (anchor + basic block/inline tags). Posted verbatim to each TC's Discussion."),
        acknowledgeCrossUs: z.boolean().optional().describe("Set to true only when the user has seen the per-US breakdown of a cross-US bulk comment and explicitly confirmed. Skipped for single-ID calls. Defaults to false."),
      },
    },
    async ({ workItemId, commentHtml, acknowledgeCrossUs }) => {
      const ids = Array.isArray(workItemId) ? workItemId : [workItemId];
      const isBulk = ids.length > 1;

      const precheck = await runTcPrecheck(client, { ids, acknowledgeCrossUs, operation: "comment" });
      if (!precheck.ok) {
        return precheck.block!;
      }

      // POST the same comment to each TC. Continue on per-ID failure — partial success
      // is reported in the result table for bulk; single-ID returns the legacy error shape.
      const successes: Array<{ id: number; commentId?: number; webUrl: string; title: string }> = [];
      const failures: Array<{ id: number; error: string }> = [];

      for (const pre of precheck.prechecks) {
        try {
          const resp = await client.post<{ commentId?: number }>(
            `/_apis/wit/workItems/${pre.id}/comments`,
            { text: commentHtml },
            "application/json",
            "7.0-preview.3"
          );
          successes.push({
            id: pre.id,
            commentId: resp?.commentId,
            webUrl: adoWorkItemUrl(client, pre.id),
            title: pre.title,
          });
        } catch (err) {
          failures.push({ id: pre.id, error: err instanceof Error ? err.message : String(err) });
        }
      }

      if (!isBulk) {
        if (failures.length > 0) {
          return {
            content: [{ type: "text" as const, text: `Error posting comment to test case ${ids[0]}: ${failures[0].error}` }],
            isError: true,
          };
        }
        const s = successes[0];
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ id: s.id, commentId: s.commentId, url: s.webUrl }, null, 2) }],
        };
      }

      const rows = [
        "| ID | Status | Title |",
        "| --- | --- | --- |",
        ...successes.map((s) => `| [${s.id}](${s.webUrl}) | ✅ Comment posted | ${s.title} |`),
        ...failures.map((f) => `| ${f.id} | ❌ Failed | ${f.error.replace(/\|/g, "\\|")} |`),
      ].join("\n");

      const headline = failures.length === 0
        ? `✅ SUCCESS: Posted comment to ${successes.length} test case(s).`
        : `⚠️ PARTIAL: ${successes.length}/${ids.length} commented, ${failures.length} failed. No retry was attempted — re-run qa_tc_comment_add with the failed IDs only after investigating.`;

      return {
        content: [{ type: "text" as const, text: `${headline}\n\n${rows}` }],
        isError: failures.length > 0,
      };
    }
  );

  server.registerTool(
    "qa_tc_attachments_copy",
    {
      title: "Copy Attachments from a Work Item to Test Case(s)",
      description:
        "Copy attachments (rel: AttachedFile) from a source work item (typically a User Story) to one or more target test cases. Steps per attachment: download bytes from source → upload to ADO attachment store → link the new attachment to each target via JSON Patch. Bulk targets get the SAME attachments uniformly. Before copying, the tool verifies each target is a Test Case (refuses other types) and surfaces cross-US span as a `needs-confirmation` response. By default, attachments whose filename already exists on a target TC are skipped (set `skipDuplicatesByFilename: false` to force re-copy). Returns a per-target table summarising copied / skipped / failed counts.",
      inputSchema: {
        sourceWorkItemId: z.number().int().positive().describe("Work item ID to copy attachments FROM (any type — typically a User Story)."),
        targetTestCaseIds: z.union([
          z.number().int().positive(),
          z.array(z.number().int().positive()).min(1),
        ]).describe("Target test case ID, or array of IDs. Same attachments are linked to every target."),
        filenameFilter: z.array(z.string().min(1)).optional().describe("Optional: only copy attachments whose `attributes.name` matches one of these filenames. When omitted, copies ALL attachments on the source."),
        skipDuplicatesByFilename: z.boolean().optional().default(true).describe("When true (default), skip an attachment on a given target if a relation with the same filename is already linked. When false, always copy (creates a duplicate relation)."),
        copyComment: z.string().optional().describe("Comment text written into the new relation's `attributes.comment`. Defaults to `Copied from work item #<sourceWorkItemId>`."),
        acknowledgeCrossUs: z.boolean().optional().describe("Set to true only when the user has seen the per-US breakdown of a cross-US bulk copy and explicitly confirmed. Skipped for single-target calls. Defaults to false."),
      },
    },
    async ({ sourceWorkItemId, targetTestCaseIds, filenameFilter, skipDuplicatesByFilename, copyComment, acknowledgeCrossUs }) => {
      const targetIds = Array.isArray(targetTestCaseIds) ? targetTestCaseIds : [targetTestCaseIds];
      const isBulk = targetIds.length > 1;
      const dedupe = skipDuplicatesByFilename ?? true;
      const relationComment = copyComment ?? `Copied from work item #${sourceWorkItemId}`;

      const precheck = await runTcPrecheck(client, { ids: targetIds, acknowledgeCrossUs, operation: "attachment-copy" });
      if (!precheck.ok) {
        return precheck.block!;
      }

      // ── Step 1: list source attachments ──
      let sourceWi: AdoWorkItem;
      try {
        sourceWi = await client.get<AdoWorkItem>(
          `/_apis/wit/workitems/${sourceWorkItemId}`,
          "7.0",
          { "$expand": "relations" }
        );
      } catch (err) {
        if (err instanceof AdoClientError && err.statusCode === 404) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              status: "error",
              reason: "source-not-found",
              message: `Source work item ${sourceWorkItemId} not found. Verify the ID and re-run.`,
            }, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `Error fetching source work item ${sourceWorkItemId}: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }

      const allAttachments = (sourceWi.relations ?? [])
        .filter((r) => r.rel === "AttachedFile")
        .map((r) => ({
          url: r.url,
          filename: (r.attributes?.["name"] as string | undefined) ?? "attachment",
        }));

      const wantedAttachments = filenameFilter && filenameFilter.length > 0
        ? allAttachments.filter((a) => filenameFilter.includes(a.filename))
        : allAttachments;

      if (wantedAttachments.length === 0) {
        const reason = allAttachments.length === 0
          ? `Source work item #${sourceWorkItemId} has no attachments.`
          : `No source attachments matched the filename filter ${JSON.stringify(filenameFilter)}. Available: ${allAttachments.map((a) => a.filename).join(", ")}`;
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            status: "noop",
            reason: "no-attachments-to-copy",
            message: reason,
            sourceWorkItemId,
            availableFilenames: allAttachments.map((a) => a.filename),
          }, null, 2) }],
        };
      }

      // ── Step 2: download each source attachment, then upload to the attachment store ──
      // Upload once per file (not once per target) — the resulting URL is linked to every target.
      interface UploadedAttachment { filename: string; uploadedUrl: string; bytes: number; }
      const uploaded: UploadedAttachment[] = [];
      const uploadFailures: Array<{ filename: string; error: string }> = [];

      for (const att of wantedAttachments) {
        try {
          // Strip the source URL to its `/_apis/...` suffix, mirroring extractAndFetchAdoImages.
          const u = new URL(att.url);
          const apisIdx = u.pathname.indexOf("/_apis/");
          const path = apisIdx >= 0 ? u.pathname.slice(apisIdx) : u.pathname;
          const downloadParams: Record<string, string> = { download: "true", fileName: att.filename };
          const binary = await client.getBinary(path, "7.1", downloadParams);

          const uploadResp = await client.postBinary<{ id: string; url: string }>(
            `/_apis/wit/attachments`,
            binary.buffer,
            "application/octet-stream",
            "7.1",
            { fileName: att.filename, uploadType: "Simple" }
          );
          uploaded.push({ filename: att.filename, uploadedUrl: uploadResp.url, bytes: binary.buffer.byteLength });
        } catch (err) {
          uploadFailures.push({ filename: att.filename, error: err instanceof Error ? err.message : String(err) });
        }
      }

      if (uploaded.length === 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            status: "error",
            reason: "all-uploads-failed",
            message: `Could not upload any of the ${wantedAttachments.length} source attachment(s) to the ADO attachment store. No targets were modified.`,
            uploadFailures,
          }, null, 2) }],
          isError: true,
        };
      }

      // ── Step 3: per-target — fetch existing relations (for dedupe), build patch, PATCH ──
      interface TargetResult { id: number; title: string; webUrl: string; copied: string[]; skipped: string[]; failed: string[]; error?: string; }
      const targetResults: TargetResult[] = [];

      for (const pre of precheck.prechecks) {
        const result: TargetResult = {
          id: pre.id,
          title: pre.title,
          webUrl: adoWorkItemUrl(client, pre.id),
          copied: [],
          skipped: [],
          failed: [],
        };

        let existingFilenames = new Set<string>();
        if (dedupe) {
          try {
            const targetWi = await client.get<AdoWorkItem>(
              `/_apis/wit/workitems/${pre.id}`,
              "7.0",
              { "$expand": "relations" }
            );
            for (const r of targetWi.relations ?? []) {
              if (r.rel === "AttachedFile") {
                const name = r.attributes?.["name"];
                if (typeof name === "string") existingFilenames.add(name);
              }
            }
          } catch {
            // Non-fatal — proceed without dedupe info.
            existingFilenames = new Set<string>();
          }
        }

        const ops = [];
        for (const u of uploaded) {
          if (dedupe && existingFilenames.has(u.filename)) {
            result.skipped.push(u.filename);
            continue;
          }
          ops.push({
            op: "add",
            path: "/relations/-",
            value: {
              rel: "AttachedFile",
              url: u.uploadedUrl,
              attributes: { comment: relationComment },
            },
          });
          result.copied.push(u.filename);
        }

        if (ops.length === 0) {
          // All filenames were already attached and dedupe is on — nothing to PATCH.
          targetResults.push(result);
          continue;
        }

        try {
          await client.patch(
            `/_apis/wit/workitems/${pre.id}`,
            ops,
            "application/json-patch+json",
            "7.0"
          );
        } catch (err) {
          // Move every "copied" filename into "failed" — the PATCH didn't land.
          result.failed.push(...result.copied);
          result.copied = [];
          result.error = err instanceof Error ? err.message : String(err);
        }

        targetResults.push(result);
      }

      // ── Step 4: report ──
      const totalCopied = targetResults.reduce((acc, t) => acc + t.copied.length, 0);
      const totalSkipped = targetResults.reduce((acc, t) => acc + t.skipped.length, 0);
      const totalFailed = targetResults.reduce((acc, t) => acc + t.failed.length, 0);
      const hasAnyFailure = totalFailed > 0 || uploadFailures.length > 0;

      if (!isBulk) {
        const t = targetResults[0];
        const body: Record<string, unknown> = {
          sourceWorkItemId,
          targetWorkItemId: t.id,
          targetUrl: t.webUrl,
          copied: t.copied,
          skipped: t.skipped,
          failed: t.failed,
          uploadFailures,
        };
        if (t.error) body.patchError = t.error;
        return {
          content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
          isError: hasAnyFailure,
        };
      }

      const rows = [
        "| Target TC | Copied | Skipped (duplicate) | Failed | Notes |",
        "| --- | --- | --- | --- | --- |",
        ...targetResults.map((t) => {
          const note = t.error ? `PATCH failed: ${t.error.replace(/\|/g, "\\|")}` : "";
          return `| [${t.id}](${t.webUrl}) | ${t.copied.length} | ${t.skipped.length} | ${t.failed.length} | ${note} |`;
        }),
      ].join("\n");

      const uploadNote = uploadFailures.length > 0
        ? `\n\n⚠️ ${uploadFailures.length} source attachment(s) could not be uploaded and were not copied to any target:\n` +
          uploadFailures.map((u) => `- ${u.filename}: ${u.error}`).join("\n")
        : "";

      const headline = !hasAnyFailure
        ? `✅ SUCCESS: Copied ${uploaded.length} attachment(s) from #${sourceWorkItemId} → ${targetResults.length} target(s). Total: ${totalCopied} copied, ${totalSkipped} skipped (duplicate filenames).`
        : `⚠️ PARTIAL: Source #${sourceWorkItemId} → ${targetResults.length} target(s). Total: ${totalCopied} copied, ${totalSkipped} skipped, ${totalFailed} failed.`;

      return {
        content: [{ type: "text" as const, text: `${headline}\n\n${rows}${uploadNote}` }],
        isError: hasAnyFailure,
      };
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
    /** Hierarchical pre-requisite rows (parent + child markers) — drives proper nested <ol>/<ul> in ADO HTML. */
    preConditionsHierarchy?: Array<{ text: string; isChild: boolean }> | null;
    /** Multi-column structured Pre-requisite table — merges common + per-TC additively. */
    preConditionsTable?: { headers: string[]; rows: string[][] } | null;
    testData?: string | null;
    /** Structured Test Data table — when present, ADO renderer emits a real <table>. */
    testDataTable?: { headers: string[]; rows: string[][] } | null;
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
  /**
   * Suffix-derived category tag (e.g. "REG", "E2E", "SIT"). When provided, the
   * TC title is built as `TC_<usId>_<TAG>_<NN> -> ...` instead of the canonical
   * `TC_<usId>_<NN> -> ...`, AND `getNextTcNumber` is restricted to the matching
   * tag prefix so canonical numbering and per-suffix numbering never collide.
   * `undefined` = canonical (no tag) — preserves today's behaviour exactly.
   */
  categoryTag?: string;
}

export async function createTestCase(
  client: AdoClient,
  params: CreateTestCaseParams,
  config: ConventionsConfig = loadConventionsConfig(),
): Promise<TestCaseResult> {
  const usItem = await client.get<AdoWorkItem>(
    `/_apis/wit/workitems/${params.userStoryId}`,
    "7.0",
    { fields: "System.AreaPath,System.IterationPath" }
  );
  const usAreaPath = (usItem.fields["System.AreaPath"] as string) || "";
  const usIterationPath = (usItem.fields["System.IterationPath"] as string) || "";

  const tcNumber = params.tcNumber ?? await getNextTcNumber(client, params.userStoryId, usAreaPath, config, params.categoryTag);
  // buildTcTitle's `suffix` arg is the lowercase user-facing slug; resolve a
  // canonical hint from the tag (REG → regression, E2E → e2e, …) so canonical
  // tags round-trip cleanly. For non-canonical tags this just returns the
  // lowercased tag, which is good enough for title construction since the
  // resolved TAG via `suffixToTag` will share the same letters.
  const titleSuffix = params.categoryTag ? tagToSuffixHint(params.categoryTag) : undefined;
  const title = buildTcTitle(params.userStoryId, tcNumber, params.featureTags, params.useCaseSummary, config, titleSuffix);
  const description = buildPrerequisitesHtml(params.prerequisites, config);
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
  params: CreateTestCaseParams,
  config: ConventionsConfig = loadConventionsConfig(),
): Promise<TestCaseResult> {
  const titleSuffix = params.categoryTag ? tagToSuffixHint(params.categoryTag) : undefined;
  const title = buildTcTitle(params.userStoryId, params.tcNumber ?? 0, params.featureTags, params.useCaseSummary, config, titleSuffix);
  const prereqHtml = buildPrerequisitesHtml(params.prerequisites, config);
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

/**
 * Compute the next TC number for a user story.
 *
 * Strategy depends on whether `categoryTag` is set:
 *
 * - `categoryTag` undefined (canonical pool): WIQL counts every TC whose title
 *   matches `TC_<usId>_` AND does NOT contain any of the known suffix tags
 *   (`_REG_`, `_E2E_`, `_SIT_`, …). This isolates canonical numbering from
 *   suffixed numbering — a US with 5 canonical TCs and 3 regression TCs
 *   reports `next canonical = 6`, NOT 9. Defense-in-depth: even after the
 *   WIQL filter, we still resolve titles via the parser and drop any whose
 *   `categoryTag` is non-empty (catches edge cases where a tag is embedded
 *   in a way the WIQL `NOT CONTAINS` regex misses, e.g. casing differences).
 *
 * - `categoryTag` set (per-suffix pool): WIQL counts only TCs whose title
 *   matches `TC_<usId>_<TAG>_` exactly. Numbering restarts at 1 per tag,
 *   matching the .mdc rule that each suffixed file has its own independent
 *   numbering.
 *
 * Falls back to 1 on WIQL error so first-push is never blocked by a transient
 * fetch failure (matches the pre-existing behaviour).
 */
async function getNextTcNumber(
  client: AdoClient,
  usId: number,
  areaPath: string,
  config: ConventionsConfig,
  categoryTag?: string,
): Promise<number> {
  // The WIQL prefix mirrors `suiteStructure.tcTitlePrefix` so the lookup
  // matches whatever the team uses for query-based suites.
  const prefix = config.suiteStructure.tcTitlePrefix ?? "TC";

  let queryWhere: string;
  if (categoryTag) {
    queryWhere =
      `WHERE [System.WorkItemType] = 'Test Case' ` +
      `AND [System.AreaPath] UNDER '${areaPath}' ` +
      `AND [System.Title] CONTAINS '${prefix}_${usId}_${categoryTag}_'`;
  } else {
    // Subtract every known suffix tag from the canonical pool. WIQL doesn't
    // support regex so we chain `NOT CONTAINS` for each known tag — that's
    // correct for the documented tags (REG, E2E, SIT, UAT, SMOKE, PERF) and
    // falls back gracefully for unknown tags via the JS post-filter below.
    const notContainsClauses = ALL_KNOWN_TAGS
      .map((tag) => `AND [System.Title] NOT CONTAINS '_${tag}_'`)
      .join(" ");
    queryWhere =
      `WHERE [System.WorkItemType] = 'Test Case' ` +
      `AND [System.AreaPath] UNDER '${areaPath}' ` +
      `AND [System.Title] CONTAINS '${prefix}_${usId}_' ` +
      notContainsClauses;
  }

  const wiql = {
    query:
      `SELECT [System.Id] FROM WorkItems ` +
      queryWhere +
      ` ORDER BY [System.Title] DESC`,
  };

  try {
    const result = await client.post<{ workItems: Array<{ id: number }> }>(
      "/_apis/wit/wiql",
      wiql,
      "application/json",
      "7.0"
    );
    const ids = result.workItems ?? [];

    if (categoryTag || ids.length === 0) {
      // Per-suffix path: WIQL is precise (CONTAINS the exact `_<TAG>_` segment),
      // no JS post-filter needed. Empty result also short-circuits to 1.
      return ids.length + 1;
    }

    // Canonical path: defense-in-depth post-filter to drop any title whose
    // parsed `categoryTag` is non-empty. Fetches titles for the matched IDs
    // (single batched call) and runs the title-parser regex.
    if (ids.length === 0) return 1;
    const idList = ids.map((w) => w.id).join(",");
    try {
      const fetched = await client.get<{ value: AdoWorkItem[] }>(
        `/_apis/wit/workitems`,
        "7.0",
        { ids: idList, fields: "System.Title" },
      );
      const items = fetched.value ?? [];
      // Tag charset matches parser's: `[A-Z][A-Z0-9]{1,4}` so E2E (digits in tag)
      // is captured as a tag and dropped, not counted as canonical.
      const tcRe = new RegExp(`^${prefix}_${usId}(?:_([A-Z][A-Z0-9]{1,4}))?_(\\d+)\\b`);
      let canonicalCount = 0;
      for (const item of items) {
        const title = (item.fields?.["System.Title"] as string) ?? "";
        const m = title.match(tcRe);
        // Only count titles that match canonical shape AND have no tag captured.
        if (m && !m[1]) canonicalCount += 1;
      }
      return canonicalCount + 1;
    } catch {
      // If the title-fetch fails, fall back to the WIQL count — WIQL's
      // NOT CONTAINS chain already excludes known tags, so this is still
      // safe. The post-filter is purely belt-and-suspenders.
      return ids.length + 1;
    }
  } catch {
    return 1;
  }
}
