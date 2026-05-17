import { loadConventionsConfig } from "../config.ts";
import type { AdoClient } from "../ado-client.ts";
import type {
  AdoTestPlanListResponse,
  AdoTestSuiteListResponse,
  AdoWorkItem,
  ConventionsConfig,
} from "../types.ts";

/**
 * Suite-structure helpers — every function here reads `config.suiteStructure.*`.
 * `config` is OPTIONAL during the workspace-aware migration; tool handlers that
 * already resolved the workspace via roots/list MUST pass it explicitly so the
 * rules reflect the tenant's `<workspace>/.vortex-ado/config.json`. The cwd
 * fallback exists only so unmigrated callers keep working until Phase 4 makes
 * the argument required and deletes `loadConventionsConfig()` entirely.
 */

/**
 * Build a sprint folder name from the sprint number.
 */
export function buildSprintFolderName(
  sprintNumber: number,
  config: ConventionsConfig = loadConventionsConfig(),
): string {
  return `${config.suiteStructure.sprintPrefix}${sprintNumber}`;
}

/**
 * Build a parent US / EPIC folder name.
 */
export function buildParentUsFolderName(
  parentId: number,
  parentTitle: string,
  config: ConventionsConfig = loadConventionsConfig(),
): string {
  const { parentUsSeparator } = config.suiteStructure;
  return `${parentId}${parentUsSeparator}${parentTitle}`;
}

/**
 * Build a US-level folder name.
 */
export function buildUsFolderName(
  usId: number,
  usTitle: string,
  config: ConventionsConfig = loadConventionsConfig(),
): string {
  const { parentUsSeparator } = config.suiteStructure;
  return `${usId}${parentUsSeparator}${usTitle}`;
}

/**
 * Get the non-epic folder name from config.
 */
export function getNonEpicFolderName(
  config: ConventionsConfig = loadConventionsConfig(),
): string {
  return config.suiteStructure.nonEpicFolderName;
}

/**
 * Resolve test plan ID from User Story AreaPath using testPlanMapping.
 * First matching rule wins. Throws if no match.
 */
export function resolvePlanIdFromAreaPath(
  areaPath: string,
  config: ConventionsConfig = loadConventionsConfig(),
): number {
  const mapping = config.suiteStructure.testPlanMapping;
  if (!mapping?.length) {
    throw new Error(
      "testPlanMapping not configured. Add suiteStructure.testPlanMapping entries with planId and areaPathContains for each test plan your team uses (in <workspace>/.vortex-ado/config.json — Tab 2 of /ado-connect)."
    );
  }
  const normalized = areaPath.toLowerCase();
  for (const rule of mapping) {
    const patterns = Array.isArray(rule.areaPathContains) ? rule.areaPathContains : [rule.areaPathContains];
    if (patterns.some((p) => normalized.includes(p.toLowerCase()))) {
      return rule.planId;
    }
  }
  throw new Error(
    `No test plan match for AreaPath "${areaPath}". Check suiteStructure.testPlanMapping in <workspace>/.vortex-ado/config.json.`
  );
}

/**
 * Fallback plan resolver: when `resolvePlanIdFromAreaPath` can't match the US's
 * AreaPath against any `testPlanMapping` entry, look at the US's existing
 * "Tested By" linkages and find which test plan already houses those TCs.
 *
 * Why this exists: tenants often configure `testPlanMapping` with patterns
 * narrower than the AreaPath returned for some User Stories (e.g. mapping is
 * keyed on a sub-area like `Salesforce_TPM_Global Product`, but a US lives on
 * the parent area `TPM Product Ecosystem`). When that US already has TCs in
 * ADO, the right plan is determinable — it's the one whose suite tree contains
 * the existing TCs. Falling back to that plan lets a (re)publish proceed
 * without forcing the user to figure out a plan ID by hand.
 *
 * Resolution strategy:
 *   1. Read the US's relations and pull TestedBy / TestedBy-Forward TC IDs.
 *   2. List all plans in the project. For each plan, list its suites and
 *      check whether any suite's name contains the US ID as a whole-number
 *      token (same matcher as `usSuiteExists`).
 *   3. The first plan whose suite tree contains a US-keyed suite wins.
 *
 * Returns null if:
 *   - the US has no TestedBy linkages (no plan to derive from), OR
 *   - none of the project's plans contain a suite for this US.
 *
 * Failures (network, permission) are swallowed and surfaced as null so the
 * caller can fall back to the existing "ask the user for a planId" gate.
 */
export async function resolvePlanIdFromExistingLinkedTcs(
  client: AdoClient,
  userStoryId: number,
): Promise<number | null> {
  try {
    const us = await client.get<AdoWorkItem>(
      `/_apis/wit/workitems/${userStoryId}`,
      "7.0",
      { "$expand": "relations" },
    );
    const linkedIds = (us.relations ?? [])
      .filter(
        (r) =>
          r.rel === "Microsoft.VSTS.Common.TestedBy" ||
          r.rel === "Microsoft.VSTS.Common.TestedBy-Forward",
      )
      .map((r) => {
        const parts = r.url.split("/");
        const id = parseInt(parts[parts.length - 1], 10);
        return isNaN(id) ? null : id;
      })
      .filter((id): id is number => id != null);

    if (linkedIds.length === 0) return null;

    const plansResp = await client.get<AdoTestPlanListResponse>(
      "/_apis/testplan/plans",
      "7.1",
    );
    const plans = plansResp.value ?? [];
    if (plans.length === 0) return null;

    const idStr = String(userStoryId);
    const tokenRe = new RegExp(`(^|[^0-9])${idStr}([^0-9]|$)`);

    for (const plan of plans) {
      try {
        const suites = await client.get<AdoTestSuiteListResponse>(
          `/_apis/testplan/Plans/${plan.id}/suites`,
          "7.1",
        );
        const matched = (suites.value ?? []).some((s) =>
          tokenRe.test(s.name ?? ""),
        );
        if (matched) return plan.id;
      } catch {
        // Plan unreadable (permissions / transient) — keep scanning.
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract sprint number from Iteration path using `suiteStructure.sprintPrefix`
 * from config (e.g. with prefix "Sprint_", `"Sprint_12"` → 12).
 */
export function resolveSprintFromIteration(
  iterationPath: string,
  config: ConventionsConfig = loadConventionsConfig(),
): number {
  const prefix = config.suiteStructure.sprintPrefix;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = iterationPath.match(new RegExp(`${escaped}(\\d+)`, "i"));
  if (!match) {
    throw new Error(
      `Could not extract sprint from Iteration "${iterationPath}". Expected pattern like Sprint_12.`
    );
  }
  return parseInt(match[1], 10);
}

/**
 * Build the WIQL query string for a query-based test suite
 * that auto-links test cases by title pattern.
 */
export function buildSuiteQueryString(
  usId: number,
  areaPath: string,
  config: ConventionsConfig = loadConventionsConfig(),
): string {
  const prefix = config.suiteStructure.tcTitlePrefix ?? "TC";
  return (
    `SELECT [System.Id] FROM WorkItems ` +
    `WHERE [System.WorkItemType] IN GROUP 'Microsoft.TestCaseCategory' ` +
    `AND [System.AreaPath] UNDER '${areaPath}' ` +
    `AND [System.Title] CONTAINS '${prefix}_${usId}'`
  );
}
