/**
 * Tests for qa_tc_update — single-ID back-compat + uniform bulk + type guard
 * + cross-US span + precheck-failed refusal + partial failure.
 *
 * Pattern: handler-capture + StubAdoClient subclass, same approach as
 * tc-drafts.test.ts. Mutations are intercepted in the stub so the test never
 * talks to a real ADO tenant.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AdoClient } from "../ado-client.ts";
import { registerTestCaseTools } from "./test-cases.ts";

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

// ── StubAdoClient for qa_tc_update ──────────────────────────────────────

interface TcFixture {
  type: string;               // System.WorkItemType (e.g. "Test Case", "Bug")
  title: string;
  parentUsId?: number;        // used to synthesize a TestedBy-Reverse relation
}

class StubAdoClient extends AdoClient {
  public fixtures: Map<number, TcFixture>;
  public calls: { get: string[]; patch: Array<{ path: string; body: unknown }> };
  /** Optional per-ID patch failure injection — key is work-item id. */
  public patchFailures: Map<number, string>;

  constructor(fixtures: Map<number, TcFixture>, patchFailures: Map<number, string> = new Map()) {
    super("myorg", "myproj", "pat");
    this.fixtures = fixtures;
    this.patchFailures = patchFailures;
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
    this.calls.patch.push({ path, body });
    const m = path.match(/\/_apis\/wit\/workitems\/(\d+)$/);
    if (!m) throw new Error(`StubAdoClient: unhandled PATCH ${path}`);
    const id = parseInt(m[1], 10);
    if (this.patchFailures.has(id)) {
      throw new Error(this.patchFailures.get(id));
    }
    const fx = this.fixtures.get(id);
    return {
      id,
      rev: 2,
      fields: { "System.WorkItemType": fx?.type ?? "Test Case", "System.Title": fx?.title ?? `TC ${id}` },
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

// ── Single-ID back-compat ───────────────────────────────────────────────

test("qa_tc_update single ID: legacy JSON response shape preserved", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_100_01 -> Feature -> X", parentUsId: 100 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: 1001, priority: 2 });
  assert.equal(result.isError, undefined);
  const body = parseJsonText(result);
  assert.equal(body.id, 1001);
  assert.ok(typeof body.url === "string" && (body.url as string).includes("1001"));
  // One PATCH fired for the one ID.
  assert.equal(stub.calls.patch.length, 1);
});

test("qa_tc_update no fields → returns 'No fields to update' without touching ADO", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_100_01", parentUsId: 100 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: 1001 });
  const txt = (result.content[0] as { type: "text"; text: string }).text;
  assert.ok(txt.includes("No fields to update"));
  assert.equal(stub.calls.get.length, 0);
  assert.equal(stub.calls.patch.length, 0);
});

// ── Type guard ──────────────────────────────────────────────────────────

test("qa_tc_update refuses non-Test-Case IDs with precheck-failed (single)", async () => {
  const fixtures = new Map<number, TcFixture>([
    [9999, { type: "Bug", title: "A bug, not a TC" }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: 9999, priority: 2 });
  assert.equal(result.isError, true);
  const body = parseJsonText(result);
  assert.equal(body.reason, "precheck-failed");
  const typeRefusals = body.typeRefusals as Array<{ id: number; type: string }>;
  assert.equal(typeRefusals.length, 1);
  assert.equal(typeRefusals[0].id, 9999);
  assert.equal(typeRefusals[0].type, "Bug");
  // No PATCH fired — precheck-failed blocks BEFORE any mutation.
  assert.equal(stub.calls.patch.length, 0);
});

test("qa_tc_update bulk with one non-TC refuses the WHOLE batch (no partial mutation)", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_100_01", parentUsId: 100 }],
    [1002, { type: "Test Case", title: "TC_100_02", parentUsId: 100 }],
    [9999, { type: "User Story", title: "Some story" }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: [1001, 1002, 9999], priority: 2 });
  assert.equal(result.isError, true);
  const body = parseJsonText(result);
  assert.equal(body.reason, "precheck-failed");
  const typeRefusals = body.typeRefusals as Array<{ id: number; type: string }>;
  assert.equal(typeRefusals.length, 1);
  assert.equal(typeRefusals[0].id, 9999);
  // Crucially: no PATCH fired for the valid TCs either.
  assert.equal(stub.calls.patch.length, 0);
});

