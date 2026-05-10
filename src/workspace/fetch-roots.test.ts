/**
 * Tests for fetchClientRoots — the MCP roots/list helper.
 *
 * The function MUST never throw. Soft-failure semantics: any error
 * from the client (unsupported method, transport, malformed result)
 * returns []. Tool handlers can then fall back to explicit args.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchClientRoots } from "./fetch-roots.ts";

test("fetchClientRoots: returns [] when extra is undefined", async () => {
  const result = await fetchClientRoots(undefined as unknown as { sendRequest?: unknown });
  assert.deepEqual(result, []);
});

test("fetchClientRoots: returns [] when extra has no sendRequest", async () => {
  const result = await fetchClientRoots({});
  assert.deepEqual(result, []);
});

test("fetchClientRoots: returns roots when client supports roots/list", async () => {
  const fakeRoots = [
    { uri: "file:///Users/jane/Project_ABC", name: "Project_ABC" },
    { uri: "file:///Users/jane/Project_XYZ" },
  ];
  let capturedMethod: string | undefined;
  const result = await fetchClientRoots({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendRequest: async (req: any) => {
      capturedMethod = req.method;
      return { roots: fakeRoots };
    },
  });
  assert.equal(capturedMethod, "roots/list");
  assert.deepEqual(result, fakeRoots);
});

test("fetchClientRoots: returns [] when sendRequest throws (method not found)", async () => {
  const result = await fetchClientRoots({
    sendRequest: async () => {
      throw new Error("Method not found: roots/list");
    },
  });
  assert.deepEqual(result, []);
});

test("fetchClientRoots: returns [] when client returns malformed response", async () => {
  const result = await fetchClientRoots({
    sendRequest: async () => {
      return "not an object" as unknown as { roots: unknown[] };
    },
  });
  // Schema validation failure → caught and returns [].
  assert.deepEqual(result, []);
});

test("fetchClientRoots: returns [] when roots field is missing", async () => {
  const result = await fetchClientRoots({
    sendRequest: async () => ({}),
  });
  assert.deepEqual(result, []);
});

test("fetchClientRoots: returns the raw roots array (preserves uri + name)", async () => {
  const fakeRoots = [
    { uri: "file:///a", name: "Alpha" },
    { uri: "file:///b" }, // no name
    { uri: "https://not-a-file" }, // not file:// — let resolveWorkspace filter
  ];
  const result = await fetchClientRoots({
    sendRequest: async () => ({ roots: fakeRoots }),
  });
  assert.equal(result.length, 3);
  assert.equal(result[0].name, "Alpha");
});
