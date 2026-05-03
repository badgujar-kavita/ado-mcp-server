import { test } from "node:test";
import assert from "node:assert/strict";
import { AdoClient, AdoClientError, type BinaryResponse } from "./ado-client.ts";

// Helper to mock fetch within a single test
function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init ?? {}))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("getBinary returns arraybuffer + mime type from content-type header", async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
  const restore = mockFetch(
    () =>
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/png; charset=binary" },
      })
  );
  try {
    const client = new AdoClient("myorg", "myproject", "fake-pat");
    const result: BinaryResponse = await client.getBinary(
      "/_apis/wit/attachments/abc",
      "7.0",
      { download: "true" }
    );
    assert.equal(result.mimeType, "image/png");
    assert.equal(new Uint8Array(result.buffer).length, 4);
    assert.equal(new Uint8Array(result.buffer)[0], 0x89);
  } finally {
    restore();
  }
});

test("getBinary sends Authorization header with Basic auth", async () => {
  let capturedAuth: string | undefined;
  const restore = mockFetch((url, init) => {
    const headers = new Headers(init.headers);
    capturedAuth = headers.get("authorization") ?? undefined;
    return new Response(new Uint8Array([]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  });
  try {
    const client = new AdoClient("org", "proj", "mypat");
    await client.getBinary("/path", "7.0");
    assert.ok(capturedAuth?.startsWith("Basic "));
  } finally {
    restore();
  }
});

test("getBinary builds URL with api-version + query params", async () => {
  let capturedUrl = "";
  const restore = mockFetch((url) => {
    capturedUrl = url;
    return new Response(new Uint8Array([]), { status: 200 });
  });
  try {
    const client = new AdoClient("myorg", "myproject", "pat");
    await client.getBinary("/_apis/wit/attachments/guid-123", "7.0", {
      download: "true",
      fileName: "diagram.png",
    });
    assert.ok(
      capturedUrl.includes("dev.azure.com/myorg/myproject/_apis/wit/attachments/guid-123")
    );
    assert.ok(capturedUrl.includes("api-version=7.0"));
    assert.ok(capturedUrl.includes("download=true"));
    assert.ok(capturedUrl.includes("fileName=diagram.png"));
  } finally {
    restore();
  }
});

test("getBinary returns null mimeType when content-type header missing", async () => {
  const restore = mockFetch(
    () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })
  );
  try {
    const client = new AdoClient("org", "proj", "pat");
    const result = await client.getBinary("/path");
    assert.equal(result.mimeType, null);
  } finally {
    restore();
  }
});

test("getBinary throws AdoClientError on 401", async () => {
  const restore = mockFetch(
    () => new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })
  );
  try {
    const client = new AdoClient("org", "proj", "pat");
    await assert.rejects(
      () => client.getBinary("/path"),
      (err) => err instanceof AdoClientError && err.statusCode === 401
    );
  } finally {
    restore();
  }
});

test("getBinary throws AdoClientError on 404", async () => {
  const restore = mockFetch(
    () => new Response("Not found", { status: 404, statusText: "Not Found" })
  );
  try {
    const client = new AdoClient("org", "proj", "pat");
    await assert.rejects(
      () => client.getBinary("/path"),
      (err) => err instanceof AdoClientError && err.statusCode === 404
    );
  } finally {
    restore();
  }
});
