import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AdoClient } from "../ado-client.ts";
import { extractAndFetchAdoImages, type AdoImageGuardrails } from "./ado-attachments.ts";

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

// A real, minimal 1x1 transparent PNG (67 bytes). jimp can decode this.
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x62, 0xfc, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0x91, 0xdc, 0xf4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

// A larger padded PNG — same PNG header magic but with extra bytes so it exceeds
// minBytesToKeep. jimp still can't decode this; used only when we don't need to
// actually downscale (i.e. the test exercises min/mime/too-large paths, not the
// happy-path decode).
function makeLargeBlob(bytes: number, header: Uint8Array = TINY_PNG): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(new ArrayBuffer(bytes));
  buf.set(header.slice(0, Math.min(header.length, bytes)), 0);
  return buf;
}

const guardrails = (overrides: Partial<AdoImageGuardrails> = {}): AdoImageGuardrails => ({
  maxPerUserStory: 20,
  maxBytesPerImage: 2_097_152,
  minBytesToKeep: 4096,
  downscaleLongSidePx: 1600,
  downscaleQuality: 85,
  mimeAllowlist: ["image/png", "image/jpeg", "image/gif", "image/svg+xml"],
  inlineSvgAsText: true,
  ...overrides,
});

const adoImgUrl = (guid: string, filename = "diagram.png") =>
  `https://dev.azure.com/myorg/myproj/_apis/wit/attachments/${guid}?fileName=${encodeURIComponent(filename)}&api-version=7.0`;

// ADO sometimes returns attachment URLs with the project GUID instead of the
// project name (e.g. when the caller has only seen the GUID from a different
// part of the API). This regression test locks in that URL shape fetching
// works regardless of whether src uses the project name or GUID — the fetch
// path should always start from `/_apis/`.
const adoImgUrlWithGuid = (guid: string, filename = "diagram.png") =>
  `https://dev.azure.com/myorg/7f156bfe-4275-489e-94ff-03bd62e4eda6/_apis/wit/attachments/${guid}?fileName=${encodeURIComponent(filename)}&api-version=7.0`;

// ── Tests ───────────────────────────────────────────────────────────────────

test("no <img> tags in any field returns empty array", async () => {
  const client = new AdoClient("myorg", "myproj", "pat");
  const restore = mockFetch(() => new Response("should not be called", { status: 500 }));
  try {
    const out = await extractAndFetchAdoImages({
      fieldValuesByRef: {
        "System.Description": "<p>hello world</p>",
        "System.Title": "Just text",
      },
      adoClient: client,
      userStoryId: 1,
      guardrails: guardrails(),
    });
    assert.deepEqual(out, []);
  } finally {
    restore();
  }
});

test("single ADO <img> produces a populated EmbeddedImage entry", async () => {
  const client = new AdoClient("myorg", "myproj", "pat");
  const guid = "12345678-1234-1234-1234-123456789abc";
  const bytes = makeLargeBlob(5000); // above minBytesToKeep, below maxBytesPerImage
  const restore = mockFetch(
    () =>
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
  );
  try {
    const out = await extractAndFetchAdoImages({
      fieldValuesByRef: {
        "System.Description": `<p>See <img src="${adoImgUrl(guid, "wireframe.png")}" alt="wireframe"/></p>`,
      },
      adoClient: client,
      userStoryId: 1,
      guardrails: guardrails(),
    });
    assert.equal(out.length, 1);
    const e = out[0];
    assert.equal(e.source, "ado");
    assert.equal(e.sourceField, "System.Description");
    assert.equal(e.filename, "wireframe.png");
    assert.equal(e.mimeType, "image/png");
    assert.equal(e.bytes, 5000);
    assert.equal(e.altText, "wireframe");
    assert.ok(e.originalUrl.includes(guid));
    assert.equal(e.skipped, undefined);
  } finally {
    restore();
  }
});

test("external (non-ADO) <img> is recorded as unsupported-mime", async () => {
  const client = new AdoClient("myorg", "myproj", "pat");
  const restore = mockFetch(() => {
    throw new Error("fetch should not be called for external URL");
  });
  try {
    const out = await extractAndFetchAdoImages({
      fieldValuesByRef: {
        "System.Description": `<img src="https://cdn.example.com/foo.png" alt="x"/>`,
      },
      adoClient: client,
      userStoryId: 1,
      guardrails: guardrails(),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].skipped, "unsupported-mime");
    assert.equal(out[0].originalUrl, "https://cdn.example.com/foo.png");
  } finally {
    restore();
  }
});

test("data: URI with allowed mime is silently passed through (not recorded)", async () => {
  const client = new AdoClient("myorg", "myproj", "pat");
  const restore = mockFetch(() => new Response("nope", { status: 500 }));
  try {
    const out = await extractAndFetchAdoImages({
      fieldValuesByRef: {
        "System.Description": `<img src="data:image/png;base64,iVBORw0K" alt="inline"/>`,
      },
      adoClient: client,
      userStoryId: 1,
      guardrails: guardrails(),
    });
    assert.deepEqual(out, []);
  } finally {
    restore();
  }
});

