import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import {
  toFileUrl,
  buildFileReference,
  safeRelativeMarkdownLink,
  formatSavedFileResponse,
} from "../helpers/file-links.ts";

const TMP_ROOT = join(tmpdir(), "ado-testforge-link-tests");

function setup() {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
}

function cleanup() {
  rmSync(TMP_ROOT, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// toFileUrl
// ---------------------------------------------------------------------------
describe("toFileUrl", () => {
  it("produces file:/// URL (triple slash) for absolute paths", () => {
    const url = toFileUrl("/tmp/test.md");
    assert.ok(url.startsWith("file:///"), `Expected file:/// prefix, got: ${url}`);
  });

  it("encodes spaces in path", () => {
    const url = toFileUrl("/Users/me/MCP TC PREP/draft.md");
    assert.ok(url.includes("MCP%20TC%20PREP"), `Spaces not encoded: ${url}`);
    assert.ok(!url.includes(" "), `Raw spaces found: ${url}`);
  });

  it("encodes # in path", () => {
    const url = toFileUrl("/tmp/US#123/test.md");
    assert.ok(url.includes("US%23123"), `# not encoded: ${url}`);
    assert.ok(!url.includes("#"), `Raw # found: ${url}`);
  });

  it("encodes % in path", () => {
    const url = toFileUrl("/tmp/100%/test.md");
    assert.ok(url.includes("100%25"), `% not encoded: ${url}`);
  });

  it("handles parentheses in path without breaking the URL", () => {
    const url = toFileUrl("/tmp/folder (copy)/test.md");
    // Parentheses are valid URI chars per RFC 3986; pathToFileURL keeps them literal.
    // The key requirement: the URL is well-formed and contains the folder name.
    assert.ok(url.includes("folder"), `Folder missing: ${url}`);
    assert.ok(url.includes("copy"), `Copy missing: ${url}`);
    assert.ok(url.startsWith("file:///"), `Bad prefix: ${url}`);
  });

  it("matches Node pathToFileURL output", () => {
    const paths = [
      "/simple/path.md",
      "/path with spaces/file.md",
      "/Users/me/MCP TC PREP/tc-drafts/US_123_test_cases.md",
      "/path/with#hash/file.md",
      "/path/with%percent/file.md",
    ];
    for (const p of paths) {
      const expected = pathToFileURL(p).href;
      const actual = toFileUrl(p);
      assert.equal(actual, expected, `Mismatch for "${p}": got ${actual}, expected ${expected}`);
    }
  });
});

// ---------------------------------------------------------------------------
// buildFileReference
// ---------------------------------------------------------------------------
describe("buildFileReference", () => {
  it("returns all required fields", () => {
    const ref = buildFileReference("/Users/me/proj/tc-drafts/US_123_test_cases.md", "/Users/me/proj");
    assert.equal(ref.fileName, "US_123_test_cases.md");
    assert.equal(ref.absolutePath, "/Users/me/proj/tc-drafts/US_123_test_cases.md");
    assert.equal(ref.workspaceRelativePath, "tc-drafts/US_123_test_cases.md");
    assert.ok(ref.fileUrl.startsWith("file:///"));
  });

  it("handles workspace paths with spaces", () => {
    const ref = buildFileReference(
      "/Users/me/MCP TC PREP/tc-drafts/US_999_test_cases.md",
      "/Users/me/MCP TC PREP",
    );
    assert.equal(ref.workspaceRelativePath, "tc-drafts/US_999_test_cases.md");
    assert.ok(ref.fileUrl.includes("MCP%20TC%20PREP"));
  });

  it("falls back to absolutePath when workspaceRoot is null", () => {
    const ref = buildFileReference("/tmp/test.md", null);
    assert.equal(ref.workspaceRelativePath, "/tmp/test.md");
  });

  it("falls back to absolutePath when workspaceRoot is undefined", () => {
    const ref = buildFileReference("/tmp/test.md");
    assert.equal(ref.workspaceRelativePath, "/tmp/test.md");
  });
});

// ---------------------------------------------------------------------------
// safeRelativeMarkdownLink
// ---------------------------------------------------------------------------
describe("safeRelativeMarkdownLink", () => {
  beforeEach(setup);
  afterEach(cleanup);

  it("returns relative link for existing sibling file", () => {
    const from = join(TMP_ROOT, "US_123_test_cases.md");
    const target = join(TMP_ROOT, "US_123_cheat_sheet.md");
    writeFileSync(from, "# test", "utf-8");
    writeFileSync(target, "# cheat", "utf-8");

    const link = safeRelativeMarkdownLink(from, target, "Cheat Sheet");
    assert.ok(link !== null);
    assert.ok(link!.includes("./US_123_cheat_sheet.md"), `Link not relative: ${link}`);
    assert.ok(link!.includes("[Cheat Sheet]"), `Label missing: ${link}`);
  });

  it("returns null for missing target file", () => {
    const from = join(TMP_ROOT, "US_123_test_cases.md");
    const target = join(TMP_ROOT, "US_123_nonexistent.md");
    writeFileSync(from, "# test", "utf-8");

    const link = safeRelativeMarkdownLink(from, target, "Missing");
    assert.equal(link, null);
  });

  it("handles nested subfolder targets", () => {
    const subdir = join(TMP_ROOT, "sub");
    mkdirSync(subdir, { recursive: true });
    const from = join(TMP_ROOT, "US_123_test_cases.md");
    const target = join(subdir, "nested.md");
    writeFileSync(from, "# test", "utf-8");
    writeFileSync(target, "# nested", "utf-8");

    const link = safeRelativeMarkdownLink(from, target, "Nested");
    assert.ok(link !== null);
    assert.ok(link!.includes("sub/nested.md"), `Path wrong: ${link}`);
  });

  it("handles file names with spaces", () => {
    const from = join(TMP_ROOT, "my test.md");
    const target = join(TMP_ROOT, "my target file.md");
    writeFileSync(from, "x", "utf-8");
    writeFileSync(target, "y", "utf-8");

    const link = safeRelativeMarkdownLink(from, target, "Target");
    assert.ok(link !== null);
    assert.ok(link!.includes("my target file.md"), `File name wrong: ${link}`);
  });

  it("handles file names with special characters", () => {
    const from = join(TMP_ROOT, "from.md");
    const target = join(TMP_ROOT, "file#1 (copy).md");
    writeFileSync(from, "x", "utf-8");
    writeFileSync(target, "y", "utf-8");

    const link = safeRelativeMarkdownLink(from, target, "Special");
    assert.ok(link !== null);
    assert.ok(link!.includes("file#1 (copy).md"), `Special chars wrong: ${link}`);
  });
});

// ---------------------------------------------------------------------------
// formatSavedFileResponse
// ---------------------------------------------------------------------------
describe("formatSavedFileResponse", () => {
  it("produces markdown with file link and path", () => {
    const ref = buildFileReference("/tmp/US_123_test_cases.md");
    const text = formatSavedFileResponse(ref, "**Version:** 1");
    assert.ok(text.includes("[US_123_test_cases.md]"), "Missing link text");
    assert.ok(text.includes("file:///"), "Missing file URL");
    assert.ok(text.includes("**Path:**"), "Missing path line");
    assert.ok(text.includes("**Version:** 1"), "Missing extras");
  });

  it("works without extras", () => {
    const ref = buildFileReference("/tmp/test.md");
    const text = formatSavedFileResponse(ref);
    assert.ok(text.includes("[test.md]"));
    assert.ok(!text.includes("undefined"));
  });
});

// ---------------------------------------------------------------------------
// Integration: workspace paths with spaces end-to-end
// ---------------------------------------------------------------------------
describe("End-to-end: workspace with spaces", () => {
  const SPACE_DIR = join(TMP_ROOT, "MCP TC PREP", "tc-drafts");

  beforeEach(() => {
    setup();
    mkdirSync(SPACE_DIR, { recursive: true });
  });
  afterEach(cleanup);

  it("buildFileReference + toFileUrl produces valid URL for spaced path", () => {
    const filePath = join(SPACE_DIR, "US_999_test_cases.md");
    writeFileSync(filePath, "# test", "utf-8");

    const ref = buildFileReference(filePath, join(TMP_ROOT, "MCP TC PREP"));
    assert.ok(ref.fileUrl.startsWith("file:///"));
    assert.ok(!ref.fileUrl.includes(" "), "URL must not contain raw spaces");
    assert.ok(ref.fileUrl.includes("MCP%20TC%20PREP"));
    assert.equal(ref.workspaceRelativePath, "tc-drafts/US_999_test_cases.md");
  });

  it("sibling links work in spaced directories", () => {
    const from = join(SPACE_DIR, "US_999_test_cases.md");
    const target = join(SPACE_DIR, "US_999_qa_cheat_sheet.md");
    writeFileSync(from, "# draft", "utf-8");
    writeFileSync(target, "# cheat", "utf-8");

    const link = safeRelativeMarkdownLink(from, target, "QA Cheat Sheet");
    assert.ok(link !== null);
    assert.equal(link, "[QA Cheat Sheet](./US_999_qa_cheat_sheet.md)");
  });
});
