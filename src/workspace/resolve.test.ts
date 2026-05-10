/**
 * Workspace resolver tests — every path through resolveWorkspace.
 *
 * Use real tmpdirs for the success paths (so accessSync writability check
 * actually runs against a real filesystem). Error paths use synthetic inputs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspace } from "./resolve.ts";
import { WorkspaceError } from "./errors.ts";

// ── clientRoots happy path ───────────────────────────────────────────────

test("resolveWorkspace: returns first file:// clientRoot when present", () => {
  const dir = mkdtempSync(join(tmpdir(), "ado-ws-"));
  try {
    const result = resolveWorkspace({
      clientRoots: [{ uri: `file://${dir}` }],
    });
    assert.equal(result, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveWorkspace: skips non-file:// roots and uses next valid one", () => {
  const dir = mkdtempSync(join(tmpdir(), "ado-ws-"));
  try {
    const result = resolveWorkspace({
      clientRoots: [
        { uri: "https://not-a-file-uri" },
        { uri: `file://${dir}` },
      ],
    });
    assert.equal(result, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── explicit arg happy path ──────────────────────────────────────────────

test("resolveWorkspace: returns explicit absolute path when no clientRoots", () => {
  const dir = mkdtempSync(join(tmpdir(), "ado-ws-"));
  try {
    const result = resolveWorkspace({ explicit: dir });
    assert.equal(result, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveWorkspace: clientRoots takes precedence over explicit when both supplied", () => {
  const dir1 = mkdtempSync(join(tmpdir(), "ado-ws-1-"));
  const dir2 = mkdtempSync(join(tmpdir(), "ado-ws-2-"));
  try {
    const result = resolveWorkspace({
      clientRoots: [{ uri: `file://${dir1}` }],
      explicit: dir2,
    });
    assert.equal(result, dir1);
  } finally {
    rmSync(dir1, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  }
});

// ── error paths ──────────────────────────────────────────────────────────

test("resolveWorkspace: UNRESOLVED when no clientRoots and no explicit", () => {
  try {
    resolveWorkspace({});
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof WorkspaceError);
    assert.equal((err as WorkspaceError).code, "UNRESOLVED");
  }
});

test("resolveWorkspace: NOT_FOUND when explicit is a relative path", () => {
  try {
    resolveWorkspace({ explicit: "relative/path" });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof WorkspaceError);
    assert.equal((err as WorkspaceError).code, "NOT_FOUND");
  }
});

test("resolveWorkspace: NOT_FOUND when path doesn't exist on disk", () => {
  try {
    resolveWorkspace({ explicit: "/this/path/definitely/does/not/exist/abc123" });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof WorkspaceError);
    assert.equal((err as WorkspaceError).code, "NOT_FOUND");
  }
});

test("resolveWorkspace: NOT_DIRECTORY when path points to a file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ado-ws-"));
  const file = join(dir, "not-a-dir.txt");
  writeFileSync(file, "");
  try {
    resolveWorkspace({ explicit: file });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof WorkspaceError);
    assert.equal((err as WorkspaceError).code, "NOT_DIRECTORY");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── No fallback to cwd / env ─────────────────────────────────────────────

test("resolveWorkspace: never falls back to process.cwd when both inputs missing", () => {
  // Even though process.cwd() is a valid directory, the resolver MUST throw.
  try {
    resolveWorkspace({ clientRoots: undefined, explicit: undefined });
    assert.fail("should have thrown — no implicit cwd fallback allowed");
  } catch (err) {
    assert.ok(err instanceof WorkspaceError);
    assert.equal((err as WorkspaceError).code, "UNRESOLVED");
  }
});

test("resolveWorkspace: empty clientRoots array still falls through to explicit", () => {
  const dir = mkdtempSync(join(tmpdir(), "ado-ws-"));
  try {
    const result = resolveWorkspace({ clientRoots: [], explicit: dir });
    assert.equal(result, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveWorkspace: clientRoots with all non-file:// URIs falls through to explicit", () => {
  const dir = mkdtempSync(join(tmpdir(), "ado-ws-"));
  try {
    const result = resolveWorkspace({
      clientRoots: [{ uri: "https://nope" }, { uri: "data:text/plain,hi" }],
      explicit: dir,
    });
    assert.equal(result, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveWorkspace: clientRoots with all non-file:// AND no explicit → UNRESOLVED", () => {
  try {
    resolveWorkspace({ clientRoots: [{ uri: "https://nope" }] });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof WorkspaceError);
    assert.equal((err as WorkspaceError).code, "UNRESOLVED");
  }
});
