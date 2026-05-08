/**
 * Tests for hierarchical pre-requisite rendering — fixes the TC #1394301 bug
 * where Claude-authored drafts with nested bullets in 2-column prereq tables
 * (e.g., `- Enabled = TRUE` rows under a parent label) rendered as broken
 * sibling-list HTML in ADO instead of nested <ol><li><ul><li>.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrerequisitesHtml } from "./prerequisites.ts";
import { parseTcDraftFromMarkdown } from "./tc-draft-parser.ts";

test("hierarchy renderer emits nested <ol><li>parent<ul><li>child</li></ul></li></ol>", () => {
  const html = buildPrerequisitesHtml({
    preConditionsHierarchy: [
      { text: "Promotion.SalesOrg = 1111", isChild: false },
      { text: "Workflow State Action for Draft to Planned:", isChild: false },
      { text: "Enabled = TRUE", isChild: true },
      { text: "PreActionClass = TPM_PromotionFileValidation", isChild: true },
      { text: "Workflow State Action for Planned to In Approval:", isChild: false },
      { text: "Enabled = TRUE", isChild: true },
    ],
  });

  // Top-level <ol> exists
  assert.match(html, /<ol>/);
  // Parent items are top-level <li>
  assert.match(html, /<li>Promotion\.SalesOrg = 1111/);
  assert.match(html, /<li>Workflow State Action for Draft to Planned:/);
  // Children are wrapped in a <ul> nested inside the parent <li>
  assert.match(html, /Workflow State Action for Draft to Planned:<ul><li>Enabled = TRUE/);
  // No orphan <li><ul> wrapping (the broken pattern from TC #1394301)
  assert.doesNotMatch(html, /<li><ul>/);
  // No naked sibling-numbered child rows
  assert.doesNotMatch(html, /<\/li><li>Enabled = TRUE/);
});

test("hierarchy renderer falls back to flat <ol> when no isChild rows present", () => {
  const html = buildPrerequisitesHtml({
    preConditionsHierarchy: [
      { text: "Condition A", isChild: false },
      { text: "Condition B", isChild: false },
      { text: "Condition C", isChild: false },
    ],
  });
  // All flat — should still produce <ol><li>...</li></ol>; no <ul> *inside* the prereq <ol>.
  // (Persona section renders <ul> by design — that's separate from the prereq block.)
  assert.match(html, /<ol>/);
  assert.match(html, /<li>Condition A/);
  assert.match(html, /<li>Condition C/);
  // Specifically: no <ul> immediately following or nested inside the prereq <ol>
  const prereqOl = html.match(/<ol>(.*?)<\/ol>/s);
  assert.ok(prereqOl, "prereq <ol> block should exist");
  assert.doesNotMatch(prereqOl![1], /<ul>/);
});

test("flat preConditions[] still works when no hierarchy provided (backward compat)", () => {
  const html = buildPrerequisitesHtml({
    preConditions: ["Condition A", "Condition B"],
  });
  assert.match(html, /<ol>/);
  assert.match(html, /<li>Condition A<\/li>/);
  assert.match(html, /<li>Condition B<\/li>/);
  // No nested <ul> inside the prereq <ol>
  const prereqOl = html.match(/<ol>(.*?)<\/ol>/s);
  assert.ok(prereqOl);
  assert.doesNotMatch(prereqOl![1], /<ul>/);
});

test("structured 3+ col table wins over hierarchy when both present", () => {
  const html = buildPrerequisitesHtml({
    preConditionsHierarchy: [
      { text: "fallback parent", isChild: false },
      { text: "fallback child", isChild: true },
    ],
    preConditionsTable: {
      headers: ["#", "Component", "State"],
      rows: [["1", "X", "Y"]],
    },
  });
  // Should emit <table>, not the hierarchy
  assert.match(html, /<table/);
  assert.doesNotMatch(html, /fallback parent/);
});

test("orphan child at start gets promoted to parent (defensive)", () => {
  const html = buildPrerequisitesHtml({
    preConditionsHierarchy: [
      { text: "Stray child", isChild: true },
      { text: "Real parent", isChild: false },
    ],
  });
  // Stray child should render as a top-level <li>, not break the structure
  assert.match(html, /<ol>/);
  assert.match(html, /<li>Stray child/);
  assert.match(html, /<li>Real parent/);
});

test("parser detects bullet-prefix child rows from a markdown draft", () => {
  // Minimal draft with the exact pattern Claude authored for TC #1394301
  const draft = [
    "# Test Cases: US #9999 — Sample",
    "",
    "| | |",
    "|---|---|",
    "| **Status** | DRAFT |",
    "| **Version** | 1 |",
    "| **Last Updated** | 2026-05-08 |",
    "| **Drafted By** | tester |",
    "",
    "---",
    "",
    "## Story Summary",
    "",
    "| Field | Value |",
    "|---|---|",
    "| **US ID** | 9999 |",
    "| **Title** | Sample |",
    "| **State** | Active |",
    "| **Area Path** | Root |",
    "| **Iteration** | Sprint_1 |",
    "| **Parent** | — |",
    "",
    "---",
    "",
    "## Common Prerequisites",
    "",
    "### Persona",
    "",
    "| Role | Profile |",
    "|---|---|",
    "| KAM | TPM_User_Profile |",
    "",
    "### Pre-requisite",
    "",
    "| # | Condition |",
    "|---|---|",
    "| 1 | Promotion.SalesOrg = 1111 |",
    "| 2 | Workflow State Action for Draft to Planned: |",
    "| 3 | - Enabled = TRUE |",
    "| 4 | - PreActionClass = TPM_PromotionFileValidation |",
    "",
    "### Test Data",
    "",
    "N/A",
    "",
    "---",
    "",
    "## Test Case 1",
    "",
    "**TC_9999_01 -> Feature -> Verify thing**",
    "",
    "| | |",
    "|---|---|",
    "| **Priority** | 1 |",
    "| **Use Case** | sample |",
    "",
    "**Steps:**",
    "",
    "| # | Action | Expected Result |",
    "|---|---|---|",
    "| 1 | Do something | Happens |",
    "",
  ].join("\n");

  const data = parseTcDraftFromMarkdown(draft);
  assert.ok(data, "draft should parse");
  const hier = data!.commonPrerequisites?.preConditionsHierarchy;
  assert.ok(hier, "hierarchy should be captured because rows 3 and 4 start with `- `");
  assert.equal(hier!.length, 4);
  assert.deepEqual(hier!.map((r) => r.isChild), [false, false, true, true]);
  assert.deepEqual(
    hier!.map((r) => r.text),
    [
      "Promotion.SalesOrg = 1111",
      "Workflow State Action for Draft to Planned:",
      "Enabled = TRUE",
      "PreActionClass = TPM_PromotionFileValidation",
    ],
  );
});

test("parser leaves preConditionsHierarchy undefined when no rows are children", () => {
  const draft = [
    "# Test Cases: US #9998 — Flat Only",
    "",
    "| | |",
    "|---|---|",
    "| **Status** | DRAFT |",
    "| **Version** | 1 |",
    "| **Last Updated** | 2026-05-08 |",
    "| **Drafted By** | tester |",
    "",
    "---",
    "",
    "## Story Summary",
    "",
    "| Field | Value |",
    "|---|---|",
    "| **US ID** | 9998 |",
    "| **Title** | Flat Only |",
    "| **State** | Active |",
    "| **Area Path** | Root |",
    "| **Iteration** | Sprint_1 |",
    "| **Parent** | — |",
    "",
    "---",
    "",
    "## Common Prerequisites",
    "",
    "### Persona",
    "",
    "| Role | Profile |",
    "|---|---|",
    "| KAM | TPM_User_Profile |",
    "",
    "### Pre-requisite",
    "",
    "| # | Condition |",
    "|---|---|",
    "| 1 | Condition A |",
    "| 2 | Condition B |",
    "",
    "### Test Data",
    "",
    "N/A",
    "",
    "---",
    "",
    "## Test Case 1",
    "",
    "**TC_9998_01 -> Feature -> Verify**",
    "",
    "| | |",
    "|---|---|",
    "| **Priority** | 1 |",
    "| **Use Case** | sample |",
    "",
    "**Steps:**",
    "",
    "| # | Action | Expected Result |",
    "|---|---|---|",
    "| 1 | Do | OK |",
    "",
  ].join("\n");

  const data = parseTcDraftFromMarkdown(draft);
  assert.ok(data, "draft should parse");
  // No `- ` prefix anywhere → hierarchy stays undefined → flat path used
  assert.equal(data!.commonPrerequisites?.preConditionsHierarchy, undefined);
  assert.deepEqual(data!.commonPrerequisites?.preConditions, ["Condition A", "Condition B"]);
});
