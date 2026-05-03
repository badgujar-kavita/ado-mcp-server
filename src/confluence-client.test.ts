import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfluenceClient } from "./confluence-client.ts";

// Helper to mock fetch within a single test
function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init ?? {}))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const BASE_URL = "https://example.atlassian.net/wiki";

// ── listAttachments ────────────────────────────────────────────────────────

test("listAttachments parses results[] shape with all core fields", async () => {
  const restore = mockFetch(
    () =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: "att1",
              title: "diagram.png",
              metadata: { mediaType: "image/png" },
              extensions: { fileSize: 1234 },
              version: { number: 3 },
              _links: {
                download:
                  "/wiki/download/attachments/1001/diagram.png?version=3&modificationDate=1700000000000",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  );
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const attachments = await client.listAttachments("1001");
    assert.equal(attachments.length, 1);
    const a = attachments[0]!;
    assert.equal(a.id, "att1");
    assert.equal(a.title, "diagram.png");
    assert.equal(a.mediaType, "image/png");
    assert.equal(a.fileSize, 1234);
    assert.equal(a.version.number, 3);
    assert.ok(a.downloadUrl.startsWith("/wiki/download/attachments/1001/"));
  } finally {
    restore();
  }
});

test("listAttachments returns [] on 404", async () => {
  const restore = mockFetch(
    () => new Response("Not Found", { status: 404, statusText: "Not Found" })
  );
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const result = await client.listAttachments("missing");
    assert.deepEqual(result, []);
  } finally {
    restore();
  }
});

test("listAttachments filters out items missing _links.download", async () => {
  const restore = mockFetch(
    () =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: "att1",
              title: "ok.png",
              metadata: { mediaType: "image/png" },
              version: { number: 1 },
              _links: { download: "/wiki/download/attachments/1/ok.png" },
            },
            {
              id: "att2",
              title: "broken.png",
              metadata: { mediaType: "image/png" },
              version: { number: 1 },
              _links: {}, // missing download
            },
            {
              id: "att3",
              title: "no-links.png",
              metadata: { mediaType: "image/png" },
              version: { number: 1 },
              // no _links at all
            },
          ],
        }),
        { status: 200 }
      )
  );
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const attachments = await client.listAttachments("1");
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0]!.id, "att1");
  } finally {
    restore();
  }
});

test("listAttachments falls back to extensions.mediaType when metadata.mediaType is absent", async () => {
  const restore = mockFetch(
    () =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: "att1",
              title: "file.pdf",
              // no metadata.mediaType
              extensions: { mediaType: "application/pdf", fileSize: 50 },
              version: { number: 1 },
              _links: { download: "/wiki/download/attachments/1/file.pdf" },
            },
            {
              id: "att2",
              title: "unknown.bin",
              // no metadata / no extensions.mediaType
              version: { number: 1 },
              _links: { download: "/wiki/download/attachments/1/unknown.bin" },
            },
          ],
        }),
        { status: 200 }
      )
  );
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const attachments = await client.listAttachments("1");
    assert.equal(attachments.length, 2);
    assert.equal(attachments[0]!.mediaType, "application/pdf");
    assert.equal(attachments[1]!.mediaType, "application/octet-stream");
  } finally {
    restore();
  }
});

test("listAttachments throws on 500", async () => {
  const restore = mockFetch(
    () => new Response("Server Error", { status: 500, statusText: "Internal Server Error" })
  );
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    await assert.rejects(
      () => client.listAttachments("1"),
      /Confluence listAttachments failed: 500/
    );
  } finally {
    restore();
  }
});

// ── fetchAttachmentBinary ──────────────────────────────────────────────────

