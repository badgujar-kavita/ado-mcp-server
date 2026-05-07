/**
 * Test Data formatter + round-trip tests.
 *
 * - formatTcDraftToMarkdown emits a real markdown table when testDataTable is
 *   set on commonPrerequisites.
 * - Falls back to the single-string testData when no structured table is present.
 * - parser → formatter → parser round-trip is lossless for testDataTable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTcDraftToMarkdown, type TcDraftData } from "./tc-draft-formatter.ts";
import { parseTcDraftFromMarkdown } from "./tc-draft-parser.ts";

function buildBaseDraft(): TcDraftData {
  return {
    userStoryId: 6100,
    storyTitle: "Sample",
    storyState: "Active",
    areaPath: "Root",
    iterationPath: "Sprint_1",
    version: 1,
    status: "DRAFT",
    lastUpdated: "2026-05-07",
    testCases: [
      {
        tcNumber: 1,
        featureTags: ["Feature"],
        useCaseSummary: "Verify",
        priority: 2,
        steps: [{ action: "do x", expectedResult: "x done" }],
      },
    ],
  };
}

test("formatter: testDataTable → multi-line markdown table in draft", () => {
  const draft = buildBaseDraft();
  draft.commonPrerequisites = {
    testDataTable: {
      headers: ["Data", "Value"],
      rows: [
        ["Support Email", "support@company.com"],
        ["Web Form URL", "/support/contact"],
      ],
    },
  };
  const md = formatTcDraftToMarkdown(draft);
  // Section heading + blank line + header row + separator + data rows.
  assert.match(md, /### Test Data\n\n\| Data \| Value \|\n\|---\|---\|\n\| Support Email \| support@company\.com \|\n\| Web Form URL \| \/support\/contact \|/);
  // Crucially: NOT a one-line `\n`-collapsed version.
  assert.doesNotMatch(md, /\| Data \| Value \|\\n/);
});

test("formatter: only testData string → legacy single-line render", () => {
  const draft = buildBaseDraft();
  draft.commonPrerequisites = {
    testData: "A test customer with status Active",
  };
  const md = formatTcDraftToMarkdown(draft);
  assert.match(md, /### Test Data\n\nA test customer with status Active/);
  assert.doesNotMatch(md, /\| Data \| Value \|/);
});

test("round-trip: testDataTable survives formatter → parser without loss", () => {
  const original = buildBaseDraft();
  original.commonPrerequisites = {
    testDataTable: {
      headers: ["Data", "Value"],
      rows: [
        ["Field A", "value_a"],
        ["Field B", "value_b"],
        ["Field C", "value_c"],
      ],
    },
  };
  const md = formatTcDraftToMarkdown(original);
  const parsed = parseTcDraftFromMarkdown(md);
  assert.ok(parsed);
  const t = parsed!.commonPrerequisites?.testDataTable;
  assert.ok(t, "round-trip should preserve testDataTable");
  assert.deepEqual(t!.headers, ["Data", "Value"]);
  assert.deepEqual(t!.rows, [
    ["Field A", "value_a"],
    ["Field B", "value_b"],
    ["Field C", "value_c"],
  ]);
});

test("round-trip: testDataTable preferred over testData when both supplied to formatter", () => {
  const original = buildBaseDraft();
  original.commonPrerequisites = {
    testData: "ignore me",
    testDataTable: {
      headers: ["K", "V"],
      rows: [["a", "b"]],
    },
  };
  const md = formatTcDraftToMarkdown(original);
  // The string testData must NOT be written when the table is present.
  assert.doesNotMatch(md, /ignore me/);
  // The table IS written.
  assert.match(md, /\| K \| V \|/);
});

test("formatter: testData defaults to N/A when neither is set", () => {
  const draft = buildBaseDraft();
  draft.commonPrerequisites = {}; // empty object, no testData / testDataTable
  const md = formatTcDraftToMarkdown(draft);
  assert.match(md, /### Test Data\n\n.+\n/);
});
