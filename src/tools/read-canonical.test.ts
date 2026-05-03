/**
 * Unit tests for the canonical read-result builders introduced in
 * Port-Commit 2 (Tier 1: ado_story, get_test_case, list_test_cases,
 * confluence_read).
 *
 * We test the builder helpers directly rather than the full tool
 * registration plumbing. The builders are the entire read-to-structured
 * translation — if they produce the right CanonicalReadResult, the tool
 * handler (which just wraps them in `{ content, structuredContent }`)
 * passes through correctly. The existing work-items.test.ts already
 * covers the prose/content-array layer for ado_story; the other
 * three tools pass prose through unchanged, so the canonical shape is
 * the only new surface worth testing here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUserStoryCanonicalResult,
} from "./work-items.ts";
import {
  buildTestCaseCanonicalResult,
  buildListTestCasesCanonicalResult,
} from "./test-cases.ts";
import { buildConfluencePageCanonicalResult } from "./confluence.ts";
import type { UserStoryContext, AdoWorkItem, ConfluencePageResult } from "../types.ts";

// ── Fixture helpers ────────────────────────────────────────────────────────

function makeUserStoryContext(
  overrides: Partial<UserStoryContext> & { webUrl?: string } = {},
): UserStoryContext & { webUrl: string } {
  return {
    id: 42,
    title: "Login flow",
    description: "<p>As a user I want to log in with SSO.</p>",
    acceptanceCriteria: "<p>Given valid creds, when submit, then redirected.</p>",
    areaPath: "Project\\Area",
    iterationPath: "Project\\Sprint 1",
    state: "Active",
    parentId: null,
    parentTitle: null,
    relations: [],
    namedFields: {},
    allFields: {},
    fetchedConfluencePages: [],
    unfetchedLinks: [],
    embeddedImages: [],
    solutionDesignUrl: null,
    solutionDesignContent: null,
    webUrl: "https://dev.azure.com/org/proj/_workitems/edit/42",
    ...overrides,
  };
}

function makeTestCaseWorkItem(overrides: Partial<AdoWorkItem> = {}): AdoWorkItem {
  return {
    id: 501,
    rev: 3,
    url: "https://dev.azure.com/org/proj/_apis/wit/workitems/501",
    fields: {
      "System.Title": "TC_100_01 Login happy path",
      "System.Description": "<p>Verify that a valid user can sign in.</p>",
      "System.State": "Design",
      ...(overrides.fields ?? {}),
    },
    relations: overrides.relations ?? [],
    ...overrides,
  };
}

// ── ado_story canonical ───────────────────────────────────────────────

test("buildUserStoryCanonicalResult: basic shape for a US with no links/images", () => {
  const ctx = makeUserStoryContext();
  const canonical = buildUserStoryCanonicalResult(ctx);

  assert.equal(canonical.item.id, 42);
  assert.equal(canonical.item.type, "user-story");
  assert.equal(canonical.item.title, "Login flow");
  assert.ok(canonical.item.summary && canonical.item.summary.length > 0);
  // summary is the stripped description
  assert.ok(canonical.item.summary!.includes("log in with SSO"));

  assert.equal(canonical.completeness.isPartial, false);
  assert.equal(typeof canonical.completeness.isPartial, "boolean");

  // No parent, no children emitted.
  assert.equal(canonical.children, undefined);
  assert.equal(canonical.artifacts, undefined);
  assert.equal(canonical.diagnostics, undefined);
});

test("buildUserStoryCanonicalResult: unfetched links flip isPartial=true with a reason", () => {
  const ctx = makeUserStoryContext({
    parentId: 7,
    parentTitle: "Epic: Auth",
    unfetchedLinks: [
      {
        url: "https://contoso.sharepoint.com/doc.pdf",
        type: "SharePoint",
        sourceField: "System.Description",
        reason: "non-confluence",
        workaround: "paste manually",
      },
    ],
  });
  const canonical = buildUserStoryCanonicalResult(ctx);

  assert.equal(canonical.completeness.isPartial, true);
  assert.ok(canonical.completeness.reason);
  assert.ok(canonical.completeness.reason!.includes("unfetched"));

  // Parent promoted to children[]
  assert.ok(canonical.children);
  assert.equal(canonical.children!.length, 1);
  assert.equal(canonical.children![0]!.id, 7);
  assert.equal(canonical.children![0]!.relationship, "parent");

  // Diagnostic recorded
  assert.ok(canonical.diagnostics);
  assert.equal(canonical.diagnostics!.length, 1);
  assert.equal(canonical.diagnostics![0]!.severity, "warning");
});

// ── get_test_case canonical ────────────────────────────────────────────────

test("buildTestCaseCanonicalResult: basic shape for a TC with no relations", () => {
  const item = makeTestCaseWorkItem();
  const canonical = buildTestCaseCanonicalResult(item);

  assert.equal(canonical.item.id, 501);
  assert.equal(canonical.item.type, "test-case");
  assert.equal(canonical.item.title, "TC_100_01 Login happy path");
  assert.ok(canonical.item.summary);
  assert.ok(canonical.item.summary!.includes("valid user"));

  assert.equal(canonical.completeness.isPartial, false);
  assert.equal(typeof canonical.completeness.isPartial, "boolean");

  assert.equal(canonical.children, undefined);
  assert.equal(canonical.artifacts, undefined);
});

test("buildTestCaseCanonicalResult: relations split into children (work items) and artifacts (attachments)", () => {
  const item = makeTestCaseWorkItem({
    relations: [
      {
        rel: "Microsoft.VSTS.Common.TestedBy-Reverse",
        url: "https://dev.azure.com/org/proj/_apis/wit/workitems/42",
        attributes: { name: "Login flow" },
      },
      {
        rel: "AttachedFile",
        url: "https://dev.azure.com/org/proj/_apis/wit/attachments/abc",
        attributes: { name: "screenshot.png" },
      },
    ],
  });
  const canonical = buildTestCaseCanonicalResult(item);

  assert.ok(canonical.children);
  assert.equal(canonical.children!.length, 1);
  assert.equal(canonical.children![0]!.id, 42);
  assert.equal(canonical.children![0]!.type, "work-item");
  assert.equal(canonical.children![0]!.title, "Login flow");

  assert.ok(canonical.artifacts);
  assert.equal(canonical.artifacts!.length, 1);
  assert.equal(canonical.artifacts![0]!.kind, "attachment");
  assert.equal(canonical.artifacts![0]!.title, "screenshot.png");
});

// ── list_test_cases canonical ──────────────────────────────────────────────

test("buildListTestCasesCanonicalResult: suite + contained test cases as children", () => {
  const canonical = buildListTestCasesCanonicalResult(100, 200, [
    { id: 501, name: "TC_100_01 Happy path" },
    { id: 502, name: "TC_100_02 Invalid password" },
  ]);

  assert.equal(canonical.item.id, 200);
  assert.equal(canonical.item.type, "test-suite");
  assert.ok(canonical.item.title.length > 0);
  assert.ok(canonical.item.summary!.includes("2 test cases"));

  assert.ok(canonical.children);
  assert.equal(canonical.children!.length, 2);
  assert.equal(canonical.children![0]!.type, "test-case");
  assert.equal(canonical.children![0]!.relationship, "contained");
  assert.equal(canonical.children![0]!.id, 501);

  assert.equal(canonical.completeness.isPartial, false);
  assert.equal(typeof canonical.completeness.isPartial, "boolean");
});

test("buildListTestCasesCanonicalResult: empty suite still produces a valid canonical shape", () => {
  const canonical = buildListTestCasesCanonicalResult(100, 200, []);
  assert.equal(canonical.item.id, 200);
  assert.equal(canonical.item.type, "test-suite");
  assert.ok(canonical.item.title.length > 0);
  assert.ok(canonical.children);
  assert.equal(canonical.children!.length, 0);
  assert.equal(canonical.completeness.isPartial, false);
  // Summary handles singular/plural transition
  assert.ok(canonical.item.summary!.includes("0 test cases"));
});

// ── confluence_read canonical ──────────────────────────────────────────

test("buildConfluencePageCanonicalResult: basic shape for a page", () => {
  const page: ConfluencePageResult = {
    title: "Solution Design: Login",
    body: "Overview\n\nWe will use SSO to authenticate users...",
  };
  const canonical = buildConfluencePageCanonicalResult("12345", page);

  assert.equal(canonical.item.id, "12345");
  assert.equal(canonical.item.type, "confluence-page");
  assert.equal(canonical.item.title, "Solution Design: Login");
  assert.ok(canonical.item.summary && canonical.item.summary.length > 0);
  assert.ok(canonical.item.summary!.startsWith("Overview"));

  assert.equal(canonical.completeness.isPartial, false);
  assert.equal(typeof canonical.completeness.isPartial, "boolean");
  // Single-page fetch: no children, no artifacts, no diagnostics.
  assert.equal(canonical.children, undefined);
  assert.equal(canonical.artifacts, undefined);
  assert.equal(canonical.diagnostics, undefined);
});

test("buildConfluencePageCanonicalResult: empty body yields undefined summary, still valid shape", () => {
  const page: ConfluencePageResult = { title: "Empty Page", body: "" };
  const canonical = buildConfluencePageCanonicalResult("99", page);

  assert.equal(canonical.item.id, "99");
  assert.equal(canonical.item.type, "confluence-page");
  assert.equal(canonical.item.title, "Empty Page");
  // slice(0,500) of "" is "" → falsy → summary is undefined.
  assert.equal(canonical.item.summary, undefined);
  assert.equal(canonical.completeness.isPartial, false);
});
