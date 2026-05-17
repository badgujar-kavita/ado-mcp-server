/**
 * Unit tests for the canonical read-result builders introduced in
 * Tier 2 of the jira-mcp port (ado_suites, ado_suite).
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
  ensureSuffixedSubSuite,
  usSuiteExists,
} from "./test-suites.ts";
import { AdoClient } from "../ado-client.ts";
import type { AdoTestSuite, AdoTestSuiteListResponse } from "../types.ts";

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

// ── ado_suites canonical ────────────────────────────────────────────

test("ado_suites returns structuredContent with children per suite", () => {
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

test("ado_suites empty plan returns empty children", () => {
  const canonical = buildSuiteListCanonicalResult(5, []);

  assert.equal(canonical.item.id, 5);
  assert.equal(canonical.item.type, "test-plan");
  assert.ok(canonical.item.summary!.includes("0 suites"));
  assert.ok(canonical.children);
  assert.equal(canonical.children!.length, 0);
  assert.equal(canonical.completeness.isPartial, false);
});

// ── ado_suite canonical ──────────────────────────────────────────────

test("ado_suite with parent suite populates parent relationship", () => {
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

test("ado_suite of query-based suite exposes queryString as artifact", () => {
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

test("ado_suite of static suite has no query artifact", () => {
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

test("ado_suite simple suite: no parent, no query → no children, no artifacts", () => {
  const suite = makeSuite({
    id: 50,
    name: "Simple Suite",
    suiteType: "staticTestSuite",
    // no parentSuite, no queryString
  });
  const canonical = buildSuiteCanonicalResult(suite);

  assert.equal(canonical.item.id, 50);
  assert.equal(canonical.item.type, "test-suite");
  assert.equal(canonical.item.title, "Simple Suite");
  assert.equal(canonical.item.summary, "Type: staticTestSuite");

  // No parent → no children
  assert.equal(canonical.children, undefined);
  // No queryString → no artifacts
  assert.equal(canonical.artifacts, undefined);

  assert.equal(canonical.completeness.isPartial, false);
});

test("ado_suites singular suite count in summary", () => {
  const suites: AdoTestSuite[] = [
    makeSuite({ id: 10, name: "Only Suite" }),
  ];
  const canonical = buildSuiteListCanonicalResult(99, suites);

  assert.equal(canonical.item.id, 99);
  assert.equal(canonical.item.type, "test-plan");
  // 1 suite → singular "suite" (no trailing "s")
  assert.ok(canonical.item.summary!.includes("1 suite"));
  assert.ok(!canonical.item.summary!.includes("1 suites"));
  assert.equal(canonical.children!.length, 1);
});

// ── usSuiteExists ───────────────────────────────────────────────────────

class StubAdoClientForSuites extends AdoClient {
  public suitesByPlan: Map<number, AdoTestSuite[]>;
  /**
   * Track every POST so suite-creation tests can assert on the bodies. The
   * stub mints incrementing suite IDs (starting at 9000) and returns the
   * created suite shape so the production code's find-or-create logic sees
   * a realistic response.
   */
  public posts: Array<{ path: string; body: Record<string, unknown> }>;
  /** Inject a get-failure for `usSuiteExists`'s try/catch path. */
  public getShouldThrow: boolean;
  private nextSuiteId = 9000;

  constructor(suitesByPlan: Map<number, AdoTestSuite[]> = new Map(), getShouldThrow = false) {
    super("myorg", "myproj", "pat");
    this.suitesByPlan = suitesByPlan;
    this.getShouldThrow = getShouldThrow;
    this.posts = [];
  }

  async get<T>(path: string): Promise<T> {
    if (this.getShouldThrow) throw new Error("simulated GET failure");
    const m = path.match(/\/_apis\/testplan\/Plans\/(\d+)\/suites$/);
    if (!m) throw new Error(`StubAdoClientForSuites: unhandled GET ${path}`);
    const planId = parseInt(m[1], 10);
    const suites = this.suitesByPlan.get(planId) ?? [];
    return { value: suites, count: suites.length } as unknown as T;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const b = body as Record<string, unknown>;
    this.posts.push({ path, body: b });
    const m = path.match(/\/_apis\/testplan\/Plans\/(\d+)\/suites$/);
    if (!m) throw new Error(`StubAdoClientForSuites: unhandled POST ${path}`);
    const planId = parseInt(m[1], 10);
    const id = this.nextSuiteId++;
    const created: AdoTestSuite = {
      id,
      name: b.name as string,
      suiteType: b.suiteType as AdoTestSuite["suiteType"],
      parentSuite: b.parentSuite as { id: number; name: string } | undefined,
      plan: { id: planId, name: `Plan ${planId}` },
      revision: 1,
      hasChildren: false,
      ...(b.queryString ? { queryString: b.queryString as string } : {}),
    };
    const list = this.suitesByPlan.get(planId) ?? [];
    list.push(created);
    this.suitesByPlan.set(planId, list);
    return created as unknown as T;
  }

  async patch<T>(): Promise<T> {
    throw new Error("StubAdoClientForSuites: PATCH not expected");
  }
  async delete<T>(): Promise<T> {
    throw new Error("StubAdoClientForSuites: DELETE not expected");
  }
}

