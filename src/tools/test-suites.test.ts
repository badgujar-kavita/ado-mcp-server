/**
 * Unit tests for the canonical read-result builders introduced in
 * Tier 2 of the jira-mcp port (list_test_suites, get_test_suite).
 *
 * Like read-canonical.test.ts, we test the builder helpers directly.
 * The tool handlers wrap the builder output in `{ content,
 * structuredContent }` — if the builder produces the right
 * CanonicalReadResult, the tool handler passes it through correctly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSuiteListCanonicalResult,
  buildSuiteCanonicalResult,
} from "./test-suites.ts";
import type { AdoTestSuite } from "../types.ts";

// ── Fixture helpers ────────────────────────────────────────────────────────

function makeSuite(overrides: Partial<AdoTestSuite> = {}): AdoTestSuite {
  return {
    id: 10,
    name: "Root Suite",
    suiteType: "staticTestSuite",
    plan: { id: 1, name: "Plan 1" },
    revision: 1,
    hasChildren: false,
    ...overrides,
  };
}

// ── list_test_suites canonical ────────────────────────────────────────────

test("list_test_suites returns structuredContent with children per suite", () => {
  const suites: AdoTestSuite[] = [
    makeSuite({ id: 10, name: "Root Suite" }),
    makeSuite({
      id: 11,
      name: "Child One",
      parentSuite: { id: 10, name: "Root Suite" },
    }),
    makeSuite({
      id: 12,
      name: "Child Two",
      parentSuite: { id: 10, name: "Root Suite" },
    }),
  ];
  const canonical = buildSuiteListCanonicalResult(5, suites);

  assert.equal(canonical.item.id, 5);
  assert.equal(canonical.item.type, "test-plan");
  assert.equal(canonical.item.title, "Test Plan #5");
  assert.ok(canonical.item.summary!.includes("3 suites"));

  assert.ok(canonical.children);
  assert.equal(canonical.children!.length, 3);
  // First suite has no parentSuite → "root"
  assert.equal(canonical.children![0]!.id, 10);
  assert.equal(canonical.children![0]!.type, "test-suite");
  assert.equal(canonical.children![0]!.title, "Root Suite");
  assert.equal(canonical.children![0]!.relationship, "root");
  // Second and third have a parent → "child"
  assert.equal(canonical.children![1]!.id, 11);
  assert.equal(canonical.children![1]!.relationship, "child");
  assert.equal(canonical.children![2]!.id, 12);
  assert.equal(canonical.children![2]!.relationship, "child");

  assert.equal(canonical.completeness.isPartial, false);
});

test("list_test_suites empty plan returns empty children", () => {
  const canonical = buildSuiteListCanonicalResult(5, []);

  assert.equal(canonical.item.id, 5);
  assert.equal(canonical.item.type, "test-plan");
  assert.ok(canonical.item.summary!.includes("0 suites"));
  assert.ok(canonical.children);
  assert.equal(canonical.children!.length, 0);
  assert.equal(canonical.completeness.isPartial, false);
});

// ── get_test_suite canonical ──────────────────────────────────────────────

test("get_test_suite with parent suite populates parent relationship", () => {
  const suite = makeSuite({
    id: 42,
    name: "Sprint 24",
    suiteType: "staticTestSuite",
    parentSuite: { id: 1, name: "Root" },
  });
  const canonical = buildSuiteCanonicalResult(suite);

  assert.equal(canonical.item.id, 42);
  assert.equal(canonical.item.type, "test-suite");
  assert.equal(canonical.item.title, "Sprint 24");
  assert.equal(canonical.item.summary, "Type: staticTestSuite");

  assert.ok(canonical.children);
  assert.equal(canonical.children!.length, 1);
  assert.equal(canonical.children![0]!.id, 1);
  assert.equal(canonical.children![0]!.type, "test-suite");
  assert.equal(canonical.children![0]!.title, "Root");
  assert.equal(canonical.children![0]!.relationship, "parent");

  assert.equal(canonical.completeness.isPartial, false);
});

test("get_test_suite of query-based suite exposes queryString as artifact", () => {
  const suite = makeSuite({
    id: 99,
    name: "US_1234 query suite",
    suiteType: "dynamicTestSuite",
    queryString:
      "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Test Case' AND [System.Title] CONTAINS 'TC_1234_'",
  });
  const canonical = buildSuiteCanonicalResult(suite);

  assert.ok(canonical.artifacts);
  assert.equal(canonical.artifacts!.length, 1);
  assert.equal(canonical.artifacts![0]!.kind, "query");
  assert.equal(canonical.artifacts![0]!.title, "Query-based suite WIQL");
  assert.ok(canonical.artifacts![0]!.summary!.includes("SELECT"));
});

test("get_test_suite of static suite has no query artifact", () => {
  const suite = makeSuite({
    id: 7,
    name: "Static suite",
    suiteType: "staticTestSuite",
    // no queryString
  });
  const canonical = buildSuiteCanonicalResult(suite);

  // artifacts must be undefined (or empty) when there's no WIQL query.
  assert.ok(
    canonical.artifacts === undefined || canonical.artifacts.length === 0,
    "expected artifacts to be undefined or empty for static suite",
  );
});
