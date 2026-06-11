/**
 * Tests for qa_tc_comment_add and qa_tc_attachments_copy.
 *
 * Pattern matches test-cases.test.ts: handler-capture + StubAdoClient subclass.
 * The stub is broader here because the new tools exercise GET / POST / postBinary
 * / PATCH where qa_tc_update only used GET + PATCH.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AdoClient, AdoClientError } from "../ado-client.ts";
import { registerTestCaseTools } from "./test-cases.ts";

// ── Handler-capture helper ──────────────────────────────────────────────

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}>;

function captureHandlers(): { server: McpServer; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
      return {} as unknown;
    },
    tool: (_name: string, _desc: unknown, _schema: unknown, _handler: ToolHandler) => {
      return {} as unknown;
    },
  } as unknown as McpServer;
  return { server, handlers };
}

// ── Stub ADO client ─────────────────────────────────────────────────────

interface WiFixture {
  type: string;
  title: string;
  parentUsId?: number;
  attachments?: Array<{ filename: string; guid: string; bytes?: number }>;
}

class StubAdoClient extends AdoClient {
  public fixtures: Map<number, WiFixture>;
  public calls: {
    get: string[];
    post: Array<{ path: string; body: unknown }>;
    postBinary: Array<{ path: string; queryParams?: Record<string, string>; bytes: number }>;
    patch: Array<{ path: string; body: unknown }>;
  };
  /** Fail the comments POST for these work-item IDs. */
  public commentFailures: Map<number, string>;
  /** Fail the per-target PATCH for these work-item IDs. */
  public targetPatchFailures: Map<number, string>;
  /** Fail postBinary uploads for these filenames. */
  public uploadFailures: Set<string>;
  /** Existing AttachedFile filenames pre-attached to a target (for dedupe tests). */
  public preAttached: Map<number, string[]>;
  /** When set, GET on this ID throws 404. */
  public sourceMissing?: number;

  constructor(fixtures: Map<number, WiFixture>) {
    super("myorg", "myproj", "pat");
    this.fixtures = fixtures;
    this.calls = { get: [], post: [], postBinary: [], patch: [] };
    this.commentFailures = new Map();
    this.targetPatchFailures = new Map();
    this.uploadFailures = new Set();
    this.preAttached = new Map();
  }

  async get<T>(path: string, _apiVersion?: string, _queryParams?: Record<string, string>): Promise<T> {
    this.calls.get.push(path);
    const m = path.match(/\/_apis\/wit\/workitems\/(\d+)$/);
    if (!m) throw new Error(`StubAdoClient: unhandled GET ${path}`);
    const id = parseInt(m[1], 10);
    if (this.sourceMissing === id) {
      throw new AdoClientError(`Resource not found: ${id}`, 404, "Not Found");
    }
    const fx = this.fixtures.get(id);
    if (!fx) throw new AdoClientError(`Resource not found: ${id}`, 404, "Not Found");

    const relations: Array<{ rel: string; url: string; attributes: Record<string, unknown> }> = [];
    if (fx.parentUsId != null) {
      relations.push({
        rel: "Microsoft.VSTS.Common.TestedBy-Reverse",
        url: `https://dev.azure.com/myorg/myproj/_apis/wit/workitems/${fx.parentUsId}`,
        attributes: {},
      });
    }
    for (const att of fx.attachments ?? []) {
      relations.push({
        rel: "AttachedFile",
        url: `https://dev.azure.com/myorg/myproj/_apis/wit/attachments/${att.guid}`,
        attributes: { name: att.filename, resourceCreatedDate: "2026-06-01T00:00:00Z" },
      });
    }
    for (const filename of this.preAttached.get(id) ?? []) {
      relations.push({
        rel: "AttachedFile",
        url: `https://dev.azure.com/myorg/myproj/_apis/wit/attachments/preexisting-${filename}`,
        attributes: { name: filename },
      });
    }

    return {
      id,
      rev: 1,
      fields: { "System.WorkItemType": fx.type, "System.Title": fx.title },
      relations,
      url: `https://dev.azure.com/myorg/myproj/_apis/wit/workitems/${id}`,
    } as unknown as T;
  }

  async getBinary(_path: string, _apiVersion?: string, _queryParams?: Record<string, string>): Promise<{ buffer: ArrayBuffer; mimeType: string | null }> {
    // Tiny fake bytes — content doesn't matter for these tests.
    const buf = new ArrayBuffer(64);
    return { buffer: buf, mimeType: "application/octet-stream" };
  }

  async post<T>(path: string, body: unknown, _contentType?: string, _apiVersion?: string): Promise<T> {
    this.calls.post.push({ path, body });
    const m = path.match(/\/_apis\/wit\/workItems\/(\d+)\/comments$/);
    if (m) {
      const id = parseInt(m[1], 10);
      if (this.commentFailures.has(id)) {
        throw new Error(this.commentFailures.get(id));
      }
      return { commentId: 50, workItemId: id, version: 1 } as unknown as T;
    }
    throw new Error(`StubAdoClient: unhandled POST ${path}`);
  }

  async postBinary<T>(path: string, _body: ArrayBuffer | Buffer, _contentType?: string, _apiVersion?: string, queryParams?: Record<string, string>): Promise<T> {
    const filename = queryParams?.fileName ?? "(unknown)";
    this.calls.postBinary.push({ path, queryParams, bytes: 64 });
    if (this.uploadFailures.has(filename)) {
      throw new Error(`Mocked upload failure for ${filename}`);
    }
    return {
      id: `uploaded-${filename}`,
      url: `https://dev.azure.com/myorg/myproj/_apis/wit/attachments/uploaded-${filename}?fileName=${encodeURIComponent(filename)}`,
    } as unknown as T;
  }

  async patch<T>(path: string, body: unknown, _contentType?: string, _apiVersion?: string): Promise<T> {
    this.calls.patch.push({ path, body });
    const m = path.match(/\/_apis\/wit\/workitems\/(\d+)$/);
    if (!m) throw new Error(`StubAdoClient: unhandled PATCH ${path}`);
    const id = parseInt(m[1], 10);
    if (this.targetPatchFailures.has(id)) {
      throw new Error(this.targetPatchFailures.get(id));
    }
    const fx = this.fixtures.get(id);
    return {
      id,
      rev: 2,
      fields: { "System.WorkItemType": fx?.type ?? "Test Case", "System.Title": fx?.title ?? `TC ${id}` },
      url: `https://dev.azure.com/myorg/myproj/_apis/wit/workitems/${id}`,
    } as unknown as T;
  }

  async delete<T>(_path: string): Promise<T> {
    throw new Error("StubAdoClient: DELETE not expected");
  }
}

