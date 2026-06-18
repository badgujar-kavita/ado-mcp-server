/**
 * Tests for `validateClientRoot` — the URI sanity check that prevents
 * Cursor's malformed `roots/list` responses (`file://`, `file:///`,
 * etc.) from silently degrading the workspace path to `/` and making
 * every credential read fail with a misleading "not configured" error.
 *
 * Live failure mode this guards against: Cursor returns a single root
 * with `uri: "file://"`, `fileURLToPath` returns `"/"` (root!) instead
 * of throwing, the existing resolver feeds `"/"` to the credential
 * loader, the loader probes `/.vortex-ado/config.json` (doesn't exist),
 * and the user sees "Run /ado-connect" — even though their config IS
 * on disk in the project they have open.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateClientRoot,
  malformedRootsMessage,
} from "./validate-root.ts";

test("validateClientRoot: rejects empty URI", () => {
  const result = validateClientRoot({ uri: "" });
  assert.ok("reason" in result);
  assert.match(result.reason, /empty URI/);
});

test("validateClientRoot: rejects non-file URI scheme", () => {
  const result = validateClientRoot({ uri: "https://example.com" });
  assert.ok("reason" in result);
  assert.match(result.reason, /non-file URI scheme/);
});

test("validateClientRoot: rejects file:// (Cursor's actual bug — converts to /)", () => {
  // This is the bug we hit: fileURLToPath("file://") returns "/", not
  // throwing. The validator must reject it as filesystem root.
  const result = validateClientRoot({ uri: "file://" });
  assert.ok("reason" in result);
  assert.match(result.reason, /filesystem root/);
});

test("validateClientRoot: rejects file:/// (also collapses to /)", () => {
  const result = validateClientRoot({ uri: "file:///" });
  assert.ok("reason" in result);
  assert.match(result.reason, /filesystem root/);
});

test("validateClientRoot: rejects path that does not exist on disk", () => {
  const result = validateClientRoot({
    uri: "file:///definitely/does/not/exist/" + Math.floor(Math.random() * 1e9),
  });
  assert.ok("reason" in result);
  assert.match(result.reason, /does not exist on disk/);
});

test("validateClientRoot: rejects path that is a file, not a directory", () => {
  const tmp = mkdtempSync(join(tmpdir(), "validate-root-test-"));
  const filePath = join(tmp, "not-a-dir.txt");
  writeFileSync(filePath, "");
  try {
    const result = validateClientRoot({ uri: pathToFileURL(filePath).href });
    assert.ok("reason" in result);
    assert.match(result.reason, /not a directory/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("validateClientRoot: accepts a real, existing directory", () => {
  const tmp = mkdtempSync(join(tmpdir(), "validate-root-test-"));
  try {
    const result = validateClientRoot({ uri: pathToFileURL(tmp).href });
    assert.ok("path" in result, `expected accepted, got rejection: ${JSON.stringify(result)}`);
    // pathToFileURL on macOS produces a /private/var/... path because
    // /tmp symlinks to /private/tmp. statSync follows the symlink, so
    // the validated path may be the resolved path. Both are valid.
    assert.match(result.path, /\/(?:private\/)?var\/folders\/.*\/validate-root-test-/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("malformedRootsMessage: lists every junk URI with its reason", () => {
  const msg = malformedRootsMessage([
    { uri: "file://", reason: "URI converts to filesystem root" },
    { uri: "https://example.com", reason: "non-file URI scheme" },
  ]);
  assert.match(msg, /file:\/\/.*filesystem root/);
  assert.match(msg, /https:\/\/example\.com.*non-file URI scheme/);
  // Recovery hint must mention the explicit-workspaceRoot workaround
  // and the "fully quit Cursor" alternative.
  assert.match(msg, /workspaceRoot=/);
  assert.match(msg, /Cmd\+Q/i);
});

test("malformedRootsMessage: handles the empty-rejections defensive case", () => {
  // Should never be called with [] in practice; the helper still
  // returns something sensible rather than crashing.
  const msg = malformedRootsMessage([]);
  assert.match(msg, /No workspace roots/);
});