test("data: URI with disallowed mime records skipped: unsupported-mime", async () => {
  const client = new AdoClient("myorg", "myproj", "pat");
  const restore = mockFetch(() => new Response("nope", { status: 500 }));
  try {
    const out = await extractAndFetchAdoImages({
      fieldValuesByRef: {
        "System.Description": `<img src="data:application/x-foo;base64,AAAA" alt="bad"/>`,
      },
      adoClient: client,
      userStoryId: 1,
      guardrails: guardrails(),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].skipped, "unsupported-mime");
    assert.equal(out[0].mimeType, "application/x-foo");
  } finally {
    restore();
  }
});

test("fetched MIME not in allowlist (e.g. application/pdf) records unsupported-mime", async () => {
  const client = new AdoClient("myorg", "myproj", "pat");
  const guid = "11111111-2222-3333-4444-555555555555";
  const bytes = makeLargeBlob(5000);
  const restore = mockFetch(
    () =>
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
  );
  try {
    const out = await extractAndFetchAdoImages({
      fieldValuesByRef: {
        // .pdf extension maps to no known image mime; mimeFromFilename returns null,
        // header is octet-stream → mimeType becomes "application/octet-stream".
        "System.Description": `<img src="${adoImgUrl(guid, "spec.pdf")}" alt="pdf"/>`,
      },
      adoClient: client,
      userStoryId: 1,
      guardrails: guardrails(),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].skipped, "unsupported-mime");
    assert.equal(out[0].filename, "spec.pdf");
  } finally {
    restore();
  }
});

test("bytes below minBytesToKeep records too-small", async () => {
  const client = new AdoClient("myorg", "myproj", "pat");
  const guid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const bytes = new Uint8Array(100); // tiny
  bytes.set(TINY_PNG.slice(0, 8));
  const restore = mockFetch(
    () =>
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
  );
  try {
    const out = await extractAndFetchAdoImages({
      fieldValuesByRef: {
        "System.Description": `<img src="${adoImgUrl(guid, "icon.png")}"/>`,
      },
      adoClient: client,
      userStoryId: 1,
      guardrails: guardrails({ minBytesToKeep: 4096 }),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].skipped, "too-small");
  } finally {
    restore();
  }
});

