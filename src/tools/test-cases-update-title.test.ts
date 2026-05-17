/**
 * Tests for qa_tc_update title-preservation behaviour.
 *
 * Closes the gap where a raw `title` write would clobber a structured TC title
 * (e.g. `TC_5678_REG_01 -> Foo -> Bar -> Existing summary`) into bare user
 * text, losing the TC ID prefix, feature tags, and category tag.
 *
 * Coverage:
 *   1. Existing parses, new parses → write as-is.
 *   2. Existing parses, new doesn't, no useCaseSummary → tc-title-shape-mismatch.
 *   3. Existing parses + useCaseSummary → reconstruct preserving prefix.
 *   4. Existing parses with category tag + useCaseSummary → reconstruct preserving REG/E2E/etc.
 *   5. Existing doesn't parse (legacy) → write new title as-is.
 *   6. forceTitleOverwrite: true + bad title → write as-is.
 *   7. Both title and useCaseSummary supplied → error.
 *   8. Bulk: mixed canonical + suffixed TCs + useCaseSummary → each gets its own prefix preserved.
 *   9. Bulk: one parseable + one legacy with `title` → only the parseable one fails validation.
 *  10. (Bonus) useCaseSummary with a TC that has a legacy/unparseable title → unparseable error.
 *
 * Pattern matches `test-cases.test.ts` — handler-capture + StubAdoClient.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AdoClient } from "../ado-client.ts";
import { registerTestCaseTools } from "./test-cases.ts";
import type { JsonPatchOperation } from "../types.ts";

// ── Handler-capture helper ──────────────────────────────────────────────

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
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

// ── StubAdoClient — captures every PATCH body so tests can inspect title ops ──

interface TcFixture {
  type: string;               // System.WorkItemType (e.g. "Test Case")
  title: string;
  parentUsId?: number;        // synthesizes TestedBy-Reverse relation
}

class StubAdoClient extends AdoClient {
  public fixtures: Map<number, TcFixture>;
  public calls: { get: string[]; patch: Array<{ id: number; ops: JsonPatchOperation[] }> };

  constructor(fixtures: Map<number, TcFixture>) {
    super("myorg", "myproj", "pat");
    this.fixtures = fixtures;
    this.calls = { get: [], patch: [] };
  }

  async get<T>(path: string, _apiVersion?: string, _queryParams?: Record<string, string>): Promise<T> {
    this.calls.get.push(path);
    const m = path.match(/\/_apis\/wit\/workitems\/(\d+)$/);
    if (!m) throw new Error(`StubAdoClient: unhandled GET ${path}`);
    const id = parseInt(m[1], 10);
    const fx = this.fixtures.get(id);
    if (!fx) throw new Error(`StubAdoClient: no fixture for work-item ${id}`);
    const relations = fx.parentUsId != null
      ? [{
          rel: "Microsoft.VSTS.Common.TestedBy-Reverse",
          url: `https://example/_apis/wit/workitems/${fx.parentUsId}`,
          attributes: {},
        }]
      : [];
    return {
      id,
      rev: 1,
      fields: { "System.WorkItemType": fx.type, "System.Title": fx.title },
      relations,
      url: `https://example/_apis/wit/workitems/${id}`,
    } as unknown as T;
  }

  async patch<T>(path: string, body: unknown, _contentType?: string, _apiVersion?: string): Promise<T> {
    const m = path.match(/\/_apis\/wit\/workitems\/(\d+)$/);
    if (!m) throw new Error(`StubAdoClient: unhandled PATCH ${path}`);
    const id = parseInt(m[1], 10);
    this.calls.patch.push({ id, ops: body as JsonPatchOperation[] });
    const fx = this.fixtures.get(id);
    // Reflect the new title back when the PATCH includes a title op (so the
    // tool's per-ID success report reflects what was actually written).
    const titleOp = (body as JsonPatchOperation[]).find((op) => op.path === "/fields/System.Title");
    const newTitle = titleOp ? (titleOp.value as string) : (fx?.title ?? `TC ${id}`);
    return {
      id,
      rev: 2,
      fields: { "System.WorkItemType": fx?.type ?? "Test Case", "System.Title": newTitle },
      url: `https://example/_apis/wit/workitems/${id}`,
    } as unknown as T;
  }

  async post<T>(_path: string, _body: unknown): Promise<T> {
    throw new Error("StubAdoClient: POST not expected");
  }

  async delete<T>(_path: string): Promise<T> {
    throw new Error("StubAdoClient: DELETE not expected");
  }
}

function registerAndGetUpdate(stub: StubAdoClient): ToolHandler {
  const { server, handlers } = captureHandlers();
  registerTestCaseTools(server, stub, null);
  return handlers.get("qa_tc_update")!;
}

function parseJsonText(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const txt = (result.content[0] as { type: "text"; text: string }).text;
  return JSON.parse(txt) as Record<string, unknown>;
}

function titleWritten(stub: StubAdoClient, id: number): string | undefined {
  const call = stub.calls.patch.find((c) => c.id === id);
  if (!call) return undefined;
  const op = call.ops.find((o) => o.path === "/fields/System.Title");
  return op ? (op.value as string) : undefined;
}

// ── Case 1: existing parses, new parses → writes as-is ──────────────────

test("qa_tc_update title: structured new title writes through unchanged", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_100_01 -> Old Feature -> Old Summary", parentUsId: 100 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const newTitle = "TC_100_01 -> New Feature -> New Summary";
  const result = await update({ workItemId: 1001, title: newTitle });
  assert.equal(result.isError ?? false, false);
  assert.equal(titleWritten(stub, 1001), newTitle);
});

// ── Case 2: existing parses, new doesn't, no useCaseSummary → block ─────

test("qa_tc_update title: bad new title against parseable existing → tc-title-shape-mismatch (block, no PATCH)", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_5678_REG_01 -> Foo -> Bar -> Use case", parentUsId: 5678 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: 1001, title: "New Title" });
  assert.equal(result.isError, true);
  const body = parseJsonText(result);
  assert.equal(body.status, "needs-input");
  assert.equal(body.reason, "tc-title-shape-mismatch");
  assert.equal((body.newTitleProvided as string), "New Title");
  const options = body.options as Array<{ key: string }>;
  assert.deepEqual(options.map((o) => o.key), ["A", "B", "C"]);
  const existing = body.existingTitles as Array<{ id: number; title: string }>;
  assert.equal(existing.length, 1);
  assert.equal(existing[0].id, 1001);
  // Critically: no PATCH fired.
  assert.equal(stub.calls.patch.length, 0);
});

// ── Case 3: useCaseSummary → reconstruct preserving prefix (no category tag) ─

test("qa_tc_update useCaseSummary: reconstructs preserving canonical TC ID + featureTags", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_5678_01 -> Foo -> Bar -> Existing summary", parentUsId: 5678 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: 1001, useCaseSummary: "Brand-new summary" });
  assert.equal(result.isError ?? false, false);
  assert.equal(titleWritten(stub, 1001), "TC_5678_01 -> Foo -> Bar -> Brand-new summary");
});

// ── Case 4: useCaseSummary preserves the REG category tag ───────────────

test("qa_tc_update useCaseSummary: reconstructs preserving suffixed TC ID + REG tag", async () => {
  const fixtures = new Map<number, TcFixture>([
    [2001, { type: "Test Case", title: "TC_1234_REG_03 -> Login -> Returning user -> Old summary", parentUsId: 1234 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: 2001, useCaseSummary: "Replaced summary" });
  assert.equal(result.isError ?? false, false);
  assert.equal(
    titleWritten(stub, 2001),
    "TC_1234_REG_03 -> Login -> Returning user -> Replaced summary",
  );
});

// ── Case 5: existing legacy title, new title doesn't parse → write as-is ─

test("qa_tc_update title: legacy existing + non-conventional new → writes as-is (no validation block)", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "Legacy TC: free-form name", parentUsId: 100 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: 1001, title: "Another Free-form Name" });
  assert.equal(result.isError ?? false, false);
  assert.equal(titleWritten(stub, 1001), "Another Free-form Name");
});

// ── Case 6: forceTitleOverwrite skips validation entirely ───────────────

test("qa_tc_update title + forceTitleOverwrite: bypasses validation even on parseable existing", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_5678_REG_01 -> Foo -> Bar -> Existing", parentUsId: 5678 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: 1001, title: "Plain New Title", forceTitleOverwrite: true });
  assert.equal(result.isError ?? false, false);
  assert.equal(titleWritten(stub, 1001), "Plain New Title");
});

// ── Case 7: title + useCaseSummary mutually exclusive ───────────────────

test("qa_tc_update title + useCaseSummary together → error, no PATCH", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_100_01 -> X -> Y", parentUsId: 100 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: 1001, title: "TC_100_01 -> X -> Z", useCaseSummary: "Z" });
  assert.equal(result.isError, true);
  const body = parseJsonText(result);
  assert.equal(body.status, "error");
  assert.equal(body.reason, "title-and-use-case-summary-both-supplied");
  // The error is upfront — no GETs or PATCHes attempted.
  assert.equal(stub.calls.patch.length, 0);
});

// ── Case 8: bulk — mixed canonical + suffixed, useCaseSummary preserves each prefix ─

test("qa_tc_update bulk useCaseSummary: each TC reconstructs with its own prefix preserved", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_5678_01 -> Login -> Existing one", parentUsId: 5678 }],
    [1002, { type: "Test Case", title: "TC_5678_REG_02 -> Login -> Returning -> Existing two", parentUsId: 5678 }],
    [1003, { type: "Test Case", title: "TC_5678_E2E_03 -> Order -> Cash -> Existing three", parentUsId: 5678 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: [1001, 1002, 1003], useCaseSummary: "Unified new summary" });
  assert.equal(result.isError ?? false, false);
  // Each TC gets its own prefix preserved.
  assert.equal(titleWritten(stub, 1001), "TC_5678_01 -> Login -> Unified new summary");
  assert.equal(
    titleWritten(stub, 1002),
    "TC_5678_REG_02 -> Login -> Returning -> Unified new summary",
  );
  assert.equal(
    titleWritten(stub, 1003),
    "TC_5678_E2E_03 -> Order -> Cash -> Unified new summary",
  );
});

// ── Case 9: bulk with `title` arg — one TC parseable, one legacy ────────

test("qa_tc_update bulk title: one parseable + one legacy → tc-title-shape-mismatch lists only the parseable one", async () => {
  // The legacy TC accepts the unstructured title (existing doesn't parse → write as-is),
  // but the parseable TC blocks. Result: tc-title-shape-mismatch, no PATCHes fire.
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_100_01 -> Foo -> Bar", parentUsId: 100 }],
    [1002, { type: "Test Case", title: "Legacy free-form title", parentUsId: 100 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: [1001, 1002], title: "Plain New Title" });
  assert.equal(result.isError, true);
  const body = parseJsonText(result);
  assert.equal(body.reason, "tc-title-shape-mismatch");
  const existing = body.existingTitles as Array<{ id: number; title: string }>;
  // Only the parseable TC (1001) appears — the legacy one (1002) would have written as-is.
  assert.equal(existing.length, 1);
  assert.equal(existing[0].id, 1001);
  // Critically: no PATCH fired anywhere — the block is upfront.
  assert.equal(stub.calls.patch.length, 0);
});

// ── Case 10: useCaseSummary with a TC that has an unparseable existing title → error ─

test("qa_tc_update useCaseSummary: legacy unparseable existing title → use-case-summary-unparseable-existing-title", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "Legacy free-form title", parentUsId: 100 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: 1001, useCaseSummary: "New summary" });
  assert.equal(result.isError, true);
  const body = parseJsonText(result);
  assert.equal(body.status, "error");
  assert.equal(body.reason, "use-case-summary-unparseable-existing-title");
  const list = body.unparseableTcs as Array<{ id: number; existingTitle: string }>;
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 1001);
  assert.equal(stub.calls.patch.length, 0);
});
