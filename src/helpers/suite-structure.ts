import { loadConventionsConfig } from "../config.ts";

/**
 * Build a sprint folder name from the sprint number.
 */
export function buildSprintFolderName(sprintNumber: number): string {
  const config = loadConventionsConfig();
  return `${config.suiteStructure.sprintPrefix}${sprintNumber}`;
}

/**
 * Build a parent US / EPIC folder name.
 */
export function buildParentUsFolderName(parentId: number, parentTitle: string): string {
  const config = loadConventionsConfig();
  const { parentUsSeparator } = config.suiteStructure;
  return `${parentId}${parentUsSeparator}${parentTitle}`;
}

/**
 * Build a US-level folder name.
 */
export function buildUsFolderName(usId: number, usTitle: string): string {
  const config = loadConventionsConfig();
  const { parentUsSeparator } = config.suiteStructure;
  return `${usId}${parentUsSeparator}${usTitle}`;
}

/**
 * Get the non-epic folder name from config.
 */
export function getNonEpicFolderName(): string {
  const config = loadConventionsConfig();
  return config.suiteStructure.nonEpicFolderName;
}

/**
 * Resolve test plan ID from User Story AreaPath using testPlanMapping.
 * First matching rule wins. Throws if no match.
 */
export function resolvePlanIdFromAreaPath(areaPath: string): number {
  const config = loadConventionsConfig();
  const mapping = config.suiteStructure.testPlanMapping;
  if (!mapping?.length) {
    throw new Error(
      "testPlanMapping not configured in conventions.config.json. Add suiteStructure.testPlanMapping with planId and areaPathContains for GPT_D-HUB and GPT_E-HUB."
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
    `No test plan match for AreaPath "${areaPath}". Check suiteStructure.testPlanMapping in conventions.config.json.`
  );
}

/**
 * Extract sprint number from Iteration path (e.g. "SFTPM_24" -> 24).
 */
export function resolveSprintFromIteration(iterationPath: string): number {
  const config = loadConventionsConfig();
  const prefix = config.suiteStructure.sprintPrefix;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = iterationPath.match(new RegExp(`${escaped}(\\d+)`, "i"));
  if (!match) {
    throw new Error(
      `Could not extract sprint from Iteration "${iterationPath}". Expected pattern like SFTPM_24.`
    );
  }
  return parseInt(match[1], 10);
}

/**
 * Build the WIQL query string for a query-based test suite
 * that auto-links test cases by title pattern.
 */
export function buildSuiteQueryString(usId: number, areaPath: string): string {
  return (
    `SELECT [System.Id] FROM WorkItems ` +
    `WHERE [System.WorkItemType] IN GROUP 'Microsoft.TestCaseCategory' ` +
    `AND [System.AreaPath] UNDER '${areaPath}' ` +
    `AND [System.Title] CONTAINS 'TC_${usId}'`
  );
}
