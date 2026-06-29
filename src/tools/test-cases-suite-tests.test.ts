/**
 * Tests for ado_suite_tests — the test-plan list endpoint returns
 * `{ workItem: { id, name } }` per entry (current ADO API), but the
 * original implementation read `{ testCase: { id, name } }` and crashed
 * with "Cannot read properties of undefined (reading 'id')" the moment
 * any value came back. Cover both shapes here so the regression can't
 * sneak back in.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AdoClient } from "../ado-client.ts";
import { registerTestCaseTools } from "./test-cases.ts";

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

class StubAdoClient extends AdoClient {
  constructor(private readonly suiteResponse: { value: unknown[] }) {
    super("myorg", "myproj", "pat");
  }
  async get<T>(_path: string): Promise<T> {
    return this.suiteResponse as unknown as T;
  }
}

function registerAndGet(stub: StubAdoClient): ToolHandler {
  const { server, handlers } = captureHandlers();
  registerTestCaseTools(server, stub, null);
  return handlers.get("ado_suite_tests")!;
}

test("ado_suite_tests parses the current ADO shape `{ workItem: { id, name } }`", async () => {
  const stub = new StubAdoClient({
    value: [
      { workItem: { id: 1448662, name: "TC_1236615_01 -> Feature -> Case A" } },
      { workItem: { id: 1448663, name: "TC_1236615_02 -> Feature -> Case B" } },
    ],
  });
  const handler = registerAndGet(stub);
  const result = await handler({ planId: 1066479, suiteId: 1434403 });
  assert.equal(result.isError, undefined);
  const cases = JSON.parse((result.content[0] as { text: string }).text);
  assert.deepEqual(cases, [
    { id: 1448662, name: "TC_1236615_01 -> Feature -> Case A" },
    { id: 1448663, name: "TC_1236615_02 -> Feature -> Case B" },
  ]);
});

test("ado_suite_tests accepts the legacy shape `{ testCase: { id, name } }`", async () => {
  const stub = new StubAdoClient({
    value: [{ testCase: { id: 9001, name: "Legacy TC" } }],
  });
  const handler = registerAndGet(stub);
  const result = await handler({ planId: 1, suiteId: 2 });
  assert.equal(result.isError, undefined);
  const cases = JSON.parse((result.content[0] as { text: string }).text);
  assert.deepEqual(cases, [{ id: 9001, name: "Legacy TC" }]);
});

test("ado_suite_tests skips malformed entries and reports the count instead of crashing", async () => {
  const stub = new StubAdoClient({
    value: [
      { workItem: { id: 1, name: "OK" } },
      { somethingElse: true },       // no workItem, no testCase
      { workItem: { name: "no id" } }, // node present but id missing
    ],
  });
  const handler = registerAndGet(stub);
  const result = await handler({ planId: 1, suiteId: 2 });
  assert.equal(result.isError, undefined);
  const body = JSON.parse((result.content[0] as { text: string }).text) as {
    cases: Array<{ id: number; name: string }>;
    malformedEntries: number;
  };
  assert.deepEqual(body.cases, [{ id: 1, name: "OK" }]);
  assert.equal(body.malformedEntries, 2);
});

test("ado_suite_tests handles missing name on the entry by falling back to `TC #<id>`", async () => {
  const stub = new StubAdoClient({
    value: [{ workItem: { id: 42 } }],
  });
  const handler = registerAndGet(stub);
  const result = await handler({ planId: 1, suiteId: 2 });
  const cases = JSON.parse((result.content[0] as { text: string }).text);
  assert.deepEqual(cases, [{ id: 42, name: "TC #42" }]);
});

test("ado_suite_tests empty suite returns []", async () => {
  const stub = new StubAdoClient({ value: [] });
  const handler = registerAndGet(stub);
  const result = await handler({ planId: 1, suiteId: 2 });
  const cases = JSON.parse((result.content[0] as { text: string }).text);
  assert.deepEqual(cases, []);
});
