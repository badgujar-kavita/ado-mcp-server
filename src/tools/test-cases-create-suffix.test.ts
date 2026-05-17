/**
 * Tests for `createTestCase` numbering with the optional `categoryTag` arg.
 *
 * `getNextTcNumber` is private to test-cases.ts, but `createTestCase` accepts
 * a fully-resolved `categoryTag` and forwards it. By stubbing the WIQL POST
 * + workitems GET we can drive the numbering branches end-to-end without
 * talking to ADO:
 *
 *   - canonical (no tag): WIQL `NOT CONTAINS '_REG_'` etc. + JS post-filter
 *     drops any title whose parser-captured tag is non-empty.
 *   - per-suffix: WIQL `CONTAINS 'TC_<usId>_<TAG>_'`; numbering restarts at 1.
 *   - WIQL failure: falls back to 1 so first push isn't blocked by transient
 *     errors.
 *
 * The stub also captures the WIQL string so we can assert the right shape was
 * sent — the contract tests pin the strategy in addition to the result.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { AdoClient } from "../ado-client.ts";
import { createTestCase, type CreateTestCaseParams } from "./test-cases.ts";
import type { ConventionsConfig, AdoWorkItem } from "../types.ts";

function configFor(): ConventionsConfig {
  return {
    testPlanMapping: [],
    sprintFolderPrefix: "Sprint",
    suiteStructure: { tcTitlePrefix: "TC", parentUsSeparator: " | " },
    testCaseTitle: { prefix: "TC", separator: " -> ", numberPadding: 2, maxLength: 256 },
    testCaseDefaults: { priority: 2, state: "Design" },
    // prerequisites needs at minimum a sections[] array — buildPrerequisitesHtml
    // iterates it. Empty sections produce empty HTML, which is fine for these tests.
    prerequisites: {
      heading: "Prerequisites",
      sections: [],
    },
    prerequisiteDefaults: {
      personas: {},
      personaRolesLabel: "Roles",
      personaPsgLabel: "Permission Set Group",
      commonPreConditions: [],
      testData: "N/A",
    },
  } as unknown as ConventionsConfig;
}

class StubClient extends AdoClient {
  public wiqlIdsToReturn: number[];
  public titlesById: Map<number, string>;
  /** When true, /_apis/wit/wiql throws — drives the WIQL-fail fallback to 1. */
  public wiqlShouldFail: boolean;
  /** Captures every WIQL query string sent. */
  public wiqlQueries: string[];
  /** Captures POSTs to /_apis/wit/workitems/$Test Case (the create call). */
  public createPosts: Array<{ ops: Array<{ op: string; path: string; value: unknown }> }>;
  /** Mints incrementing IDs for created TCs so the response shape matches reality. */
  private nextCreateId = 5000;

  constructor(opts: {
    wiqlIdsToReturn?: number[];
    titlesById?: Map<number, string>;
    wiqlShouldFail?: boolean;
  } = {}) {
    super("myorg", "myproj", "pat");
    this.wiqlIdsToReturn = opts.wiqlIdsToReturn ?? [];
    this.titlesById = opts.titlesById ?? new Map();
    this.wiqlShouldFail = opts.wiqlShouldFail ?? false;
    this.wiqlQueries = [];
    this.createPosts = [];
  }

  async get<T>(path: string, _api?: string, qp?: Record<string, string>): Promise<T> {
    if (path.endsWith(`/_apis/wit/workitems/${path.split("/").pop()}`) && /\/_apis\/wit\/workitems\/\d+$/.test(path)) {
      // US fetch — return a minimal AreaPath
      return {
        id: 1234,
        rev: 1,
        fields: { "System.AreaPath": "Proj\\Area", "System.IterationPath": "Proj\\Sprint 1" },
        url: path,
      } as unknown as T;
    }
    if (path === "/_apis/wit/workitems" && qp?.ids) {
      const ids = qp.ids.split(",").map((s) => parseInt(s, 10));
      const value = ids.map((id) => ({
        id,
        rev: 1,
        fields: { "System.Title": this.titlesById.get(id) ?? `TC_1234_${String(id).padStart(2, "0")} -> X` },
        url: `https://example/_apis/wit/workitems/${id}`,
      })) as unknown as AdoWorkItem[];
      return { value, count: value.length } as unknown as T;
    }
    throw new Error(`StubClient: unhandled GET ${path} qp=${JSON.stringify(qp)}`);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    if (path === "/_apis/wit/wiql") {
      if (this.wiqlShouldFail) throw new Error("simulated WIQL failure");
      this.wiqlQueries.push(((body as { query: string }).query ?? ""));
      const workItems = this.wiqlIdsToReturn.map((id) => ({ id }));
      return { workItems } as unknown as T;
    }
    if (path === "/_apis/wit/workitems/$Test Case") {
      const ops = body as Array<{ op: string; path: string; value: unknown }>;
      this.createPosts.push({ ops });
      const titleOp = ops.find((o) => o.path === "/fields/System.Title");
      const id = this.nextCreateId++;
      return {
        id,
        rev: 1,
        fields: { "System.Title": titleOp?.value ?? `TC ${id}` },
        url: `https://example/_apis/wit/workitems/${id}`,
      } as unknown as T;
    }
    throw new Error(`StubClient: unhandled POST ${path}`);
  }

  async patch<T>(): Promise<T> {
    throw new Error("StubClient: PATCH not expected");
  }
  async delete<T>(): Promise<T> {
    throw new Error("StubClient: DELETE not expected");
  }
}

