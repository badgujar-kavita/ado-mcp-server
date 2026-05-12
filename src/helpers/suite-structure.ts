import { loadConventionsConfig } from "../config.ts";
import type { ConventionsConfig } from "../types.ts";

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
