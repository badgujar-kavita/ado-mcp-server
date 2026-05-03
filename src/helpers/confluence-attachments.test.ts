import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfluenceClient } from "../confluence-client.ts";
import {
  fetchCurrentVersionAttachments,
  type ConfluenceImageGuardrails,
} from "./confluence-attachments.ts";

// ── Fetch mock helper ───────────────────────────────────────────────────────

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: FetchHandler) {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init ?? {}))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const BASE_URL = "https://example.atlassian.net/wiki";

// A real, minimal 1x1 transparent PNG (67 bytes).
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x62, 0xfc, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0x91, 0xdc, 0xf4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

function makeLargeBlob(bytes: number, header: Uint8Array = TINY_PNG): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(new ArrayBuffer(bytes));
  buf.set(header.slice(0, Math.min(header.length, bytes)), 0);
  return buf;
}

const defaultGuardrails = (
  overrides: Partial<ConfluenceImageGuardrails> = {},
): ConfluenceImageGuardrails => ({
  maxBytesPerImage: 2_097_152,
  minBytesToKeep: 4096,
  downscaleLongSidePx: 1600,
  downscaleQuality: 85,
  mimeAllowlist: ["image/png", "image/jpeg", "image/gif", "image/svg+xml"],
  inlineSvgAsText: true,
  ...overrides,
});

function attachmentListResponse(
  items: Array<{
    id: string;
    title: string;
    mediaType?: string;
    version?: number;
    downloadUrl: string;
  }>,
) {
  return new Response(
    JSON.stringify({
      results: items.map((it) => ({
        id: it.id,
        title: it.title,
        metadata: { mediaType: it.mediaType ?? "image/png" },
        version: { number: it.version ?? 1 },
        _links: { download: it.downloadUrl },
      })),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("same-page <ac:image> with matching attachment is fetched correctly", async () => {
  const bigPng = makeLargeBlob(8000); // above minBytesToKeep
  const restore = mockFetch((url) => {
    if (url.includes("child/attachment")) {
      return attachmentListResponse([
        {
          id: "att1",
          title: "diagram.png",
          mediaType: "image/png",
          downloadUrl: "/wiki/download/attachments/100/diagram.png?v=1",
        },
      ]);
    }
    // binary download
    return new Response(bigPng, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const storageHtml = `<p>Hello</p><ac:image ac:alt="a diagram"><ri:attachment ri:filename="diagram.png"/></ac:image>`;
    const out = await fetchCurrentVersionAttachments({
      pageId: "100",
      storageHtml,
      confluenceClient: client,
      guardrails: defaultGuardrails(),
    });
    assert.equal(out.length, 1);
    const e = out[0]!;
    assert.equal(e.source, "confluence");
    assert.equal(e.sourcePageId, "100");
    assert.equal(e.filename, "diagram.png");
    assert.equal(e.mimeType, "image/png");
    assert.equal(e.bytes, 8000);
    assert.equal(e.altText, "a diagram");
    assert.equal(e.skipped, undefined);
    assert.ok(e.originalUrl.startsWith("https://example.atlassian.net/wiki"));
  } finally {
    restore();
  }
});

test("<ac:image> referencing a cross-page attachment is skipped (not in results)", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("child/attachment")) {
      return attachmentListResponse([]);
    }
    throw new Error("should not be called");
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const storageHtml = `<ac:image><ri:attachment ri:filename="elsewhere.png"/><ri:page ri:content-title="Other"/></ac:image>`;
    const out = await fetchCurrentVersionAttachments({
      pageId: "100",
      storageHtml,
      confluenceClient: client,
      guardrails: defaultGuardrails(),
    });
    assert.deepEqual(out, []);
  } finally {
    restore();
  }
});

test("<ac:image> with <ri:url> (external) is skipped", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("child/attachment")) return attachmentListResponse([]);
    throw new Error("should not be called");
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const storageHtml = `<ac:image><ri:url ri:value="https://external.example.com/x.png"/></ac:image>`;
    const out = await fetchCurrentVersionAttachments({
      pageId: "100",
      storageHtml,
      confluenceClient: client,
      guardrails: defaultGuardrails(),
    });
    assert.deepEqual(out, []);
  } finally {
    restore();
  }
});