function registerAndGet(stub: StubAdoClient, name: string): ToolHandler {
  const { server, handlers } = captureHandlers();
  registerTestCaseTools(server, stub, null);
  return handlers.get(name)!;
}

function parseJsonText(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const txt = (result.content[0] as { type: "text"; text: string }).text;
  return JSON.parse(txt) as Record<string, unknown>;
}

// ════════════════════════════════════════════════════════════════════════
// qa_tc_comment_add
// ════════════════════════════════════════════════════════════════════════

test("qa_tc_comment_add single ID happy path: posts one comment, returns commentId + url", async () => {
  const fixtures = new Map<number, WiFixture>([
    [1001, { type: "Test Case", title: "TC_100_01", parentUsId: 100 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const tool = registerAndGet(stub, "qa_tc_comment_add");

  const result = await tool({ workItemId: 1001, commentHtml: "<p>FYI: see parent</p>" });
  assert.equal(result.isError, undefined);
  const body = parseJsonText(result);
  assert.equal(body.id, 1001);
  assert.equal(body.commentId, 50);
  assert.ok(typeof body.url === "string");
  // One POST to the comments endpoint.
  assert.equal(stub.calls.post.length, 1);
  assert.match(stub.calls.post[0].path, /\/_apis\/wit\/workItems\/1001\/comments$/);
  assert.deepEqual(stub.calls.post[0].body, { text: "<p>FYI: see parent</p>" });
});

test("qa_tc_comment_add bulk same US: posts to every TC, returns table", async () => {
  const fixtures = new Map<number, WiFixture>([
    [1001, { type: "Test Case", title: "TC_100_01", parentUsId: 100 }],
    [1002, { type: "Test Case", title: "TC_100_02", parentUsId: 100 }],
    [1003, { type: "Test Case", title: "TC_100_03", parentUsId: 100 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const tool = registerAndGet(stub, "qa_tc_comment_add");

  const result = await tool({ workItemId: [1001, 1002, 1003], commentHtml: "Hi team" });
  assert.equal(result.isError ?? false, false);
  const txt = (result.content[0] as { type: "text"; text: string }).text;
  assert.ok(txt.includes("✅ SUCCESS"));
  assert.ok(txt.includes("Posted comment to 3 test case(s)"));
  assert.equal(stub.calls.post.length, 3);
});

test("qa_tc_comment_add refuses non-Test-Case IDs with precheck-failed", async () => {
  const fixtures = new Map<number, WiFixture>([
    [9999, { type: "Bug", title: "A bug" }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const tool = registerAndGet(stub, "qa_tc_comment_add");

  const result = await tool({ workItemId: 9999, commentHtml: "x" });
  assert.equal(result.isError, true);
  const body = parseJsonText(result);
  assert.equal(body.reason, "precheck-failed");
  assert.equal(stub.calls.post.length, 0);
});

test("qa_tc_comment_add bulk crossing USs without ack → cross-us-bulk-update, no posts", async () => {
  const fixtures = new Map<number, WiFixture>([
    [1001, { type: "Test Case", title: "TC_100_01", parentUsId: 100 }],
    [2001, { type: "Test Case", title: "TC_200_01", parentUsId: 200 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const tool = registerAndGet(stub, "qa_tc_comment_add");

  const result = await tool({ workItemId: [1001, 2001], commentHtml: "x" });
  assert.equal(result.isError, true);
  const body = parseJsonText(result);
  assert.equal(body.reason, "cross-us-bulk-update");
  assert.equal(stub.calls.post.length, 0);
});

test("qa_tc_comment_add bulk crossing USs + acknowledgeCrossUs → proceeds", async () => {
  const fixtures = new Map<number, WiFixture>([
    [1001, { type: "Test Case", title: "TC_100_01", parentUsId: 100 }],
    [2001, { type: "Test Case", title: "TC_200_01", parentUsId: 200 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const tool = registerAndGet(stub, "qa_tc_comment_add");

  const result = await tool({ workItemId: [1001, 2001], commentHtml: "x", acknowledgeCrossUs: true });
  assert.equal(result.isError ?? false, false);
  assert.equal(stub.calls.post.length, 2);
});

test("qa_tc_comment_add partial failure → ⚠️ PARTIAL, isError: true, all attempted", async () => {
  const fixtures = new Map<number, WiFixture>([
    [1001, { type: "Test Case", title: "TC_100_01", parentUsId: 100 }],
    [1002, { type: "Test Case", title: "TC_100_02", parentUsId: 100 }],
    [1003, { type: "Test Case", title: "TC_100_03", parentUsId: 100 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  stub.commentFailures.set(1002, "500 Internal Server Error");
  const tool = registerAndGet(stub, "qa_tc_comment_add");

  const result = await tool({ workItemId: [1001, 1002, 1003], commentHtml: "x" });
  assert.equal(result.isError, true);
  const txt = (result.content[0] as { type: "text"; text: string }).text;
  assert.ok(txt.includes("⚠️ PARTIAL"));
  assert.ok(txt.includes("✅ Comment posted"));
  assert.ok(txt.includes("❌ Failed"));
  assert.ok(txt.includes("500 Internal Server Error"));
  assert.equal(stub.calls.post.length, 3); // all attempted
});

// ════════════════════════════════════════════════════════════════════════
// qa_tc_attachments_copy
// ════════════════════════════════════════════════════════════════════════

test("qa_tc_attachments_copy single target happy path: 2 files copied", async () => {
  const fixtures = new Map<number, WiFixture>([
    [500, { type: "User Story", title: "US-500", attachments: [
      { filename: "screenshot.png", guid: "abc-1" },
      { filename: "spec.pdf", guid: "abc-2" },
    ] }],
    [1001, { type: "Test Case", title: "TC_500_01", parentUsId: 500 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const tool = registerAndGet(stub, "qa_tc_attachments_copy");

  const result = await tool({ sourceWorkItemId: 500, targetTestCaseIds: 1001 });
  assert.equal(result.isError ?? false, false);
  const body = parseJsonText(result);
  assert.equal(body.sourceWorkItemId, 500);
  assert.equal(body.targetWorkItemId, 1001);
  assert.deepEqual(body.copied, ["screenshot.png", "spec.pdf"]);
  assert.deepEqual(body.skipped, []);
  assert.deepEqual(body.failed, []);
  // 2 uploads (one per source file), 1 PATCH (combined ops on one target).
  assert.equal(stub.calls.postBinary.length, 2);
  assert.equal(stub.calls.patch.length, 1);
  // The PATCH body should have 2 add /relations/- ops with rel: "AttachedFile".
  const patchBody = stub.calls.patch[0].body as Array<{ op: string; path: string; value: { rel: string; url: string; attributes: Record<string, string> } }>;
  assert.equal(patchBody.length, 2);
  assert.equal(patchBody[0].op, "add");
  assert.equal(patchBody[0].path, "/relations/-");
  assert.equal(patchBody[0].value.rel, "AttachedFile");
  assert.ok(patchBody[0].value.url.includes("uploaded-screenshot.png"));
  assert.equal(patchBody[0].value.attributes.comment, "Copied from work item #500");
});

test("qa_tc_attachments_copy bulk targets same US: same uploads applied to every target", async () => {
  const fixtures = new Map<number, WiFixture>([
    [500, { type: "User Story", title: "US-500", attachments: [{ filename: "spec.pdf", guid: "g1" }] }],
    [1001, { type: "Test Case", title: "TC_500_01", parentUsId: 500 }],
    [1002, { type: "Test Case", title: "TC_500_02", parentUsId: 500 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const tool = registerAndGet(stub, "qa_tc_attachments_copy");

  const result = await tool({ sourceWorkItemId: 500, targetTestCaseIds: [1001, 1002] });
  assert.equal(result.isError ?? false, false);
  const txt = (result.content[0] as { type: "text"; text: string }).text;
  assert.ok(txt.includes("✅ SUCCESS"));
  // ONE upload, TWO patches (one per target).
  assert.equal(stub.calls.postBinary.length, 1);
  assert.equal(stub.calls.patch.length, 2);
});

test("qa_tc_attachments_copy dedupe by filename: existing attachment skipped on the matching target only", async () => {
  const fixtures = new Map<number, WiFixture>([
    [500, { type: "User Story", title: "US-500", attachments: [
      { filename: "spec.pdf", guid: "g1" },
      { filename: "screenshot.png", guid: "g2" },
    ] }],
    [1001, { type: "Test Case", title: "TC_500_01", parentUsId: 500 }],
    [1002, { type: "Test Case", title: "TC_500_02", parentUsId: 500 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  // 1001 already has spec.pdf; 1002 is empty.
  stub.preAttached.set(1001, ["spec.pdf"]);
  const tool = registerAndGet(stub, "qa_tc_attachments_copy");

  const result = await tool({ sourceWorkItemId: 500, targetTestCaseIds: [1001, 1002] });
  assert.equal(result.isError ?? false, false);
  // Both files uploaded once (regardless of dedupe — upload is per file, not per target).
  assert.equal(stub.calls.postBinary.length, 2);
  // 1001 PATCH should only attach screenshot.png; 1002 PATCH attaches both.
  assert.equal(stub.calls.patch.length, 2);
  const patches = stub.calls.patch.map((p) => ({
    id: parseInt(p.path.match(/(\d+)$/)![1], 10),
    count: (p.body as Array<unknown>).length,
  }));
  const p1001 = patches.find((p) => p.id === 1001)!;
  const p1002 = patches.find((p) => p.id === 1002)!;
  assert.equal(p1001.count, 1);
  assert.equal(p1002.count, 2);
});

test("qa_tc_attachments_copy with skipDuplicatesByFilename: false → re-copies even if filename exists", async () => {
  const fixtures = new Map<number, WiFixture>([
    [500, { type: "User Story", title: "US-500", attachments: [{ filename: "spec.pdf", guid: "g1" }] }],
    [1001, { type: "Test Case", title: "TC_500_01", parentUsId: 500 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  stub.preAttached.set(1001, ["spec.pdf"]);
  const tool = registerAndGet(stub, "qa_tc_attachments_copy");

  const result = await tool({ sourceWorkItemId: 500, targetTestCaseIds: 1001, skipDuplicatesByFilename: false });
  assert.equal(result.isError ?? false, false);
  // Should still attach because dedupe is disabled.
  assert.equal(stub.calls.patch.length, 1);
  const patchBody = stub.calls.patch[0].body as Array<unknown>;
  assert.equal(patchBody.length, 1);
});

test("qa_tc_attachments_copy with filenameFilter: only matching files copied", async () => {
  const fixtures = new Map<number, WiFixture>([
    [500, { type: "User Story", title: "US-500", attachments: [
      { filename: "spec.pdf", guid: "g1" },
      { filename: "screenshot.png", guid: "g2" },
      { filename: "notes.txt", guid: "g3" },
    ] }],
    [1001, { type: "Test Case", title: "TC_500_01", parentUsId: 500 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const tool = registerAndGet(stub, "qa_tc_attachments_copy");

  const result = await tool({ sourceWorkItemId: 500, targetTestCaseIds: 1001, filenameFilter: ["spec.pdf", "screenshot.png"] });
  assert.equal(result.isError ?? false, false);
  // Two uploads (filtered).
  assert.equal(stub.calls.postBinary.length, 2);
  const uploaded = stub.calls.postBinary.map((c) => c.queryParams?.fileName).sort();
  assert.deepEqual(uploaded, ["screenshot.png", "spec.pdf"]);
});

test("qa_tc_attachments_copy source has no attachments → no-attachments-to-copy NOOP", async () => {
  const fixtures = new Map<number, WiFixture>([
    [500, { type: "User Story", title: "US-500" }],
    [1001, { type: "Test Case", title: "TC_500_01", parentUsId: 500 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const tool = registerAndGet(stub, "qa_tc_attachments_copy");

  const result = await tool({ sourceWorkItemId: 500, targetTestCaseIds: 1001 });
  assert.equal(result.isError ?? false, false); // NOOP isn't an error
  const body = parseJsonText(result);
  assert.equal(body.reason, "no-attachments-to-copy");
  // No mutations.
  assert.equal(stub.calls.postBinary.length, 0);
  assert.equal(stub.calls.patch.length, 0);
});

test("qa_tc_attachments_copy source not found → source-not-found error", async () => {
  const fixtures = new Map<number, WiFixture>([
    [1001, { type: "Test Case", title: "TC_500_01", parentUsId: 500 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  stub.sourceMissing = 9999;
  const tool = registerAndGet(stub, "qa_tc_attachments_copy");

  const result = await tool({ sourceWorkItemId: 9999, targetTestCaseIds: 1001 });
  assert.equal(result.isError, true);
  const body = parseJsonText(result);
  assert.equal(body.reason, "source-not-found");
  assert.equal(stub.calls.postBinary.length, 0);
  assert.equal(stub.calls.patch.length, 0);
});

test("qa_tc_attachments_copy non-TC target refused with precheck-failed (no source fetch)", async () => {
  const fixtures = new Map<number, WiFixture>([
    [500, { type: "User Story", title: "US-500", attachments: [{ filename: "x.png", guid: "g1" }] }],
    [9999, { type: "Bug", title: "Not a TC" }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const tool = registerAndGet(stub, "qa_tc_attachments_copy");

  const result = await tool({ sourceWorkItemId: 500, targetTestCaseIds: 9999 });
  assert.equal(result.isError, true);
  const body = parseJsonText(result);
  assert.equal(body.reason, "precheck-failed");
  // Crucially: precheck blocked BEFORE the source was fetched and BEFORE any upload.
  assert.equal(stub.calls.postBinary.length, 0);
  assert.equal(stub.calls.patch.length, 0);
});

test("qa_tc_attachments_copy upload failure for one file → other file still copied, reported in uploadFailures", async () => {
  const fixtures = new Map<number, WiFixture>([
    [500, { type: "User Story", title: "US-500", attachments: [
      { filename: "good.png", guid: "g1" },
      { filename: "bad.png", guid: "g2" },
    ] }],
    [1001, { type: "Test Case", title: "TC_500_01", parentUsId: 500 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  stub.uploadFailures.add("bad.png");
  const tool = registerAndGet(stub, "qa_tc_attachments_copy");

  const result = await tool({ sourceWorkItemId: 500, targetTestCaseIds: 1001 });
  assert.equal(result.isError, true); // upload failure surfaces as partial
  const body = parseJsonText(result);
  // Single-target path returns JSON with copied/uploadFailures.
  assert.deepEqual(body.copied, ["good.png"]);
  const uploadFailures = body.uploadFailures as Array<{ filename: string }>;
  assert.equal(uploadFailures.length, 1);
  assert.equal(uploadFailures[0].filename, "bad.png");
  // PATCH still landed for the good file.
  assert.equal(stub.calls.patch.length, 1);
});

test("qa_tc_attachments_copy all uploads fail → all-uploads-failed BLOCK, no PATCH", async () => {
  const fixtures = new Map<number, WiFixture>([
    [500, { type: "User Story", title: "US-500", attachments: [
      { filename: "a.png", guid: "g1" },
      { filename: "b.png", guid: "g2" },
    ] }],
    [1001, { type: "Test Case", title: "TC_500_01", parentUsId: 500 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  stub.uploadFailures.add("a.png");
  stub.uploadFailures.add("b.png");
  const tool = registerAndGet(stub, "qa_tc_attachments_copy");

  const result = await tool({ sourceWorkItemId: 500, targetTestCaseIds: 1001 });
  assert.equal(result.isError, true);
  const body = parseJsonText(result);
  assert.equal(body.reason, "all-uploads-failed");
  assert.equal(stub.calls.patch.length, 0);
});

test("qa_tc_attachments_copy filter matches nothing → noop with availableFilenames listed", async () => {
  const fixtures = new Map<number, WiFixture>([
    [500, { type: "User Story", title: "US-500", attachments: [{ filename: "spec.pdf", guid: "g1" }] }],
    [1001, { type: "Test Case", title: "TC_500_01", parentUsId: 500 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const tool = registerAndGet(stub, "qa_tc_attachments_copy");

  const result = await tool({ sourceWorkItemId: 500, targetTestCaseIds: 1001, filenameFilter: ["does-not-exist.pdf"] });
  assert.equal(result.isError ?? false, false);
  const body = parseJsonText(result);
  assert.equal(body.reason, "no-attachments-to-copy");
  assert.deepEqual(body.availableFilenames, ["spec.pdf"]);
});

test("qa_tc_attachments_copy custom copyComment is written to relation attributes.comment", async () => {
  const fixtures = new Map<number, WiFixture>([
    [500, { type: "User Story", title: "US-500", attachments: [{ filename: "spec.pdf", guid: "g1" }] }],
    [1001, { type: "Test Case", title: "TC_500_01", parentUsId: 500 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const tool = registerAndGet(stub, "qa_tc_attachments_copy");

  await tool({ sourceWorkItemId: 500, targetTestCaseIds: 1001, copyComment: "Per DoD comment in parent" });
  const patchBody = stub.calls.patch[0].body as Array<{ value: { attributes: { comment: string } } }>;
  assert.equal(patchBody[0].value.attributes.comment, "Per DoD comment in parent");
});

test("qa_tc_attachments_copy bulk crossing USs without ack → cross-us-bulk-update, no source fetch yet", async () => {
  const fixtures = new Map<number, WiFixture>([
    [500, { type: "User Story", title: "US-500", attachments: [{ filename: "spec.pdf", guid: "g1" }] }],
    [1001, { type: "Test Case", title: "TC_100_01", parentUsId: 100 }],
    [2001, { type: "Test Case", title: "TC_200_01", parentUsId: 200 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const tool = registerAndGet(stub, "qa_tc_attachments_copy");

  const result = await tool({ sourceWorkItemId: 500, targetTestCaseIds: [1001, 2001] });
  assert.equal(result.isError, true);
  const body = parseJsonText(result);
  assert.equal(body.reason, "cross-us-bulk-update");
  // Precheck blocked before source fetch.
  assert.equal(stub.calls.postBinary.length, 0);
  assert.equal(stub.calls.patch.length, 0);
});
