import { loadConventionsConfig } from "../config.ts";
import type { AdoClient } from "../ado-client.ts";
import type {
  AdoTestPlanListResponse,
  AdoTestSuiteListResponse,
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
 * AreaPath against any `testPlanMapping` entry, scan the project's test plans
 * and return the one whose suite tree already contains a suite for this US.
 *
 * Why this exists: tenants often configure `testPlanMapping` with patterns
 * narrower than the AreaPath returned for some User Stories (e.g. mapping is
 * keyed on a sub-area like `Salesforce_TPM_Global Product`, but a US lives on
 * the parent area `TPM Product Ecosystem`). When the canonical pack has
 * already published — leaving a US-level suite somewhere in the project — the
 * right plan is determinable: the one containing that suite. This lets a
 * (re)publish or suffixed publish proceed without forcing the user to figure
 * out a plan ID by hand.
 *
 * Resolution strategy:
 *   1. List all plans in the project.
 *   2. For each plan, list its suites and check whether any suite's name
 *      contains the US ID as a whole-number token. The whole-number boundary
 *      check rejects substring-of-larger-id false positives (e.g. searching
 *      for `1377028` will NOT match `13770281` or `21377028`).
 *   3. The first plan whose suite tree contains a US-keyed suite wins.
 *
 * Note on relation-independence: ADO query-based suites match test cases via
 * WIQL title patterns, NOT via `TestedBy` work-item relations. A US can have
 * a fully populated US-level suite even when no `TestedBy` link exists on the
 * work item itself. We therefore do NOT gate this scan on the US's relations
 * — the suite-tree match is the authoritative signal.
 *
 * Returns null when no plan in the project contains a US-keyed suite.
 * Per-plan failures (network, permission) are swallowed and the scan
 * continues; total failures (project plans unreachable) return null so the
 * caller can fall back to the existing "ask the user for a planId" gate.
 */
export async function resolvePlanIdFromExistingUsSuite(
  client: AdoClient,
  userStoryId: number,
): Promise<number | null> {
  try {
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