test("plain <img src=/download/attachments/...> is fetched via attachment list", async () => {
  const bigPng = makeLargeBlob(8000);
  const restore = mockFetch((url) => {
    if (url.includes("child/attachment")) {
      return attachmentListResponse([
        {
          id: "att1",
          title: "screenshot.png",
          mediaType: "image/png",
          downloadUrl: "/wiki/download/attachments/200/screenshot.png",
        },
      ]);
    }
    return new Response(bigPng, { status: 200, headers: { "content-type": "image/png" } });
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const storageHtml = `<p><img src="/wiki/download/attachments/200/screenshot.png?api=v2" alt="shot"/></p>`;
    const out = await fetchCurrentVersionAttachments({
      pageId: "200",
      storageHtml,
      confluenceClient: client,
      guardrails: defaultGuardrails(),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.filename, "screenshot.png");
    assert.equal(out[0]!.altText, "shot");
  } finally {
    restore();
  }
});

test("listAttachments throwing returns empty result", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("child/attachment")) {
      return new Response("boom", { status: 500, statusText: "Server Error" });
    }
    throw new Error("should not reach binary fetch");
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const storageHtml = `<ac:image><ri:attachment ri:filename="diagram.png"/></ac:image>`;
    const out = await fetchCurrentVersionAttachments({
      pageId: "100",
      storageHtml,
      confluenceClient: client,
      guardrails: defaultGuardrails(),
    });
    assert.deepEqual(out, []);
  } finally {
    restore();
  }
});

test("deduplicates by filename across <ac:image> and <img> pointing at the same file", async () => {
  const bigPng = makeLargeBlob(8000);
  let binaryFetches = 0;
  const restore = mockFetch((url) => {
    if (url.includes("child/attachment")) {
      return attachmentListResponse([
        {
          id: "att1",
          title: "shared.png",
          mediaType: "image/png",
          downloadUrl: "/wiki/download/attachments/300/shared.png",
        },
      ]);
    }
    binaryFetches++;
    return new Response(bigPng, { status: 200, headers: { "content-type": "image/png" } });
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const storageHtml =
      `<ac:image><ri:attachment ri:filename="shared.png"/></ac:image>` +
      `<img src="/wiki/download/attachments/300/shared.png"/>`;
    const out = await fetchCurrentVersionAttachments({
      pageId: "300",
      storageHtml,
      confluenceClient: client,
      guardrails: defaultGuardrails(),
    });
    assert.equal(out.length, 1);
    assert.equal(binaryFetches, 1);
  } finally {
    restore();
  }
});

test("referenced filename missing from attachment list is silently skipped", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("child/attachment")) {
      return attachmentListResponse([
        {
          id: "att1",
          title: "other.png",
          mediaType: "image/png",
          downloadUrl: "/wiki/download/attachments/400/other.png",
        },
      ]);
    }
    throw new Error("should not be called — no matching attachment");
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const storageHtml = `<ac:image><ri:attachment ri:filename="missing.png"/></ac:image>`;
    const out = await fetchCurrentVersionAttachments({
      pageId: "400",
      storageHtml,
      confluenceClient: client,
      guardrails: defaultGuardrails(),
    });
    assert.deepEqual(out, []);
  } finally {
    restore();
  }
});