test("usSuiteExists: returns true when a suite name starts with '<usId> | '", async () => {
  const stub = new StubAdoClientForSuites(
    new Map([[5500, [
      // Root suite
      { id: 1, name: "Plan Root", suiteType: "staticTestSuite", plan: { id: 5500, name: "Plan" }, revision: 1, hasChildren: true } satisfies AdoTestSuite,
      // Sprint folder
      { id: 2, name: "Sprint 14", suiteType: "staticTestSuite", parentSuite: { id: 1, name: "Plan Root" }, plan: { id: 5500, name: "Plan" }, revision: 1, hasChildren: true } satisfies AdoTestSuite,
      // US-level dynamic suite — name is `<usId> | <story title>` per buildUsFolderName default.
      { id: 3, name: "1234 | Case Creation Story", suiteType: "dynamicTestSuite", parentSuite: { id: 2, name: "Sprint 14" }, plan: { id: 5500, name: "Plan" }, revision: 1, hasChildren: false, queryString: "..." } satisfies AdoTestSuite,
    ]]]),
  );
  const exists = await usSuiteExists(stub, 5500, 1234);
  assert.equal(exists, true);
});

test("usSuiteExists: returns false when no suite carries the US id prefix", async () => {
  const stub = new StubAdoClientForSuites(
    new Map([[5500, [
      { id: 1, name: "Plan Root", suiteType: "staticTestSuite", plan: { id: 5500, name: "Plan" }, revision: 1, hasChildren: false } satisfies AdoTestSuite,
      { id: 3, name: "9999 | Some other story", suiteType: "dynamicTestSuite", plan: { id: 5500, name: "Plan" }, revision: 1, hasChildren: false } satisfies AdoTestSuite,
    ]]]),
  );
  const exists = await usSuiteExists(stub, 5500, 1234);
  assert.equal(exists, false);
});

test("usSuiteExists: tolerates the 'bare numeric' legacy shape (name === '<usId>')", async () => {
  const stub = new StubAdoClientForSuites(
    new Map([[5500, [
      { id: 3, name: "1234", suiteType: "dynamicTestSuite", plan: { id: 5500, name: "Plan" }, revision: 1, hasChildren: false } satisfies AdoTestSuite,
    ]]]),
  );
  assert.equal(await usSuiteExists(stub, 5500, 1234), true);
});

test("usSuiteExists: returns false on GET failure (defensive)", async () => {
  const stub = new StubAdoClientForSuites(new Map(), /* getShouldThrow */ true);
  assert.equal(await usSuiteExists(stub, 5500, 1234), false);
});

// ── ensureSuffixedSubSuite ──────────────────────────────────────────────