// ── Cross-US span ───────────────────────────────────────────────────────

test("qa_tc_update bulk crossing multiple USs → cross-us-bulk-update (no patch yet)", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_100_01", parentUsId: 100 }],
    [2001, { type: "Test Case", title: "TC_200_01", parentUsId: 200 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: [1001, 2001], priority: 2 });
  assert.equal(result.isError, true);
  const body = parseJsonText(result);
  assert.equal(body.reason, "cross-us-bulk-update");
  const breakdown = body.breakdown as Array<{ parentUsId: number | null; tcCount: number }>;
  assert.equal(breakdown.length, 2);
  // No PATCHes — waiting for acknowledgeCrossUs.
  assert.equal(stub.calls.patch.length, 0);
});

test("qa_tc_update bulk crossing multiple USs + acknowledgeCrossUs: true → proceeds", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_100_01", parentUsId: 100 }],
    [2001, { type: "Test Case", title: "TC_200_01", parentUsId: 200 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: [1001, 2001], priority: 2, acknowledgeCrossUs: true });
  assert.equal(result.isError ?? false, false);
  const txt = (result.content[0] as { type: "text"; text: string }).text;
  assert.ok(txt.includes("✅ SUCCESS"));
  assert.equal(stub.calls.patch.length, 2);
});

// ── Bulk happy path + single-US skip ────────────────────────────────────

test("qa_tc_update bulk same US → no cross-US prompt, patches all, returns table", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_100_01", parentUsId: 100 }],
    [1002, { type: "Test Case", title: "TC_100_02", parentUsId: 100 }],
    [1003, { type: "Test Case", title: "TC_100_03", parentUsId: 100 }],
  ]);
  const stub = new StubAdoClient(fixtures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: [1001, 1002, 1003], priority: 3 });
  assert.equal(result.isError ?? false, false);
  const txt = (result.content[0] as { type: "text"; text: string }).text;
  assert.ok(txt.includes("✅ SUCCESS"));
  assert.ok(txt.includes("Updated 3 test case(s)"));
  assert.ok(txt.includes("| ID | Status | Title |"));
  assert.equal(stub.calls.patch.length, 3);
});

// ── Partial failure ─────────────────────────────────────────────────────

test("qa_tc_update bulk partial failure → isError: true, ⚠️ PARTIAL headline, both sections in table", async () => {
  const fixtures = new Map<number, TcFixture>([
    [1001, { type: "Test Case", title: "TC_100_01", parentUsId: 100 }],
    [1002, { type: "Test Case", title: "TC_100_02", parentUsId: 100 }],
    [1003, { type: "Test Case", title: "TC_100_03", parentUsId: 100 }],
  ]);
  const patchFailures = new Map<number, string>([
    [1002, "409 Conflict: state transition not allowed"],
  ]);
  const stub = new StubAdoClient(fixtures, patchFailures);
  const update = registerAndGetUpdate(stub);

  const result = await update({ workItemId: [1001, 1002, 1003], priority: 4 });
  assert.equal(result.isError, true);
  const txt = (result.content[0] as { type: "text"; text: string }).text;
  assert.ok(txt.includes("⚠️ PARTIAL"));
  assert.ok(txt.includes("✅ Updated"));
  assert.ok(txt.includes("❌ Failed"));
  assert.ok(txt.includes("409 Conflict"));
  // All three were attempted (no retry on first failure, but no abort either).
  assert.equal(stub.calls.patch.length, 3);
});
