import { loadConventionsConfig } from "../config.ts";
import type { ConventionsConfig } from "../types.ts";
import { suffixToTag } from "./suffix-tag.ts";

const ADO_TITLE_MAX = 256;

/**
 * Builds a test case title following the configured convention.
 * Default: TC_<USID>_<##> -> <FeatureTag> -> ... -> <Summary>
 * Truncates with ellipsis if exceeding ADO 256-character limit.
 *
 * `config` is optional during the migration. Tool handlers that have
 * already resolved the workspace via roots/list MUST pass it explicitly
 * so the title prefix reflects the tenant's `<workspace>/.vortex-ado/
 * config.json`. The cwd-based fallback exists only for callers not yet
 * migrated; it will be removed in Phase 4.
 *
 * `suffix` is the optional user-facing slug (regression, e2e, sit, …)
 * that opts the TC into a parallel suffixed draft. When set, the
 * resolved category TAG (REG, E2E, SIT, …) is embedded between the US
 * ID and the TC number, producing `TC_<USID>_<TAG>_<##> -> …`. When
 * absent or undefined, the title shape is unchanged (canonical draft).
 */
export function buildTcTitle(
  usId: number,
  tcNumber: number,
  featureTags: string[],
  summary: string,
  config: ConventionsConfig = loadConventionsConfig(),
  suffix?: string,
): string {
  const { prefix, separator, numberPadding, maxLength = ADO_TITLE_MAX } = config.testCaseTitle;
  const paddedNum = String(tcNumber).padStart(numberPadding, "0");
  const tagChain = featureTags.join(separator);
  const tag = suffixToTag(suffix);
  const idSegment = tag ? `${prefix}_${usId}_${tag}_${paddedNum}` : `${prefix}_${usId}_${paddedNum}`;
  const title = `${idSegment}${separator}${tagChain}${separator}${summary}`;
  return title.length > maxLength ? title.slice(0, maxLength - 3) + "..." : title;
}