test("ensureSuffixedSubSuite creates a static folder + query child with the correct WIQL", async () => {
  const usSuiteId = 3;
  const planId = 5500;
  const stub = new StubAdoClientForSuites(
    new Map([[planId, [
      { id: 1, name: "Plan Root", suiteType: "staticTestSuite", plan: { id: planId, name: "Plan" }, revision: 1, hasChildren: true } satisfies AdoTestSuite,
      { id: usSuiteId, name: "1234 | Case Story", suiteType: "dynamicTestSuite", parentSuite: { id: 1, name: "Plan Root" }, plan: { id: planId, name: "Plan" }, revision: 1, hasChildren: false, queryString: "..." } satisfies AdoTestSuite,
    ]]]),
  );

  const result = await ensureSuffixedSubSuite(stub, planId, usSuiteId, 1234, "regression", "REG");
  assert.ok(result.staticSuiteId > 0, "static suite ID must be set");
  assert.ok(result.querySuiteId > 0, "query suite ID must be set");
  assert.equal(result.created.length, 2);
  assert.equal(result.created[0], "Regression");
  assert.equal(result.created[1], "Regression (query)");

  // Two POSTs — static parent first, dynamic child second.
  assert.equal(stub.posts.length, 2);
  const [staticPost, queryPost] = stub.posts;
  assert.equal(staticPost.body.suiteType, "staticTestSuite");
  assert.equal(staticPost.body.name, "Regression");
  const staticParent = staticPost.body.parentSuite as { id: number };
  assert.equal(staticParent.id, usSuiteId);

  assert.equal(queryPost.body.suiteType, "dynamicTestSuite");
  assert.equal(queryPost.body.name, "Regression");
  const queryParent = queryPost.body.parentSuite as { id: number };
  assert.equal(queryParent.id, result.staticSuiteId);
  assert.match(
    queryPost.body.queryString as string,
    /CONTAINS 'TC_1234_REG_'/,
    "query suite WIQL must filter on TC_<usId>_<TAG>_",
  );
});

test("ensureSuffixedSubSuite is idempotent — re-running returns existing IDs without new POSTs", async () => {
  const planId = 5500;
  const usSuiteId = 3;
  // Pre-seed both the static folder AND its query child so find-or-create matches every level.
  const suites: AdoTestSuite[] = [
    { id: 1, name: "Plan Root", suiteType: "staticTestSuite", plan: { id: planId, name: "Plan" }, revision: 1, hasChildren: true } satisfies AdoTestSuite,
    { id: usSuiteId, name: "1234 | Case Story", suiteType: "dynamicTestSuite", parentSuite: { id: 1, name: "Plan Root" }, plan: { id: planId, name: "Plan" }, revision: 1, hasChildren: true } satisfies AdoTestSuite,
    { id: 4, name: "Regression", suiteType: "staticTestSuite", parentSuite: { id: usSuiteId, name: "1234 | Case Story" }, plan: { id: planId, name: "Plan" }, revision: 1, hasChildren: true } satisfies AdoTestSuite,
    { id: 5, name: "Regression", suiteType: "dynamicTestSuite", parentSuite: { id: 4, name: "Regression" }, plan: { id: planId, name: "Plan" }, revision: 1, hasChildren: false, queryString: "..." } satisfies AdoTestSuite,
  ];
  const stub = new StubAdoClientForSuites(new Map([[planId, suites]]));
  const result = await ensureSuffixedSubSuite(stub, planId, usSuiteId, 1234, "regression", "REG");

  // No POSTs — both levels matched existing.
  assert.equal(stub.posts.length, 0);
  assert.equal(result.staticSuiteId, 4);
  assert.equal(result.querySuiteId, 5);
  assert.equal(result.existing.length, 2);
});

test("ensureSuffixedSubSuite throws on empty suffix or empty categoryTag", async () => {
  const stub = new StubAdoClientForSuites();
  await assert.rejects(
    () => ensureSuffixedSubSuite(stub, 1, 1, 1, "", "REG"),
    /requires a non-empty suffix/,
  );
  await assert.rejects(
    () => ensureSuffixedSubSuite(stub, 1, 1, 1, "regression", ""),
    /requires a non-empty categoryTag/,
  );
});

// Silence unused-import warning when AdoTestSuiteListResponse is the type the
// stub returns from `get`. The test never references the alias directly but
// the stub's get<T>() call site infers it through TypeScript.
const _assertTypeImportUsed: AdoTestSuiteListResponse | undefined = undefined;
void _assertTypeImportUsed;
