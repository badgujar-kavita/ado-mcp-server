/**
 * Unit tests for the pure frontend helpers extracted from the
 * Conventions wizard. The browser-side copy lives inside the inline
 * `<script>` in `configure-ui.ts`'s `getHtmlContent()` and must
 * stay in sync with this module.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalize,
  isFormChanged,
  derivePersonaKey,
  assignUniquePersonaKey,
  serializePlanMapping,
  type RawPlanRow,
} from "./wizard-form-helpers.ts";

// ── canonicalize ────────────────────────────────────────────────────────

test("canonicalize: sorts object keys", () => {
  const a = canonicalize({ b: 1, a: 2, c: 3 });
  assert.deepEqual(Object.keys(a as object), ["a", "b", "c"]);
});

test("canonicalize: trims strings", () => {
  assert.equal(canonicalize("  hello  "), "hello");
});

test("canonicalize: strips empty strings from objects", () => {
  assert.deepEqual(canonicalize({ a: "", b: "x" }), { b: "x" });
});

test("canonicalize: strips empty arrays from objects", () => {
  assert.deepEqual(canonicalize({ a: [], b: [1] }), { b: [1] });
});

test("canonicalize: strips empty objects from objects", () => {
  assert.deepEqual(canonicalize({ a: {}, b: { x: 1 } }), { b: { x: 1 } });
});

test("canonicalize: keeps null and false values", () => {
  // Why: null/false are meaningful (e.g. `fetchLinks: false`); only
  // empty containers/strings are stripped.
  assert.deepEqual(canonicalize({ a: null, b: false, c: 0 }), {
    a: null,
    b: false,
    c: 0,
  });
});

test("canonicalize: filters undefined out of arrays", () => {
  assert.deepEqual(canonicalize([1, undefined, 2]), [1, 2]);
});

test("canonicalize: recurses into nested objects and arrays", () => {
  const result = canonicalize({
    z: [{ b: "  trim  ", a: "" }, { c: "keep" }],
    a: { nested: { deep: "x", empty: "" } },
  });
  assert.deepEqual(result, {
    a: { nested: { deep: "x" } },
    z: [{ b: "trim" }, { c: "keep" }],
  });
});

test("canonicalize: a key+value pair that strips to empty disappears", () => {
  // After trim, "  " becomes "" which is dropped — the parent key is
  // skipped, not preserved with an empty value.
  assert.deepEqual(canonicalize({ a: "  ", b: "y" }), { b: "y" });
});

// ── isFormChanged ───────────────────────────────────────────────────────

test("isFormChanged: null snapshot is always changed", () => {
  assert.equal(isFormChanged(null, { a: 1 }), true);
});

test("isFormChanged: undefined snapshot is always changed", () => {
  assert.equal(isFormChanged(undefined, { a: 1 }), true);
});

test("isFormChanged: identical payloads are unchanged", () => {
  const snap = { a: 1, b: "x" };
  assert.equal(isFormChanged(snap, { a: 1, b: "x" }), false);
});

test("isFormChanged: key-order differences are unchanged", () => {
  assert.equal(isFormChanged({ a: 1, b: 2 }, { b: 2, a: 1 }), false);
});

test("isFormChanged: whitespace-only differences are unchanged", () => {
  assert.equal(isFormChanged({ a: "x" }, { a: "  x  " }), false);
});

test("isFormChanged: empty-string vs missing field is unchanged", () => {
  // "" gets stripped during canonicalization, so a snapshot without
  // the field equals a current value with empty string.
  assert.equal(isFormChanged({ a: "x" }, { a: "x", b: "" }), false);
});

test("isFormChanged: empty-array vs missing field is unchanged", () => {
  assert.equal(isFormChanged({ a: 1 }, { a: 1, list: [] }), false);
});

test("isFormChanged: real value change is detected", () => {
  assert.equal(isFormChanged({ a: 1 }, { a: 2 }), true);
});

test("isFormChanged: nested value change is detected", () => {
  assert.equal(
    isFormChanged({ outer: { inner: "old" } }, { outer: { inner: "new" } }),
    true,
  );
});

// ── derivePersonaKey ────────────────────────────────────────────────────

test("derivePersonaKey: strips spaces and punctuation", () => {
  assert.equal(derivePersonaKey("Sales Operations Lead", 0), "SalesOperationsLead");
});

test("derivePersonaKey: keeps parens content alphanumerically", () => {
  assert.equal(
    derivePersonaKey("Key Account Manager (KAM) User", 0),
    "KeyAccountManagerKAMUser",
  );
});

test("derivePersonaKey: keeps digits", () => {
  assert.equal(derivePersonaKey("Tier-1 Support", 0), "Tier1Support");
});

test("derivePersonaKey: empty label uses positional fallback", () => {
  assert.equal(derivePersonaKey("", 0), "Persona1");
  assert.equal(derivePersonaKey("", 4), "Persona5");
});

test("derivePersonaKey: all-punctuation label uses positional fallback", () => {
  assert.equal(derivePersonaKey("***", 2), "Persona3");
});

test("derivePersonaKey: trims diacritics by stripping non-ASCII", () => {
  // Replace mantra strips non-[A-Za-z0-9], so diacritics are dropped
  // (not transliterated). This matches browser behavior.
  assert.equal(derivePersonaKey("Café Manager", 0), "CafManager");
});

test("derivePersonaKey: numeric-only label is preserved", () => {
  assert.equal(derivePersonaKey("12345", 0), "12345");
});

// ── assignUniquePersonaKey ──────────────────────────────────────────────

test("assignUniquePersonaKey: returns base when no collision", () => {
  assert.equal(assignUniquePersonaKey([], "Admin", null), "Admin");
});

test("assignUniquePersonaKey: appends 2 on first collision", () => {
  assert.equal(assignUniquePersonaKey(["Admin"], "Admin", null), "Admin2");
});

test("assignUniquePersonaKey: walks suffix until free", () => {
  assert.equal(
    assignUniquePersonaKey(["Admin", "Admin2", "Admin3"], "Admin", null),
    "Admin4",
  );
});

test("assignUniquePersonaKey: keeps existing key when editing in place", () => {
  // When `editingKey` matches an existing entry, that entry doesn't
  // count as a collision — re-saving a persona without changing the
  // label must NOT bump it to `Admin2`.
  assert.equal(
    assignUniquePersonaKey(["Admin", "Other"], "Admin", "Admin"),
    "Admin",
  );
});

test("assignUniquePersonaKey: edit that changes label still disambiguates", () => {
  // Editing "FooOld" but the new derived key is "Admin", which already
  // exists. We expect bump.
  assert.equal(
    assignUniquePersonaKey(["Admin", "FooOld"], "Admin", "FooOld"),
    "Admin2",
  );
});

test("assignUniquePersonaKey: handles empty-base + collision", () => {
  assert.equal(
    assignUniquePersonaKey(["Persona1"], "Persona1", null),
    "Persona12",
  );
});

// ── serializePlanMapping ────────────────────────────────────────────────

function row(overrides: Partial<RawPlanRow> = {}): RawPlanRow {
  return {
    checked: true,
    manual: false,
    rawPlanId: "100",
    rawFragment: "",
    ...overrides,
  };
}

test("serializePlanMapping: drops unchecked rows", () => {
  const out = serializePlanMapping([
    row({ checked: false, rawPlanId: "100" }),
    row({ checked: true, rawPlanId: "200" }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].planId, 200);
});

test("serializePlanMapping: keeps checked row with empty fragment (bugfix)", () => {
  // Why: prior serializer required a non-empty fragment, silently
  // dropping plans the user had checked but not yet annotated.
  const out = serializePlanMapping([row({ rawPlanId: "100", rawFragment: "" })]);
  assert.deepEqual(out, [{ planId: 100, areaPathContains: [] }]);
});

test("serializePlanMapping: splits comma-separated fragments", () => {
  const out = serializePlanMapping([
    row({ rawPlanId: "100", rawFragment: "Alpha, Beta , Gamma" }),
  ]);
  assert.deepEqual(out, [
    { planId: 100, areaPathContains: ["Alpha", "Beta", "Gamma"] },
  ]);
});

test("serializePlanMapping: filters empty segments after split", () => {
  const out = serializePlanMapping([
    row({ rawPlanId: "100", rawFragment: "Alpha,, , Beta" }),
  ]);
  assert.deepEqual(out, [{ planId: 100, areaPathContains: ["Alpha", "Beta"] }]);
});

test("serializePlanMapping: drops manual rows with NaN planId", () => {
  const out = serializePlanMapping([
    row({ manual: true, rawPlanId: "abc" }),
    row({ manual: true, rawPlanId: "200" }),
  ]);
  assert.deepEqual(out, [{ planId: 200, areaPathContains: [] }]);
});

test("serializePlanMapping: drops manual rows with planId ≤ 0", () => {
  const out = serializePlanMapping([
    row({ manual: true, rawPlanId: "0" }),
    row({ manual: true, rawPlanId: "-5" }),
    row({ manual: true, rawPlanId: "10" }),
  ]);
  assert.deepEqual(out, [{ planId: 10, areaPathContains: [] }]);
});

test("serializePlanMapping: drops probed rows with NaN planId", () => {
  const out = serializePlanMapping([
    row({ manual: false, rawPlanId: "not-a-number" }),
    row({ manual: false, rawPlanId: "42" }),
  ]);
  assert.deepEqual(out, [{ planId: 42, areaPathContains: [] }]);
});

test("serializePlanMapping: preserves order of input rows", () => {
  const out = serializePlanMapping([
    row({ rawPlanId: "300" }),
    row({ rawPlanId: "100" }),
    row({ rawPlanId: "200" }),
  ]);
  assert.deepEqual(
    out.map((r) => r.planId),
    [300, 100, 200],
  );
});

test("serializePlanMapping: trims fragment whitespace before splitting", () => {
  const out = serializePlanMapping([
    row({ rawPlanId: "100", rawFragment: "   " }),
  ]);
  assert.deepEqual(out, [{ planId: 100, areaPathContains: [] }]);
});
