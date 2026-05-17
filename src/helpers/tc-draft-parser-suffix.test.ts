/**
 * Round-trip tests for suffixed-pack draft parsing.
 *
 * Goal: prove that a draft authored with a `suffix` arg (REG/E2E/SIT/…) can
 * be formatted to markdown by `formatTcDraftToMarkdown(data, config, suffix)`,
 * then parsed back by `parseTcDraftFromMarkdown` with the `categoryTag`
 * captured on each TC. Canonical drafts (no suffix) must continue to round
 * trip with `categoryTag === undefined`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { formatTcDraftToMarkdown, type TcDraftData } from "./tc-draft-formatter.ts";
import { parseTcDraftFromMarkdown } from "./tc-draft-parser.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildData(overrides: Partial<TcDraftData> = {}): TcDraftData {
  return {
    userStoryId: 1234,
    storyTitle: "Sample story for round-trip",
    storyState: "Active",
    areaPath: "Proj\\Area",
    iterationPath: "Proj\\Sprint 1",
    version: 1,
    status: "DRAFT",
    lastUpdated: "2026-05-17",
    testCases: [
      {
        tcNumber: 1,
        featureTags: ["Feature", "Verify as Persona"],
        useCaseSummary: "Existing channel still creates a Case",
        priority: 2,
        steps: [{ action: "Step 1 action", expectedResult: "Step 1 outcome" }],
      },
      {
        tcNumber: 2,
        featureTags: ["Feature", "Verify as Persona"],
        useCaseSummary: "Routing rule still fires",
        priority: 1,
        steps: [{ action: "Step 2 action", expectedResult: "Step 2 outcome" }],
      },
    ],
    commonPrerequisites: {
      preConditions: ["Org has feature enabled"],
      testData: "support@example.com",
    },
    ...overrides,
  };
}

test("round-trip canonical draft preserves no categoryTag on each TC", () => {
  const data = buildData();
  const md = formatTcDraftToMarkdown(data);
  const parsed = parseTcDraftFromMarkdown(md);
  assert.ok(parsed, "canonical draft should parse");
  assert.equal(parsed!.testCases.length, 2);
  for (const tc of parsed!.testCases) {
    assert.equal(tc.categoryTag, undefined, `canonical TC should have no categoryTag (got ${tc.categoryTag})`);
  }
  // TC titles should NOT include any uppercase tag segment
  assert.match(md, /\*\*TC_1234_01 ->/, "canonical title shape should be TC_1234_01 ->");
  assert.doesNotMatch(md, /\*\*TC_1234_REG_/, "canonical draft must not embed REG tag");
});

test("round-trip suffix='regression' embeds REG and parser captures categoryTag='REG'", () => {
  const data = buildData();
  const md = formatTcDraftToMarkdown(data, undefined, "regression");
  // Header shape — Suite Type row + no Supporting Documents
  assert.match(md, /\| \*\*Suite Type\*\* \| Regression \|/, "Suite Type row missing");
  assert.doesNotMatch(md, /## Supporting Documents/, "suffixed draft should skip Supporting Documents");
  // TC titles include REG
  assert.match(md, /\*\*TC_1234_REG_01 ->/, "TC title should include REG segment");
  assert.match(md, /\*\*TC_1234_REG_02 ->/, "second TC title should include REG segment");

  const parsed = parseTcDraftFromMarkdown(md);
  assert.ok(parsed, "suffixed draft should parse");
  assert.equal(parsed!.testCases.length, 2);
  for (const tc of parsed!.testCases) {
    assert.equal(tc.categoryTag, "REG", `suffixed TC should carry categoryTag='REG' (got ${tc.categoryTag})`);
  }
});

test("round-trip suffix='e2e' embeds E2E", () => {
  const md = formatTcDraftToMarkdown(buildData(), undefined, "e2e");
  assert.match(md, /\*\*TC_1234_E2E_01 ->/);
  const parsed = parseTcDraftFromMarkdown(md)!;
  assert.equal(parsed.testCases[0].categoryTag, "E2E");
});

test("round-trip suffix='sit' embeds SIT", () => {
  const md = formatTcDraftToMarkdown(buildData(), undefined, "sit");
  assert.match(md, /\*\*TC_1234_SIT_01 ->/);
  const parsed = parseTcDraftFromMarkdown(md)!;
  assert.equal(parsed.testCases[0].categoryTag, "SIT");
});

test("round-trip suffix='performance' embeds PERF (canonical 5-char tag)", () => {
  const md = formatTcDraftToMarkdown(buildData(), undefined, "performance");
  assert.match(md, /\*\*TC_1234_PERF_01 ->/);
  const parsed = parseTcDraftFromMarkdown(md)!;
  assert.equal(parsed.testCases[0].categoryTag, "PERF");
});

test("round-trip suffix='smoke' embeds SMOKE", () => {
  const md = formatTcDraftToMarkdown(buildData(), undefined, "smoke");
  assert.match(md, /\*\*TC_1234_SMOKE_01 ->/);
  const parsed = parseTcDraftFromMarkdown(md)!;
  assert.equal(parsed.testCases[0].categoryTag, "SMOKE");
});

test("the shipped sample regression draft parses cleanly with categoryTag='REG'", () => {
  // The sample at tenant-rules-examples/sample-drafts/US_1234_test_cases_regression.md
  // is the user-facing reference shape — it MUST parse so users who hand it
  // to the agent for inspiration aren't blocked.
  const samplePath = resolve(
    __dirname,
    "..",
    "..",
    "tenant-rules-examples",
    "sample-drafts",
    "US_1234_test_cases_regression.md",
  );
  const md = readFileSync(samplePath, "utf-8");
  const parsed = parseTcDraftFromMarkdown(md);
  assert.ok(parsed, "sample regression draft must parse");
  assert.equal(parsed!.userStoryId, 1234);
  assert.equal(parsed!.testCases.length, 3);
  for (const tc of parsed!.testCases) {
    assert.equal(tc.categoryTag, "REG");
  }
});
