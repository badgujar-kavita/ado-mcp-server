/**
 * Tag resolution for qa_publish_push.
 *
 * Match-only policy: never creates new ADO tags. Requested tags (from title-prefix
 * category OR an explicit `**Tags**` metadata row) are matched case-insensitively
 * against the project's existing tag list. Only matches are applied; misses are
 * logged as warnings and skipped.
 *
 * Tenants without tag-creation permission are safe; the title-prefix category
 * remains the WIQL-filterable fallback for uncategorized tags.
 */

/** Known category prefixes recognised in TC titles (first arrow segment). */
const DEFAULT_KNOWN_CATEGORIES = [
  "Regression",
  "SIT",
  "E2E",
  "Smoke",
  "Accessibility",
  "Performance",
  "Security",
];

/**
 * Extract the category prefix from a TC title's first arrow segment, if present.
 * Returns null for standard functional TCs (no recognized category prefix).
 */
export function extractCategoryFromTitle(
  title: string,
  knownCategories: string[] = DEFAULT_KNOWN_CATEGORIES,
): string | null {
  // Title format: TC_<usid>_<nn> -> <segment1> -> <segment2> ... -> <summary>
  const match = title.match(/^TC_\d+_\d+\s*(?:->|→)\s*([^-→][^->→]*?)\s*(?:->|→)/);
  if (!match) return null;
  const firstSegment = match[1].trim();
  // Case-insensitive match against known categories
  const matched = knownCategories.find((c) => c.toLowerCase() === firstSegment.toLowerCase());
  return matched ?? null;
}

/**
 * Resolve which tags should be applied to a TC.
 *
 * @param requestedTags — tags derived from the draft (title-prefix + explicit `**Tags**` row)
 * @param projectTags  — existing tags in the ADO project (from AdoClient.listProjectTags())
 * @returns matched tags (preserving original casing from project), plus warnings for unmatched
 */
export function resolveTagsMatchOnly(
  requestedTags: string[],
  projectTags: string[],
): { matched: string[]; skipped: string[] } {
  // Dedupe requested tags (case-insensitive)
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const t of requestedTags) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(t);
  }

  // Build a case-insensitive lookup into projectTags
  const projectByLower = new Map<string, string>();
  for (const pt of projectTags) projectByLower.set(pt.toLowerCase(), pt);

  const matched: string[] = [];
  const skipped: string[] = [];
  for (const req of deduped) {
    const hit = projectByLower.get(req.toLowerCase());
    if (hit) {
      matched.push(hit); // preserve project casing for consistency
    } else {
      skipped.push(req);
    }
  }

  return { matched, skipped };
}

/**
 * Format matched tags into the ADO System.Tags value shape.
 * ADO uses semicolon-separated tags with a space after each separator.
 */
export function formatAdoTags(matched: string[]): string {
  return matched.join("; ");
}