test("fetchAttachmentBinary error records skipped: fetch-failed", async () => {
  const restore = mockFetch((url) => {
    if (url.includes("child/attachment")) {
      return attachmentListResponse([
        {
          id: "att1",
          title: "fail.png",
          mediaType: "image/png",
          downloadUrl: "/wiki/download/attachments/500/fail.png",
        },
      ]);
    }
    return new Response("Forbidden", { status: 403, statusText: "Forbidden" });
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const storageHtml = `<ac:image><ri:attachment ri:filename="fail.png"/></ac:image>`;
    const out = await fetchCurrentVersionAttachments({
      pageId: "500",
      storageHtml,
      confluenceClient: client,
      guardrails: defaultGuardrails(),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.skipped, "fetch-failed");
    assert.equal(out[0]!.filename, "fail.png");
  } finally {
    restore();
  }
});

test("too-small bytes below minBytesToKeep records skipped: too-small", async () => {
  const tinyBytes = new Uint8Array(100);
  tinyBytes.set(TINY_PNG.slice(0, 8));
  const restore = mockFetch((url) => {
    if (url.includes("child/attachment")) {
      return attachmentListResponse([
        {
          id: "att1",
          title: "icon.png",
          mediaType: "image/png",
          downloadUrl: "/wiki/download/attachments/600/icon.png",
        },
      ]);
    }
    return new Response(tinyBytes, { status: 200, headers: { "content-type": "image/png" } });
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const storageHtml = `<ac:image><ri:attachment ri:filename="icon.png"/></ac:image>`;
    const out = await fetchCurrentVersionAttachments({
      pageId: "600",
      storageHtml,
      confluenceClient: client,
      guardrails: defaultGuardrails({ minBytesToKeep: 4096 }),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.skipped, "too-small");
  } finally {
    restore();
  }
});

test("unsupported mime records skipped: unsupported-mime", async () => {
  const bytes = makeLargeBlob(8000);
  const restore = mockFetch((url) => {
    if (url.includes("child/attachment")) {
      return attachmentListResponse([
        {
          id: "att1",
          title: "spec.pdf",
          mediaType: "application/pdf",
          downloadUrl: "/wiki/download/attachments/700/spec.pdf",
        },
      ]);
    }
    return new Response(bytes, { status: 200, headers: { "content-type": "application/pdf" } });
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    // Use plain <img> since <ac:image> is really for images; storage HTML would
    // still list this via attachment list though.
    const storageHtml = `<img src="/wiki/download/attachments/700/spec.pdf"/>`;
    const out = await fetchCurrentVersionAttachments({
      pageId: "700",
      storageHtml,
      confluenceClient: client,
      guardrails: defaultGuardrails(),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.skipped, "unsupported-mime");
  } finally {
    restore();
  }
});

test("saveRoot writes file to disk and populates localPath + relativeToDraft", async () => {
  const bytes = makeLargeBlob(8000);
  const restore = mockFetch((url) => {
    if (url.includes("child/attachment")) {
      return attachmentListResponse([
        {
          id: "att1",
          title: "saved.png",
          mediaType: "image/png",
          downloadUrl: "/wiki/download/attachments/800/saved.png",
        },
      ]);
    }
    return new Response(bytes, { status: 200, headers: { "content-type": "image/png" } });
  });
  const saveRoot = mkdtempSync(join(tmpdir(), "confluence-attach-test-"));
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const storageHtml = `<ac:image><ri:attachment ri:filename="saved.png"/></ac:image>`;
    const out = await fetchCurrentVersionAttachments({
      pageId: "800",
      storageHtml,
      confluenceClient: client,
      guardrails: defaultGuardrails(),
      saveRoot,
      saveRootRelativeToDraft: "attachments/conf",
    });
    assert.equal(out.length, 1);
    const e = out[0]!;
    assert.ok(e.localPath, "localPath should be set");
    assert.ok(existsSync(e.localPath!), `file should exist at ${e.localPath}`);
    assert.equal(readFileSync(e.localPath!).length, 8000);
    assert.equal(e.relativeToDraft, "attachments/conf/800/saved.png");
  } finally {
    rmSync(saveRoot, { recursive: true, force: true });
    restore();
  }
});

test("empty storageHtml returns empty array without network calls", async () => {
  const restore = mockFetch(() => {
    throw new Error("should not be called");
  });
  try {
    const client = new ConfluenceClient(BASE_URL, "u@x.com", "tok");
    const out = await fetchCurrentVersionAttachments({
      pageId: "999",
      storageHtml: "",
      confluenceClient: client,
      guardrails: defaultGuardrails(),
    });
    assert.deepEqual(out, []);
  } finally {
    restore();
  }
});
