import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { formatTcDraftToMarkdown, type TcDraftData } from "../helpers/tc-draft-formatter.ts";

const TMP_ROOT = join(tmpdir(), "ado-testforge-formatter-tests");

function setup() {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
}

function cleanup() {
  rmSync(TMP_ROOT, { recursive: true, force: true });
}

const minimalDraft: TcDraftData = {
  userStoryId: 12345,
  storyTitle: "Test Story",
  storyState: "Active",
  areaPath: "Proj\\Area",
  iterationPath: "Proj\\Sprint1",
  version: 1,
  status: "DRAFT",
  lastUpdated: "2025-01-01",
  testCases: [{
    tcNumber: 1,
    featureTags: ["Login"],
    useCaseSummary: "Verify login",
    steps: [{ action: "Open app", expectedResult: "App opens" }],
  }],
};

describe("formatTcDraftToMarkdown link integration", () => {
  beforeEach(setup);
  afterEach(cleanup);

  it("omits Supporting Documents when no sibling files exist", () => {
    const mdPath = join(TMP_ROOT, "US_12345_test_cases.md");
    const md = formatTcDraftToMarkdown(minimalDraft, mdPath);
    assert.ok(!md.includes("## Supporting Documents"), "Should not include Supporting Documents section");
  });

  it("includes link to solution design when sibling exists", () => {
    const mdPath = join(TMP_ROOT, "US_12345_test_cases.md");
    const sdPath = join(TMP_ROOT, "US_12345_solution_design_summary.md");
    writeFileSync(sdPath, "# Solution Design", "utf-8");

    const md = formatTcDraftToMarkdown(minimalDraft, mdPath);
    assert.ok(md.includes("## Supporting Documents"), "Missing Supporting Documents section");
    assert.ok(md.includes("Solution Design Summary"), "Missing SD label");
    assert.ok(md.includes("./US_12345_solution_design_summary.md"), "Missing relative link");
  });

  it("includes link to QA cheat sheet when sibling exists", () => {
    const mdPath = join(TMP_ROOT, "US_12345_test_cases.md");
    const csPath = join(TMP_ROOT, "US_12345_qa_cheat_sheet.md");
    writeFileSync(csPath, "# QA Cheat Sheet", "utf-8");

    const md = formatTcDraftToMarkdown(minimalDraft, mdPath);
    assert.ok(md.includes("QA Cheat Sheet"), "Missing QA label");
    assert.ok(md.includes("./US_12345_qa_cheat_sheet.md"), "Missing relative link");
  });

  it("includes both links when both siblings exist", () => {
    const mdPath = join(TMP_ROOT, "US_12345_test_cases.md");
    writeFileSync(join(TMP_ROOT, "US_12345_solution_design_summary.md"), "sd", "utf-8");
    writeFileSync(join(TMP_ROOT, "US_12345_qa_cheat_sheet.md"), "cs", "utf-8");

    const md = formatTcDraftToMarkdown(minimalDraft, mdPath);
    assert.ok(md.includes("Solution Design Summary"));
    assert.ok(md.includes("QA Cheat Sheet"));
  });

  it("omits Supporting Documents section when mdPath is not provided", () => {
    const md = formatTcDraftToMarkdown(minimalDraft);
    assert.ok(!md.includes("## Supporting Documents"));
  });

  it("works with directories containing spaces", () => {
    const spacedDir = join(TMP_ROOT, "MCP TC PREP");
    mkdirSync(spacedDir, { recursive: true });
    const mdPath = join(spacedDir, "US_12345_test_cases.md");
    const sdPath = join(spacedDir, "US_12345_solution_design_summary.md");
    writeFileSync(sdPath, "sd", "utf-8");

    const md = formatTcDraftToMarkdown(minimalDraft, mdPath);
    assert.ok(md.includes("## Supporting Documents"));
    assert.ok(md.includes("./US_12345_solution_design_summary.md"));
  });

  it("does NOT produce broken links for missing siblings", () => {
    const mdPath = join(TMP_ROOT, "US_12345_test_cases.md");
    // Only create one sibling, not the other
    writeFileSync(join(TMP_ROOT, "US_12345_solution_design_summary.md"), "sd", "utf-8");

    const md = formatTcDraftToMarkdown(minimalDraft, mdPath);
    assert.ok(md.includes("./US_12345_solution_design_summary.md"), "Existing link missing");
    assert.ok(!md.includes("qa_cheat_sheet"), "Should not include missing file link");
  });
});