function paramsFor(overrides: Partial<CreateTestCaseParams> = {}): CreateTestCaseParams {
  return {
    planId: 5500,
    userStoryId: 1234,
    featureTags: ["Feature"],
    useCaseSummary: "Sample",
    steps: [{ action: "do", expectedResult: "ok" }],
    areaPath: "Proj\\Area",
    iterationPath: "Proj\\Sprint 1",
    ...overrides,
  };
}

// ── Per-suffix WIQL ──

test("createTestCase with categoryTag='REG' issues per-suffix WIQL CONTAINS '_REG_'", async () => {
  // Pre-existing 2 REG TCs → next REG number is 3.
  const stub = new StubClient({ wiqlIdsToReturn: [11, 12] });
  const result = await createTestCase(stub, paramsFor({ categoryTag: "REG" }), configFor());
  assert.ok(result.id > 0);

  // WIQL should target REG specifically, not the canonical NOT-CONTAINS chain.
  assert.equal(stub.wiqlQueries.length, 1);
  assert.match(stub.wiqlQueries[0], /CONTAINS 'TC_1234_REG_'/);
  assert.doesNotMatch(stub.wiqlQueries[0], /NOT CONTAINS '_REG_'/);

  // The created TC title should embed REG and start at 03.
  const titleOp = stub.createPosts[0].ops.find((o) => o.path === "/fields/System.Title")!;
  assert.match(String(titleOp.value), /^TC_1234_REG_03 ->/);
});

test("createTestCase with categoryTag='E2E' embeds E2E and starts at 01 when no prior E2E TCs", async () => {
  const stub = new StubClient({ wiqlIdsToReturn: [] });
  await createTestCase(stub, paramsFor({ categoryTag: "E2E" }), configFor());

  assert.match(stub.wiqlQueries[0], /CONTAINS 'TC_1234_E2E_'/);
  const titleOp = stub.createPosts[0].ops.find((o) => o.path === "/fields/System.Title")!;
  assert.match(String(titleOp.value), /^TC_1234_E2E_01 ->/);
});

// ── Canonical numbering with NOT CONTAINS chain + post-filter ──

test("createTestCase without categoryTag issues WIQL with NOT CONTAINS for every known tag", async () => {
  const stub = new StubClient({ wiqlIdsToReturn: [] });
  await createTestCase(stub, paramsFor(), configFor());

  const q = stub.wiqlQueries[0];
  for (const tag of ["REG", "E2E", "SIT", "UAT", "SMOKE", "PERF"]) {
    assert.match(q, new RegExp(`NOT CONTAINS '_${tag}_'`), `WIQL must subtract ${tag}`);
  }
  // And it should also CONTAINS the canonical prefix.
  assert.match(q, /CONTAINS 'TC_1234_'/);
});

test("createTestCase canonical: post-filter drops titles whose parsed tag is non-empty", async () => {
  // WIQL claims 3 candidates, but only 2 are real canonical (the third has a SMOKE tag the
  // WIQL chain happened to miss, e.g. case-insensitive variant or future tag). Post-filter
  // must catch it and report next canonical = 3, not 4.
  const titles = new Map<number, string>([
    [101, "TC_1234_01 -> A -> first"],
    [102, "TC_1234_02 -> A -> second"],
    [103, "TC_1234_FUTUR_01 -> A -> custom future tag survived WIQL"],
  ]);
  const stub = new StubClient({ wiqlIdsToReturn: [101, 102, 103], titlesById: titles });
  await createTestCase(stub, paramsFor(), configFor());

  const titleOp = stub.createPosts[0].ops.find((o) => o.path === "/fields/System.Title")!;
  // 2 canonical titles → next canonical TC number is 03.
  assert.match(String(titleOp.value), /^TC_1234_03 ->/);
});

test("createTestCase canonical: when WIQL returns 0, numbering starts at 01", async () => {
  const stub = new StubClient({ wiqlIdsToReturn: [] });
  await createTestCase(stub, paramsFor(), configFor());
  const titleOp = stub.createPosts[0].ops.find((o) => o.path === "/fields/System.Title")!;
  assert.match(String(titleOp.value), /^TC_1234_01 ->/);
});

test("createTestCase falls back to 01 when WIQL itself fails (defensive)", async () => {
  const stub = new StubClient({ wiqlShouldFail: true });
  await createTestCase(stub, paramsFor({ categoryTag: "REG" }), configFor());
  const titleOp = stub.createPosts[0].ops.find((o) => o.path === "/fields/System.Title")!;
  // Per-suffix path with WIQL failure → next is 1; title still embeds REG.
  assert.match(String(titleOp.value), /^TC_1234_REG_01 ->/);
});
