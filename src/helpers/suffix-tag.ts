/**
 * Suffix → category-tag mapping for the multi-test-type draft/publish flow.
 *
 * The canonical (default) draft has NO suffix and NO category tag — TC titles
 * stay `TC_<usId>_<NN> -> ...`. When a user opts into a parallel draft (via
 * `/qa-draft <usId> suffix=regression`), the suffix maps to a SHORT uppercase
 * tag that gets embedded in TC titles, e.g. `TC_<usId>_REG_<NN> -> ...`.
 *
 * Why a separate concept from "suffix":
 *   - The SUFFIX is the user-facing slug used in filenames + ledger keys
 *     (lowercase, hyphen/underscore allowed). It's stable across renames.
 *   - The TAG is the all-caps, ASCII-only segment that lives INSIDE TC titles
 *     and is searchable both in WIQL and in the ADO UI. It's brevity-first
 *     (2-5 chars) because it appears in every test-case name.
 *
 * Mapping is HARD-CODED for the canonical names so cross-team consistency is
 * preserved (REG searches, E2E searches always work). For any other suffix
 * we fall back to a deterministic 5-char uppercase truncation of the
 * `[A-Z0-9]` characters in the suffix — kept short to leave room for the rest
 * of the title.
 */

/** Canonical suffix → category-tag table. Order matters only for docs. */
const CANONICAL_SUFFIX_TO_TAG: Record<string, string> = {
  regression: "REG",
  e2e: "E2E",
  sit: "SIT",
  uat: "UAT",
  smoke: "SMOKE",
  performance: "PERF",
};

/**
 * The complete set of TAGS the canonical map can produce. Used by
 * `getNextTcNumber` (without categoryTag) to subtract any suffixed TCs from
 * the canonical numbering pool: WIQL `NOT CONTAINS '_REG_'` etc.
 *
 * Tags are uppercase. Each tag here corresponds to a real `_<TAG>_` segment
 * the title regex would capture.
 */
export const ALL_KNOWN_TAGS: readonly string[] = Object.freeze(
  Array.from(new Set(Object.values(CANONICAL_SUFFIX_TO_TAG))),
);

/**
 * Validates a suffix per the rule documented in `tenant-rules-examples/qa.mdc`:
 * lowercase ASCII letters, digits, hyphen, underscore. Empty / undefined are
 * accepted (signals "canonical, no suffix"); explicit empty string is rejected
 * because it's almost always a programming mistake (an unset suffix is
 * `undefined`, not `""`).
 *
 * Throws a `TypeError` with a clear message when the suffix is invalid. Caller
 * decides how to surface that to the user (typically as the tool's error
 * response — the suffix is user-controlled input).
 */
export function assertValidSuffix(suffix: string | undefined | null): void {
  if (suffix === undefined || suffix === null) return; // canonical
  if (typeof suffix !== "string") {
    throw new TypeError(
      `Invalid suffix: expected string, got ${typeof suffix}.`,
    );
  }
  if (suffix === "") {
    throw new TypeError(
      `Invalid suffix: empty string. Pass undefined for the canonical (no-suffix) draft.`,
    );
  }
  if (!/^[a-z0-9_-]+$/.test(suffix)) {
    throw new TypeError(
      `Invalid suffix '${suffix}'. Suffixes must match /^[a-z0-9_-]+$/ — ` +
        `lowercase letters, digits, hyphen, or underscore only.`,
    );
  }
}

/**
 * Resolve a suffix to its uppercase category tag.
 *
 * - `undefined` → returns `undefined` (canonical draft, no tag in title).
 * - Canonical names (regression, e2e, sit, uat, smoke, performance) →
 *   the short tag from the table above (REG, E2E, SIT, UAT, SMOKE, PERF).
 * - Anything else → uppercase ASCII letters/digits from the suffix, capped
 *   at 5 characters. Hyphens and underscores are stripped (tags are pure
 *   ASCII letter/digit segments — they live inside TC titles separated by
 *   underscores, so internal punctuation would confuse the parser regex).
 *
 * Throws via `assertValidSuffix` when the suffix doesn't satisfy the regex.
 */
export function suffixToTag(suffix: string | undefined | null): string | undefined {
  if (suffix === undefined || suffix === null) return undefined;
  assertValidSuffix(suffix);
  const lower = suffix.toLowerCase();
  const canonical = CANONICAL_SUFFIX_TO_TAG[lower];
  if (canonical) return canonical;

  // Custom suffix: take only [A-Z0-9] chars (drop hyphens/underscores), cap at 5.
  // If the entire suffix is punctuation (e.g. "--"), that's still a valid suffix
  // for filename purposes but it can't carry a meaningful tag — return a
  // deterministic placeholder rather than throwing, so the caller's title is
  // still constructable. In practice the .mdc rules prevent agents from
  // picking such suffixes, but we don't want a parser crash if one slips in.
  const tag = lower.replace(/[^a-z0-9]/g, "").toUpperCase().slice(0, 5);
  return tag.length > 0 ? tag : "X";
}

/**
 * Reverse mapping: given a canonical TAG (REG, E2E, SIT, …), return the
 * canonical SUFFIX (regression, e2e, sit, …). For non-canonical tags, returns
 * the lowercased tag — round-tripping `suffixToTag(tagToSuffixHint(tag))` may
 * not produce the original tag if the tag wasn't canonical, but that's OK:
 * the test-cases.ts caller uses this only as a stable input to `buildTcTitle`
 * which itself re-resolves the tag. The contract is "produce *some* lowercase
 * suffix that resolves back to this tag (canonical) or to a tag with the
 * same first 5 letters (custom)".
 *
 * Used by createTestCase / updateTestCaseFromParams to feed `buildTcTitle`'s
 * `suffix` arg from the `categoryTag` they receive — keeps the title-building
 * code path single-source-of-truth on `suffixToTag`.
 */
const TAG_TO_SUFFIX: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_SUFFIX_TO_TAG).map(([s, t]) => [t, s]),
);
export function tagToSuffixHint(tag: string): string {
  if (!tag) return tag;
  return TAG_TO_SUFFIX[tag.toUpperCase()] ?? tag.toLowerCase();
}

/**
 * Strict inverse of `suffixToTag`.
 *
 * - Canonical TAGs (REG, E2E, SIT, UAT, SMOKE, PERF) → the canonical lowercase
 *   suffix (regression, e2e, sit, uat, smoke, performance).
 * - Empty / nullish input → `undefined`.
 * - Unknown TAGs → the lowercased tag as a best-effort suffix. This is good
 *   enough for `buildTcTitle`'s round-trip needs because `suffixToTag` will
 *   re-resolve the lowercased tag back to a TAG with the same first 5 letters.
 *
 * Used by `qa_tc_update`'s reconstruction path to convert a parsed `categoryTag`
 * (e.g. `REG`) back into the suffix that `buildTcTitle` expects.
 */
export function tagToSuffix(tag: string | undefined | null): string | undefined {
  if (tag === undefined || tag === null || tag === "") return undefined;
  if (typeof tag !== "string") return undefined;
  return TAG_TO_SUFFIX[tag.toUpperCase()] ?? tag.toLowerCase();
}
