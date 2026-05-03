/**
 * Tier-2 migration tests for `list_test_plans` / `get_test_plan`
 * (src/tools/test-plans.ts).
 *
 * We test the canonical builders directly — same pattern as
 * read-canonical.test.ts. The builders are the entire
 * read-to-structured translation surface; the tool handler is a thin
 * wrapper that shuttles prose text and the builder's output into
 * `{ content, structuredContent }`. Prose is preserved byte-for-byte
 * from the pre-migration implementation (still `JSON.stringify(..., 2)`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTestPlansListCanonicalResult,
  buildTestPlanCanonicalResult,
} from "./test-plans.ts";
import type { AdoTestPlan } from "../types.ts";

function makeTestPlan(overrides: Partial<AdoTestPlan> = {}): AdoTestPlan {
  return {
    id: 100,
    name: "GPT_D-HUB",
    areaPath: "Project\\Area",
    iteration: "Project\\Sprint 1",
    rootSuite: { id: 200, name: "GPT_D-HUB" },
    state: "Active",
    revision: 1,
    ...overrides,
  };
}

// ── list_test_plans canonical ──────────────────────────────────────────────

test("list_test_plans returns structuredContent with children per plan", () => {
  const plans = [
    { id: 1, name: "Plan A", areaPath: "X", state: "Active", rootSuiteId: 10 },
    { id: 2, name: "Plan B", areaPath: "Y", state: "Inactive", rootSuiteId: 20 },
    { id: 3, name: "Plan C", areaPath: "Z", state: "Active", rootSuiteId: undefined },
  ];
  const canonical = buildTestPlansListCanonicalResult(plans);

  assert.equal(canonical.item.id, "project-test-plans");
  assert.equal(canonical.item.type, "project");
  assert.equal(canonical.item.title, "Test Plans in Project");
  assert.ok(canonical.item.summary!.includes("3 test plans"));

  assert.ok(canonical.children);
  assert.equal(canonical.children!.length, 3);
  for (const child of canonical.children!) {
    assert.equal(child.type, "test-plan");
    assert.equal(child.relationship, "contained");
  }
  assert.equal(canonical.children![0]!.id, 1);
  assert.equal(canonical.children![0]!.title, "Plan A");
  assert.equal(canonical.children![2]!.id, 3);

  assert.equal(canonical.completeness.isPartial, false);
});

test("list_test_plans with empty project returns empty children", () => {
  const canonical = buildTestPlansListCanonicalResult([]);

  assert.equal(canonical.item.id, "project-test-plans");
  assert.equal(canonical.item.type, "project");
  assert.ok(canonical.children);
  assert.deepEqual(canonical.children, []);
  assert.equal(canonical.completeness.isPartial, false);
  // Singular/plural handling: 0 plans → "0 test plans"
  assert.ok(canonical.item.summary!.includes("0 test plans"));
});

// ── get_test_plan canonical ────────────────────────────────────────────────

test("get_test_plan populates root suite as child", () => {
  const plan = makeTestPlan({
    id: 42,
    name: "Sprint 5 Plan",
    areaPath: "Proj\\Team",
    rootSuite: { id: 7, name: "Sprint 5 Plan" },
  });
  const canonical = buildTestPlanCanonicalResult(plan);

  assert.equal(canonical.item.id, 42);
  assert.equal(canonical.item.type, "test-plan");
  assert.equal(canonical.item.title, "Sprint 5 Plan");
  assert.equal(canonical.item.summary, "Area: Proj\\Team");

  assert.ok(canonical.children);
  assert.equal(canonical.children!.length, 1);
  assert.equal(canonical.children![0]!.id, 7);
  assert.equal(canonical.children![0]!.type, "test-suite");
  assert.equal(canonical.children![0]!.title, "Sprint 5 Plan");
  assert.equal(canonical.children![0]!.relationship, "root-suite");

  assert.equal(canonical.completeness.isPartial, false);
});

test("get_test_plan without rootSuite works", () => {
  // Some ADO responses omit rootSuite. Our builder returns undefined children.
  const plan = makeTestPlan({ id: 99, name: "Empty Plan", areaPath: "" });
  // Simulate missing rootSuite on the wire. AdoTestPlan declares it as
  // required, but the runtime ADO response can omit the field, and the
  // builder must tolerate that.
  // Cast via unknown to strip the required rootSuite typing for this case.
  const planWithoutRoot = { ...plan, rootSuite: undefined } as unknown as AdoTestPlan;
  const canonical = buildTestPlanCanonicalResult(planWithoutRoot);

  assert.equal(canonical.item.id, 99);
  assert.equal(canonical.item.type, "test-plan");
  assert.equal(canonical.item.title, "Empty Plan");
  // areaPath empty → summary undefined (falsy check)
  assert.equal(canonical.item.summary, undefined);
  // No rootSuite → no children key emitted.
  assert.equal(canonical.children, undefined);

  assert.equal(canonical.completeness.isPartial, false);
});
