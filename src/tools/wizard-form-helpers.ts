/**
 * Pure helpers used by the Phase 2 Conventions wizard (Tab 2).
 *
 * These are mirrored verbatim inside the inline `<script>` block in
 * `configure-ui.ts`'s `getHtmlContent()`. Keeping a typed copy here
 * lets us unit-test the diff and persona-key logic without spinning
 * up a browser. If you change one copy, change the other — the
 * matching browser definitions live near `function canonicalize(v)`
 * and `function derivePersonaKey(...)` in `configure-ui.ts`.
 */

/**
 * Stable canonicalization for diff comparison.
 * - Sorts object keys.
 * - Strips empty strings, empty arrays, and empty objects.
 * - Trims strings.
 *
 * Two payloads that differ only by whitespace, key order, or
 * empty-vs-missing fields canonicalize to the same value.
 */
export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(canonicalize).filter((x) => x !== undefined);
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    const obj = v as Record<string, unknown>;
    Object.keys(obj)
      .sort()
      .forEach((k) => {
        const val = canonicalize(obj[k]);
        if (
          val !== undefined &&
          val !== "" &&
          !(Array.isArray(val) && val.length === 0) &&
          !(typeof val === "object" && val !== null && Object.keys(val as object).length === 0)
        ) {
          out[k] = val;
        }
      });
    return out;
  }
  if (typeof v === "string") return v.trim();
  return v;
}

/**
 * True iff the current form payload differs from the snapshot in any
 * meaningful way (after canonicalization). A null/undefined snapshot
 * always counts as "changed" (initial state, no baseline yet).
 */
export function isFormChanged(snapshot: unknown, current: unknown): boolean {
  if (snapshot === null || snapshot === undefined) return true;
  return JSON.stringify(canonicalize(current)) !== JSON.stringify(canonicalize(snapshot));
}

/**
 * Derive a JSON-safe key from a persona's display label.
 *   "Key Account Manager (KAM) User" → "KeyAccountManagerKAMUser"
 *   "***" → "Persona{fallbackIndex+1}"
 *
 * Strips every non-alphanumeric. If the label has no alphanumerics,
 * falls back to a positional default so the output is always a valid
 * JSON key.
 */
export function derivePersonaKey(label: string, fallbackIndex: number): string {
  const cleaned = String(label || "").replace(/[^A-Za-z0-9]/g, "");
  return cleaned || `Persona${fallbackIndex + 1}`;
}

/**
 * Disambiguate a persona key against existing entries by appending
 * an integer suffix (2, 3, …) until unique. The `editingKey` argument
 * lets in-place edits keep their existing key — i.e. when re-saving
 * a persona without changing its label, we don't want to bump it to
 * `Foo2`.
 *
 * Examples:
 *   assignUniquePersonaKey([],            "Admin", null)   → "Admin"
 *   assignUniquePersonaKey(["Admin"],     "Admin", null)   → "Admin2"
 *   assignUniquePersonaKey(["Admin","Admin2"], "Admin", null) → "Admin3"
 *   assignUniquePersonaKey(["Admin"],     "Admin", "Admin") → "Admin"  (edit)
 */
export function assignUniquePersonaKey(
  existingKeys: readonly string[],
  baseKey: string,
  editingKey: string | null,
): string {
  const set = new Set(existingKeys);
  let unique = baseKey;
  let suffix = 2;
  while (set.has(unique) && unique !== editingKey) {
    unique = baseKey + suffix;
    suffix += 1;
  }
  return unique;
}

/**
 * Shape of a plan-mapping row read from the DOM. The browser builds
 * one of these per row and passes the array to `serializePlanMapping`
 * so the pure logic — checked-state filter, fragment splitting, manual
 * planId validation — is testable without the DOM.
 */
export type RawPlanRow = {
  checked: boolean;
  /** When true, planId comes from the manual <input type="number">. */
  manual: boolean;
  /** Raw planId from dataset (probed rows) or input value (manual). */
  rawPlanId: string;
  /** Raw fragment string before splitting on commas. */
  rawFragment: string;
};

export type SerializedPlanMapping = {
  planId: number;
  areaPathContains: string[];
};

/**
 * Pure serializer for plan-mapping rows. Drops:
 *   - Unchecked rows.
 *   - Manual rows whose planId is NaN, ≤0, or unparseable.
 *   - Probed rows whose dataset planId is unparseable (shouldn't happen,
 *     but be defensive).
 *
 * Keeps checked rows even when the fragment is empty — produces an
 * `areaPathContains: []` so the user's checkbox state survives a reload
 * even before they've typed a fragment. (Bugfix mirror of the browser
 * serializer.)
 */
export function serializePlanMapping(rows: readonly RawPlanRow[]): SerializedPlanMapping[] {
  const out: SerializedPlanMapping[] = [];
  for (const row of rows) {
    if (!row.checked) continue;
    const planId = parseInt(row.rawPlanId, 10);
    if (isNaN(planId)) continue;
    if (row.manual && planId <= 0) continue;
    const frag = (row.rawFragment || "").trim();
    const areaPathContains = frag
      ? frag
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    out.push({ planId, areaPathContains });
  }
  return out;
}
