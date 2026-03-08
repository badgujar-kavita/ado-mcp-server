import { loadConventionsConfig } from "../config.ts";

const ADO_TITLE_MAX = 256;

/**
 * Builds a test case title following the configured convention.
 * Default: TC_<USID>_<##> -> <FeatureTag> -> ... -> <Summary>
 * Truncates with ellipsis if exceeding ADO 256-character limit.
 */
export function buildTcTitle(
  usId: number,
  tcNumber: number,
  featureTags: string[],
  summary: string
): string {
  const config = loadConventionsConfig();
  const { prefix, separator, numberPadding, maxLength = ADO_TITLE_MAX } = config.testCaseTitle;
  const paddedNum = String(tcNumber).padStart(numberPadding, "0");
  const tagChain = featureTags.join(separator);
  const title = `${prefix}_${usId}_${paddedNum}${separator}${tagChain}${separator}${summary}`;
  return title.length > maxLength ? title.slice(0, maxLength - 3) + "..." : title;
}