test("fetchAttachmentBinary uses absolute URL as-is", async () => {
  let capturedUrl = "";
  const restore = mockFetch((url) => {
    capturedUrl = url;
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const absolute = "https://cdn.example.com/attach/foo.png";
    await client.fetchAttachmentBinary(absolute);
    assert.equal(capturedUrl, absolute);
  } finally {
    restore();
  }
});

test("fetchAttachmentBinary prefixes baseUrl for /-leading relative path", async () => {
  let capturedUrl = "";
  const restore = mockFetch((url) => {
    capturedUrl = url;
    return new Response(new Uint8Array([0]), { status: 200 });
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    await client.fetchAttachmentBinary("/wiki/download/attachments/1/foo.png");
    assert.equal(
      capturedUrl,
      "https://example.atlassian.net/wiki/wiki/download/attachments/1/foo.png"
    );
  } finally {
    restore();
  }
});

test("fetchAttachmentBinary adds leading slash for relative path without slash", async () => {
  let capturedUrl = "";
  const restore = mockFetch((url) => {
    capturedUrl = url;
    return new Response(new Uint8Array([0]), { status: 200 });
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    await client.fetchAttachmentBinary("download/attachments/1/foo.png");
    assert.equal(
      capturedUrl,
      "https://example.atlassian.net/wiki/download/attachments/1/foo.png"
    );
  } finally {
    restore();
  }
});

test("fetchAttachmentBinary sends Basic auth header", async () => {
  let capturedAuth: string | undefined;
  const restore = mockFetch((url, init) => {
    const headers = new Headers(init.headers);
    capturedAuth = headers.get("authorization") ?? undefined;
    return new Response(new Uint8Array([1]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "my-token");
    await client.fetchAttachmentBinary("/wiki/download/attachments/1/foo.png");
    assert.ok(capturedAuth?.startsWith("Basic "));
  } finally {
    restore();
  }
});

test("fetchAttachmentBinary extracts mimeType from content-type (strips charset)", async () => {
  const restore = mockFetch(
    () =>
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { "content-type": "image/png; charset=binary" },
      })
  );
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const res = await client.fetchAttachmentBinary(
      "/wiki/download/attachments/1/foo.png"
    );
    assert.equal(res.mimeType, "image/png");
    assert.equal(new Uint8Array(res.buffer).length, 4);
    assert.equal(new Uint8Array(res.buffer)[0], 0x89);
  } finally {
    restore();
  }
});

test("fetchAttachmentBinary returns null mimeType when content-type header missing", async () => {
  const restore = mockFetch(
    () => new Response(new Uint8Array([0]), { status: 200 })
  );
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const res = await client.fetchAttachmentBinary("/wiki/download/attachments/1/foo.bin");
    assert.equal(res.mimeType, null);
  } finally {
    restore();
  }
});

test("fetchAttachmentBinary throws on non-OK response", async () => {
  const restore = mockFetch(
    () => new Response("Forbidden", { status: 403, statusText: "Forbidden" })
  );
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    await assert.rejects(
      () => client.fetchAttachmentBinary("/wiki/download/attachments/1/foo.png"),
      /Confluence attachment fetch failed \(403\)/
    );
  } finally {
    restore();
  }
});

// ── getPageContentRaw / getPageContent ─────────────────────────────────────

test("getPageContentRaw returns raw storage HTML plus stripped body", async () => {
  const rawHtml =
    "<h1>Title</h1><p>Hello <strong>world</strong></p><ac:image><ri:attachment ri:filename=\"foo.png\"/></ac:image>";
  const restore = mockFetch(
    () =>
      new Response(
        JSON.stringify({
          title: "My Page",
          body: { storage: { value: rawHtml } },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  );
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const res = await client.getPageContentRaw("1234");
    assert.equal(res.title, "My Page");
    assert.equal(res.rawStorageHtml, rawHtml);
    // body should be stripped — no angle brackets from HTML tags
    assert.ok(!res.body.includes("<h1>"));
    assert.ok(!res.body.includes("<strong>"));
    assert.ok(res.body.includes("Hello world"));
  } finally {
    restore();
  }
});

test("getPageContent still returns only { title, body } with stripped HTML (backward compat)", async () => {
  const rawHtml = "<p>Keep this text</p><p>Second para</p>";
  const restore = mockFetch(
    () =>
      new Response(
        JSON.stringify({
          title: "BC Page",
          body: { storage: { value: rawHtml } },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  );
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const res = await client.getPageContent("1234");
    // Only two keys on the object
    assert.deepEqual(Object.keys(res).sort(), ["body", "title"]);
    assert.equal(res.title, "BC Page");
    assert.ok(res.body.includes("Keep this text"));
    assert.ok(!res.body.includes("<p>"));
    // No rawStorageHtml key
    assert.equal((res as unknown as Record<string, unknown>).rawStorageHtml, undefined);
  } finally {
    restore();
  }
});
