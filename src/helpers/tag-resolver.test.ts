import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractCategoryFromTitle,
  resolveTagsMatchOnly,
  formatAdoTags,
} from "./tag-resolver.ts";
import { AdoClient } from "../ado-client.ts";

//
// extractCategoryFromTitle
//

test("extractCategoryFromTitle: returns 'Regression' for exact-case known category", () => {
  const title =
    "TC_12345_06 -> Regression -> Promotion -> Compensation -> Verify something";
  assert.equal(extractCategoryFromTitle(title), "Regression");
});

test("extractCategoryFromTitle: case-insensitive match returns canonical casing from known list ('sit' -> 'SIT')", () => {
  const title = "TC_12345_06 -> sit -> Promotion -> Verify something";
  assert.equal(extractCategoryFromTitle(title), "SIT");
});

test("extractCategoryFromTitle: returns null for standard functional TC (first segment not a category)", () => {
  const title = "TC_12345_01 -> Promotion -> Compensation -> Verify something";
  assert.equal(extractCategoryFromTitle(title), null);
});

test("extractCategoryFromTitle: returns null for malformed title 'NotATestCase'", () => {
  assert.equal(extractCategoryFromTitle("NotATestCase"), null);
});

test("extractCategoryFromTitle: returns null for title with only 2 segments (single arrow => first segment is the summary)", () => {
  assert.equal(extractCategoryFromTitle("TC_1_1 -> Summary"), null);
});

test("extractCategoryFromTitle: respects custom knownCategories arg", () => {
  const title =
    "TC_12345_06 -> Regression -> Promotion -> Verify something";
  // "Regression" is NOT in the custom list => null
  assert.equal(extractCategoryFromTitle(title, ["Custom"]), null);

  // With "Custom" in segment1 and custom known list => matches
  const customTitle = "TC_12345_06 -> Custom -> Promotion -> Verify something";
  assert.equal(extractCategoryFromTitle(customTitle, ["Custom"]), "Custom");
});

test("extractCategoryFromTitle: supports Unicode arrow '→'", () => {
  const title = "TC_1_1 → Regression → Promotion → Verify";
  assert.equal(extractCategoryFromTitle(title), "Regression");
});

//
// resolveTagsMatchOnly
//

test("resolveTagsMatchOnly: single requested tag exists in project (case-insensitive) => matched uses project casing", () => {
  const result = resolveTagsMatchOnly(["regression"], ["Regression", "Critical"]);
  assert.deepEqual(result.matched, ["Regression"]);
  assert.deepEqual(result.skipped, []);
});

test("resolveTagsMatchOnly: single requested tag not in project => skipped contains it, matched empty", () => {
  const result = resolveTagsMatchOnly(["Nonexistent"], ["Regression"]);
  assert.deepEqual(result.matched, []);
  assert.deepEqual(result.skipped, ["Nonexistent"]);
});

test("resolveTagsMatchOnly: multiple requested — some match, some don't — correctly partitioned", () => {
  const result = resolveTagsMatchOnly(
    ["regression", "unknown", "P1"],
    ["Regression", "P1", "Critical"],
  );
  assert.deepEqual(result.matched, ["Regression", "P1"]);
  assert.deepEqual(result.skipped, ["unknown"]);
});

test("resolveTagsMatchOnly: duplicate requested tags are deduped case-insensitively before matching", () => {
  const result = resolveTagsMatchOnly(
    ["Regression", "regression", "REGRESSION"],
    ["Regression"],
  );
  assert.deepEqual(result.matched, ["Regression"]);
  assert.deepEqual(result.skipped, []);
});

test("resolveTagsMatchOnly: duplicate requested misses are deduped and appear once in skipped", () => {
  const result = resolveTagsMatchOnly(
    ["missing", "Missing", "MISSING"],
    ["Regression"],
  );
  assert.deepEqual(result.matched, []);
  // First occurrence wins, preserving its casing
  assert.deepEqual(result.skipped, ["missing"]);
});

test("resolveTagsMatchOnly: empty requestedTags => both arrays empty", () => {
  const result = resolveTagsMatchOnly([], ["Regression", "Critical"]);
  assert.deepEqual(result.matched, []);
  assert.deepEqual(result.skipped, []);
});

test("resolveTagsMatchOnly: empty projectTags => all requested go to skipped (preserving requested casing)", () => {
  const result = resolveTagsMatchOnly(["Regression", "p1"], []);
  assert.deepEqual(result.matched, []);
  assert.deepEqual(result.skipped, ["Regression", "p1"]);
});

test("resolveTagsMatchOnly: preserves requested casing in skipped and project casing in matched", () => {
  const result = resolveTagsMatchOnly(
    ["rEgReSsIoN", "UnKnOwN"],
    ["Regression", "Critical"],
  );
  // matched uses the project's canonical casing
  assert.deepEqual(result.matched, ["Regression"]);
  // skipped preserves the requested casing exactly
  assert.deepEqual(result.skipped, ["UnKnOwN"]);
});

//
// formatAdoTags
//

test("formatAdoTags: multiple tags joined with '; '", () => {
  assert.equal(formatAdoTags(["Regression", "Critical", "P1"]), "Regression; Critical; P1");
});

test("formatAdoTags: single tag returns the tag itself", () => {
  assert.equal(formatAdoTags(["Regression"]), "Regression");
});

test("formatAdoTags: empty array returns empty string", () => {
  assert.equal(formatAdoTags([]), "");
});

//
// AdoClient.listProjectTags — fetch mocking
//

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init ?? {}))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("AdoClient.listProjectTags: caches on first call — second call does not re-fetch", async () => {
  let fetchCount = 0;
  const restore = mockFetch(() => {
    fetchCount++;
    return new Response(
      JSON.stringify({ value: [{ name: "Regression" }, { name: "Critical" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  try {
    const client = new AdoClient("org", "proj", "pat");
    const first = await client.listProjectTags();
    const second = await client.listProjectTags();
    assert.equal(fetchCount, 1, "fetch should be called exactly once due to caching");
    assert.deepEqual(first, ["Regression", "Critical"]);
    assert.deepEqual(second, ["Regression", "Critical"]);
  } finally {
    restore();
  }
});

test("AdoClient.listProjectTags: returns [] on HTTP failure (non-blocking)", async () => {
  const restore = mockFetch(
    () =>
      new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      }),
  );
  // Silence the expected warning from the client's catch block
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const client = new AdoClient("org", "proj", "pat");
    const result = await client.listProjectTags();
    assert.deepEqual(result, []);
  } finally {
    console.warn = originalWarn;
    restore();
  }
});

test("AdoClient.listProjectTags: clearProjectTagsCache() forces a re-fetch", async () => {
  let fetchCount = 0;
  const restore = mockFetch(() => {
    fetchCount++;
    return new Response(
      JSON.stringify({ value: [{ name: "Regression" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  try {
    const client = new AdoClient("org", "proj", "pat");
    await client.listProjectTags();
    await client.listProjectTags();
    assert.equal(fetchCount, 1, "second call is cached");
    client.clearProjectTagsCache();
    await client.listProjectTags();
    assert.equal(fetchCount, 2, "post-clear call should re-fetch");
  } finally {
    restore();
  }
});