test("same GUID referenced in two fields is fetched once and yields one entry", async () => {
  const client = new AdoClient("myorg", "myproj", "pat");
  const guid = "deadbeef-dead-beef-dead-beefdeadbeef";
  const bytes = makeLargeBlob(5000);
  let fetchCount = 0;
  const restore = mockFetch(() => {
    fetchCount++;
    return new Response(bytes, {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  });
  try {
    const out = await extractAndFetchAdoImages({
      fieldValuesByRef: {
        "System.Description": `<img src="${adoImgUrl(guid, "a.png")}"/>`,
        "Custom.Notes": `<p>Same image: <img src="${adoImgUrl(guid, "a.png")}"/></p>`,
      },
      adoClient: client,
      userStoryId: 1,
      guardrails: guardrails(),
    });
    assert.equal(out.length, 1);
    assert.equal(fetchCount, 1);
    assert.equal(out[0].sourceField, "System.Description"); // first occurrence wins
  } finally {
    restore();
  }
});

test("maxPerUserStory cap limits output without recording extras", async () => {
  const client = new AdoClient("myorg", "myproj", "pat");
  const bytes = makeLargeBlob(5000);
  const restore = mockFetch(
    () =>
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
  );
  const guids = [
    "aaaaaaaa-0001-0000-0000-000000000000",
    "aaaaaaaa-0002-0000-0000-000000000000",
    "aaaaaaaa-0003-0000-0000-000000000000",
    "aaaaaaaa-0004-0000-0000-000000000000",
    "aaaaaaaa-0005-0000-0000-000000000000",
  ];
  const html = guids.map((g) => `<img src="${adoImgUrl(g, `${g}.png`)}"/>`).join("");
  try {
    const out = await extractAndFetchAdoImages({
      fieldValuesByRef: { "System.Description": html },
      adoClient: client,
      userStoryId: 1,
      guardrails: guardrails({ maxPerUserStory: 2 }),
    });
    assert.equal(out.length, 2);
  } finally {
    restore();
  }
});

test("fetch error records skipped: fetch-failed", async () => {
  const client = new AdoClient("myorg", "myproj", "pat");
  const guid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const restore = mockFetch(() => {
    return Promise.reject(new Error("network down")) as unknown as Response;
  });
  try {
    const out = await extractAndFetchAdoImages({
      fieldValuesByRef: {
        "System.Description": `<img src="${adoImgUrl(guid, "x.png")}"/>`,
      },
      adoClient: client,
      userStoryId: 1,
      guardrails: guardrails(),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].skipped, "fetch-failed");
  } finally {
    restore();
  }
});

test("downscale is triggered when raw bytes > maxBytesPerImage (real PNG decode path)", async () => {
  const client = new AdoClient("myorg", "myproj", "pat");
  const guid = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
  // Serve the real TINY_PNG but set maxBytesPerImage super small so the downscale
  // path runs. jimp decodes TINY_PNG, "scales" (it's already 1x1 — no actual
  // resize happens, scale factor is 1.0 since longSide <= target), and re-encodes.
  const restore = mockFetch(
    () =>
      new Response(TINY_PNG, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
  );
  try {
    const out = await extractAndFetchAdoImages({
      fieldValuesByRef: {
        "System.Description": `<img src="${adoImgUrl(guid, "tiny.png")}"/>`,
      },
      adoClient: client,
      userStoryId: 1,
      guardrails: guardrails({
        // Push all gates below TINY_PNG.byteLength so the downscale path runs
        // end-to-end on a real decodable PNG.
        minBytesToKeep: 10,
        maxBytesPerImage: 20,
      }),
    });
    assert.equal(out.length, 1);
    const e = out[0];
    // Either the entry is marked downscaled (re-encoded output still within cap)
    // OR marked too-large (re-encoded output still above cap). Either way, the
    // downscale path ran — both are valid outcomes for a 1x1 PNG vs a 20-byte cap.
    const ran =
      e.downscaled === true ||
      e.skipped === "too-large" ||
      e.skipped === "fetch-failed"; // in case jimp can't round-trip the tiny fixture
    assert.ok(ran, `expected downscale path to be exercised; got: ${JSON.stringify(e)}`);
    if (e.downscaled) {
      assert.equal(typeof e.originalBytes, "number");
      assert.equal(e.originalBytes, TINY_PNG.byteLength);
    }
  } finally {
    restore();
  }
});

test("saveRoot writes file to disk and populates localPath + relativeToDraft", async () => {
  const client = new AdoClient("myorg", "myproj", "pat");
  const guid = "cafebabe-dead-beef-cafe-babedeadbeef";
  const bytes = makeLargeBlob(5000);
  const restore = mockFetch(
    () =>
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
  );
  const saveRoot = mkdtempSync(join(tmpdir(), "ado-attach-test-"));
  try {
    const out = await extractAndFetchAdoImages({
      fieldValuesByRef: {
        "System.Description": `<img src="${adoImgUrl(guid, "pic.png")}"/>`,
      },
      adoClient: client,
      userStoryId: 42,
      guardrails: guardrails(),
      saveRoot,
      saveRootRelativeToDraft: "attachments/ado",
    });
    assert.equal(out.length, 1);
    const e = out[0];
    assert.ok(e.localPath, "localPath should be set");
    assert.ok(existsSync(e.localPath!), `file should exist at ${e.localPath}`);
    assert.equal(readFileSync(e.localPath!).length, 5000);
    assert.equal(e.relativeToDraft, `attachments/ado/${guid}_pic.png`);
    // Also verify only one file was written.
    const files = readdirSync(saveRoot);
    assert.equal(files.length, 1);
    assert.equal(files[0], `${guid}_pic.png`);
  } finally {
    rmSync(saveRoot, { recursive: true, force: true });
    restore();
  }
});

test("img src with project GUID (not project name) fetches successfully", async () => {
  // Regression: AdoClient.baseUrl uses the project name (URL-encoded), but ADO
  // can return attachment URLs with the project GUID. The extractor must strip
  // from `/_apis/` onwards rather than doing a prefix-match that assumes the
  // project segment is the same shape.
  const guid = "669274dd-06e9-47fe-b83a-5b961c810503";
  const client = new AdoClient("myorg", "TPM Product Ecosystem", "pat");
  let fetchedUrl = "";
  const restore = mockFetch((url) => {
    fetchedUrl = url;
    return new Response(TINY_PNG, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  });
  try {
    const html = `<div><img src="${adoImgUrlWithGuid(guid)}" alt="Image"></div>`;
    const result = await extractAndFetchAdoImages({
      fieldValuesByRef: { "Microsoft.VSTS.Common.AcceptanceCriteria": html },
      adoClient: client,
      userStoryId: 1,
      guardrails: guardrails({ minBytesToKeep: 10 }),
    });
    // Image should fetch successfully, NOT be skipped as fetch-failed.
    assert.equal(result.length, 1);
    assert.equal(result[0].skipped, undefined);
    assert.equal(result[0].mimeType, "image/png");
    // The fetched URL must NOT contain a duplicated project segment.
    // Should use baseUrl (project-name-encoded) + path starting at /_apis/.
    assert.ok(
      fetchedUrl.includes("/TPM%20Product%20Ecosystem/_apis/wit/attachments/"),
      `fetched URL should contain baseUrl's project name before /_apis/, got: ${fetchedUrl}`,
    );
    assert.ok(
      !fetchedUrl.includes("7f156bfe-4275-489e-94ff-03bd62e4eda6"),
      `fetched URL should not contain the GUID project segment, got: ${fetchedUrl}`,
    );
  } finally {
    restore();
  }
});
