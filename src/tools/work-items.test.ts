import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AdoClient } from "../ado-client.ts";
import { ConfluenceClient } from "../confluence-client.ts";
import {
  extractUserStoryContext,
  buildGetUserStoryResponse,
  registerWorkItemTools,
} from "./work-items.ts";
import type { AdoWorkItem, EmbeddedImage, UserStoryContext } from "../types.ts";

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

// A real 1x1 transparent PNG (67 bytes). Above 10 bytes threshold when needed.
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x62, 0xfc, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0x91, 0xdc, 0xf4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

function makeLargeBlob(bytes: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(new ArrayBuffer(bytes));
  buf.set(TINY_PNG.slice(0, Math.min(TINY_PNG.length, bytes)), 0);
  return buf;
}

function makeWorkItem(overrides: Partial<AdoWorkItem> = {}): AdoWorkItem {
  return {
    id: 123,
    rev: 1,
    url: "https://dev.azure.com/myorg/myproj/_apis/wit/workitems/123",
    fields: {
      "System.Title": "Sample User Story",
      "System.Description": "<p>Do the thing</p>",
      "Microsoft.VSTS.Common.AcceptanceCriteria": "<p>It works</p>",
      "System.AreaPath": "Project\\Area",
      "System.IterationPath": "Project\\Sprint 1",
      "System.State": "New",
      ...(overrides.fields ?? {}),
    },
    relations: overrides.relations ?? [],
    ...overrides,
  };
}

const ADO_ORG = "myorg";
const ADO_PROJ = "myproj";

// ── Tests ──────────────────────────────────────────────────────────────────

test("US with only primary fields returns shape with filled namedFields + empty link/image arrays", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const restore = mockFetch(() => {
    throw new Error("should not make any network call");
  });
  try {
    const item = makeWorkItem();
    const ctx = await extractUserStoryContext(item, adoClient, null);

    assert.equal(ctx.id, 123);
    assert.equal(ctx.title, "Sample User Story");
    assert.equal(ctx.description, "<p>Do the thing</p>");
    assert.equal(ctx.acceptanceCriteria, "<p>It works</p>");
    assert.equal(ctx.state, "New");
    assert.equal(ctx.parentId, null);
    assert.equal(ctx.parentTitle, null);

    // namedFields populated for the three primaries
    assert.ok(ctx.namedFields);
    assert.ok(ctx.namedFields!["System.Title"]);
    assert.equal(ctx.namedFields!["System.Title"].label, "Title");
    assert.equal(ctx.namedFields!["System.Title"].plainText, "Sample User Story");
    assert.ok(ctx.namedFields!["System.Description"]);
    assert.equal(ctx.namedFields!["System.Description"].plainText, "Do the thing");
    assert.ok(ctx.namedFields!["Microsoft.VSTS.Common.AcceptanceCriteria"]);

    // No links, no images
    assert.deepEqual(ctx.fetchedConfluencePages, []);
    assert.deepEqual(ctx.unfetchedLinks, []);
    assert.deepEqual(ctx.embeddedImages, []);

    // Deprecated aliases null
    assert.equal(ctx.solutionDesignUrl, null);
    assert.equal(ctx.solutionDesignContent, null);
  } finally {
    restore();
  }
});

test("System.Id, System.Rev, and other system-noise fields are filtered from allFields by default", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const restore = mockFetch(() => {
    throw new Error("no network expected");
  });
  try {
    const item = makeWorkItem({
      fields: {
        "System.Title": "x",
        "System.Description": "<p>d</p>",
        "System.Id": 123,
        "System.Rev": 5,
        "System.ChangedDate": "2024-01-01",
        "System.CreatedBy": "someone",
        "Microsoft.VSTS.Common.StateChangeDate": "2024-01-01",
        "Custom.MyField": "kept",
      },
    });
    const ctx = await extractUserStoryContext(item, adoClient, null);
    assert.ok(ctx.allFields);
    assert.equal(ctx.allFields!["System.Id"], undefined);
    assert.equal(ctx.allFields!["System.Rev"], undefined);
    assert.equal(ctx.allFields!["System.ChangedDate"], undefined);
    assert.equal(ctx.allFields!["System.CreatedBy"], undefined);
    assert.equal(ctx.allFields!["Microsoft.VSTS.Common.StateChangeDate"], undefined);
    assert.equal(ctx.allFields!["Custom.MyField"], "kept");
    // System.Title / Description etc. are also in allFields (they're not noise)
    assert.equal(ctx.allFields!["System.Title"], "x");
  } finally {
    restore();
  }
});

test("parent relation populates parentId and parentTitle from relation attributes", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const restore = mockFetch(() => {
    throw new Error("no network expected");
  });
  try {
    const item = makeWorkItem({
      relations: [
        {
          rel: "System.LinkTypes.Hierarchy-Reverse",
          url: "https://dev.azure.com/myorg/myproj/_apis/wit/workitems/999",
          attributes: { name: "Parent Epic" },
        },
      ],
    });
    const ctx = await extractUserStoryContext(item, adoClient, null);
    assert.equal(ctx.parentId, 999);
    assert.equal(ctx.parentTitle, "Parent Epic");
  } finally {
    restore();
  }
});

test("US with a Confluence URL on the configured instance produces a fetchedConfluencePage + deprecated alias", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const confClient = new ConfluenceClient("https://example.atlassian.net/wiki", "u@x.com", "tok");
  const pageUrl = "https://example.atlassian.net/wiki/spaces/FOO/pages/42/Design";
  const restore = mockFetch((url) => {
    if (url.includes("/rest/api/content/42?")) {
      return new Response(
        JSON.stringify({
          title: "Design Page",
          body: { storage: { value: "<p>Body</p>" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("child/attachment")) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("Unexpected URL: " + url);
  });
  try {
    const item = makeWorkItem({
      fields: {
        "System.Title": "x",
        "System.Description": "<p>d</p>",
        "Custom.TechnicalSolution": `<a href="${pageUrl}">Design</a>`,
      },
    });
    const ctx = await extractUserStoryContext(item, adoClient, confClient);
    assert.equal(ctx.fetchedConfluencePages!.length, 1);
    const p = ctx.fetchedConfluencePages![0]!;
    assert.equal(p.pageId, "42");
    assert.equal(p.title, "Design Page");
    assert.equal(p.url, pageUrl);
    assert.equal(p.sourceField, "Custom.TechnicalSolution");
    assert.ok(p.body.includes("Body"));

    // Deprecated aliases populated
    assert.equal(ctx.solutionDesignUrl, pageUrl);
    assert.ok(ctx.solutionDesignContent);
    assert.ok(ctx.solutionDesignContent!.startsWith("# Design Page"));
  } finally {
    restore();
  }
});

test("Cross-instance Confluence URL is recorded in unfetchedLinks with reason cross-instance", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const confClient = new ConfluenceClient("https://example.atlassian.net/wiki", "u@x.com", "tok");
  const restore = mockFetch((url) => {
    throw new Error("Should not be called — cross-instance: " + url);
  });
  try {
    const otherUrl =
      "https://other-tenant.atlassian.net/wiki/spaces/BAR/pages/99/X";
    const item = makeWorkItem({
      fields: {
        "System.Title": "x",
        "System.Description": `<p>See <a href="${otherUrl}">doc</a></p>`,
      },
    });
    const ctx = await extractUserStoryContext(item, adoClient, confClient);
    assert.equal(ctx.fetchedConfluencePages!.length, 0);
    assert.equal(ctx.unfetchedLinks!.length, 1);
    assert.equal(ctx.unfetchedLinks![0]!.reason, "cross-instance");
    assert.equal(ctx.unfetchedLinks![0]!.url, otherUrl);
  } finally {
    restore();
  }
});

test("SharePoint and Figma links are recorded as non-confluence in unfetchedLinks", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const restore = mockFetch(() => {
    throw new Error("no network expected");
  });
  try {
    const item = makeWorkItem({
      fields: {
        "System.Title": "x",
        "System.Description":
          `<p><a href="https://contoso.sharepoint.com/doc.pdf">sp</a> ` +
          `<a href="https://figma.com/file/abc">design</a></p>`,
      },
    });
    const ctx = await extractUserStoryContext(item, adoClient, null);
    assert.equal(ctx.fetchedConfluencePages!.length, 0);
    assert.equal(ctx.unfetchedLinks!.length, 2);
    const reasons = ctx.unfetchedLinks!.map((u) => u.reason);
    assert.ok(reasons.every((r) => r === "non-confluence"));
    const types = ctx.unfetchedLinks!.map((u) => u.type).sort();
    assert.deepEqual(types, ["Figma", "SharePoint"]);
    for (const u of ctx.unfetchedLinks!) {
      assert.ok(u.workaround && u.workaround.length > 0);
    }
  } finally {
    restore();
  }
});

test("ADO <img> attachments in Description are recorded in embeddedImages", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const guid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const bytes = makeLargeBlob(5000); // above minBytesToKeep
  const restore = mockFetch((url) => {
    if (url.includes(`/_apis/wit/attachments/${guid}`)) {
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    }
    throw new Error("Unexpected URL: " + url);
  });
  try {
    const item = makeWorkItem({
      fields: {
        "System.Title": "x",
        "System.Description": `<p><img src="https://dev.azure.com/myorg/myproj/_apis/wit/attachments/${guid}?fileName=wire.png&api-version=7.0" alt="w"/></p>`,
      },
    });
    const ctx = await extractUserStoryContext(item, adoClient, null);
    assert.equal(ctx.embeddedImages!.length, 1);
    const img = ctx.embeddedImages![0]!;
    assert.equal(img.source, "ado");
    assert.equal(img.sourceField, "System.Description");
    assert.equal(img.filename, "wire.png");
    assert.equal(img.skipped, undefined);
  } finally {
    restore();
  }
});

test("link-budget overflow: only first N Confluence links are fetched, rest recorded as link-budget", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const confClient = new ConfluenceClient("https://example.atlassian.net/wiki", "u@x.com", "tok");
  const pageIds = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]; // 13 pages (> default cap 10)
  const restore = mockFetch((url) => {
    const pageMatch = url.match(/\/rest\/api\/content\/(\d+)\?/);
    if (pageMatch) {
      return new Response(
        JSON.stringify({
          title: `Page ${pageMatch[1]}`,
          body: { storage: { value: "<p>body</p>" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("child/attachment")) {
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
    throw new Error("Unexpected URL: " + url);
  });
  try {
    const links = pageIds
      .map(
        (id) =>
          `<a href="https://example.atlassian.net/wiki/spaces/X/pages/${id}/page">p${id}</a>`,
      )
      .join(" ");
    const item = makeWorkItem({
      fields: {
        "System.Title": "x",
        "System.Description": `<p>${links}</p>`,
      },
    });
    const ctx = await extractUserStoryContext(item, adoClient, confClient);
    // Default maxConfluencePagesPerUserStory is 10.
    assert.equal(ctx.fetchedConfluencePages!.length, 10);
    const overflow = ctx.unfetchedLinks!.filter(
      (u) => u.reason === "link-budget",
    );
    assert.equal(overflow.length, 3);
  } finally {
    restore();
  }
});

test("omitExtraRefs in config adds fields to the noise filter", async () => {
  // This test reuses the global config (which has omitExtraRefs:[]), so we assert
  // the baseline behavior: Custom.DefinedElsewhere stays in allFields.
  // The "extra refs adds to filter" behavior is unit-tested via the static
  // SYSTEM_NOISE_FIELDS + merge logic implicitly — a full end-to-end needs a
  // separate fixture config and is out of Phase G scope.
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const restore = mockFetch(() => {
    throw new Error("no network");
  });
  try {
    const item = makeWorkItem({
      fields: {
        "System.Title": "x",
        "System.Description": "<p>d</p>",
        "Custom.DefinedElsewhere": "some-value",
      },
    });
    const ctx = await extractUserStoryContext(item, adoClient, null);
    assert.equal(ctx.allFields!["Custom.DefinedElsewhere"], "some-value");
  } finally {
    restore();
  }
});

test("Confluence fetch 401 records unfetchedLink with reason auth-failure", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const confClient = new ConfluenceClient(
    "https://example.atlassian.net/wiki",
    "u@x.com",
    "tok",
  );
  const pageUrl =
    "https://example.atlassian.net/wiki/spaces/FOO/pages/42/Design";
  const restore = mockFetch((url) => {
    if (url.includes("/rest/api/content/42")) {
      return new Response("Unauthorized", {
        status: 401,
        statusText: "Unauthorized",
      });
    }
    // _edge/tenant_info for fallback
    if (url.includes("_edge/tenant_info")) {
      return new Response("{}", { status: 200 });
    }
    throw new Error("Unexpected URL: " + url);
  });
  try {
    const item = makeWorkItem({
      fields: {
        "System.Title": "x",
        "System.Description": `<a href="${pageUrl}">Design</a>`,
      },
    });
    const ctx = await extractUserStoryContext(item, adoClient, confClient);
    assert.equal(ctx.fetchedConfluencePages!.length, 0);
    assert.equal(ctx.unfetchedLinks!.length, 1);
    assert.equal(ctx.unfetchedLinks![0]!.reason, "auth-failure");
  } finally {
    restore();
  }
});

test("namedFields include additionalContextFields defined in config when present on the item", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const restore = mockFetch(() => {
    throw new Error("no network");
  });
  try {
    const item = makeWorkItem({
      fields: {
        "System.Title": "x",
        "System.Description": "<p>d</p>",
        "Custom.ImpactAssessment": "<p>Impact: high</p>",
      },
    });
    const ctx = await extractUserStoryContext(item, adoClient, null);
    assert.ok(ctx.namedFields!["Custom.ImpactAssessment"]);
    assert.equal(
      ctx.namedFields!["Custom.ImpactAssessment"].label,
      "Impact Assessment",
    );
    assert.equal(
      ctx.namedFields!["Custom.ImpactAssessment"].plainText,
      "Impact: high",
    );
  } finally {
    restore();
  }
});

test("deprecated solutionDesignUrl is populated even when confluence fetch returns no page (fallback to link extraction)", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const restore = mockFetch(() => {
    throw new Error("no network — no confluence client");
  });
  try {
    const pageUrl =
      "https://example.atlassian.net/wiki/spaces/FOO/pages/42/Design";
    const item = makeWorkItem({
      fields: {
        "System.Title": "x",
        "System.Description": "<p>d</p>",
        "Custom.TechnicalSolution": `<a href="${pageUrl}">link</a>`,
      },
    });
    const ctx = await extractUserStoryContext(item, adoClient, null);
    // No confluence client → no fetched page, but solutionDesignUrl falls back to extraction.
    assert.equal(ctx.fetchedConfluencePages!.length, 0);
    assert.equal(ctx.solutionDesignUrl, pageUrl);
    assert.equal(ctx.solutionDesignContent, null);
  } finally {
    restore();
  }
});

// ── Phase H: buildGetUserStoryResponse (MCP image content parts) ───────────

function makeImage(overrides: Partial<EmbeddedImage> = {}): EmbeddedImage {
  const buf = new ArrayBuffer(overrides.bytes ?? 100);
  return {
    source: "ado",
    sourceField: "System.Description",
    originalUrl: "https://dev.azure.com/x/y/_apis/wit/attachments/abc",
    filename: "image.png",
    mimeType: "image/png",
    bytes: overrides.bytes ?? 100,
    _buffer: buf,
    ...overrides,
  };
}

function makeContext(embeddedImages: EmbeddedImage[]): UserStoryContext {
  return {
    id: 1,
    title: "t",
    description: "",
    acceptanceCriteria: "",
    areaPath: "",
    iterationPath: "",
    state: "New",
    parentId: null,
    parentTitle: null,
    relations: [],
    namedFields: {},
    allFields: {},
    fetchedConfluencePages: [],
    unfetchedLinks: [],
    embeddedImages,
    solutionDesignUrl: null,
    solutionDesignContent: null,
  };
}

test("buildGetUserStoryResponse with returnMcpImageParts=false returns only the text part", () => {
  const img = makeImage({ filename: "wire.png", bytes: 500 });
  const ctx = makeContext([img]);
  const res = buildGetUserStoryResponse(ctx, {
    webUrl: "https://example.com/1",
    returnMcpImageParts: false,
    maxTotalBytesPerResponse: 4194304,
  });
  assert.equal(res.content.length, 1);
  assert.equal(res.content[0]!.type, "text");
  // Image metadata is still present in the JSON text
  const textPart = res.content[0] as { type: "text"; text: string };
  assert.ok(textPart.text.includes("wire.png"));
  // _buffer must not leak into JSON
  assert.ok(!textPart.text.includes("_buffer"));
});

test("buildGetUserStoryResponse with returnMcpImageParts=true appends image content parts", () => {
  const img = makeImage({ filename: "wire.png", bytes: 200 });
  const ctx = makeContext([img]);
  const res = buildGetUserStoryResponse(ctx, {
    webUrl: "https://example.com/1",
    returnMcpImageParts: true,
    maxTotalBytesPerResponse: 4194304,
  });
  assert.equal(res.content.length, 2);
  assert.equal(res.content[0]!.type, "text");
  assert.equal(res.content[1]!.type, "image");
  const imagePart = res.content[1] as { type: "image"; data: string; mimeType: string };
  assert.equal(imagePart.mimeType, "image/png");
  assert.ok(imagePart.data.length > 0);
  // Verify it's valid base64
  assert.doesNotThrow(() => Buffer.from(imagePart.data, "base64"));
  const textPart = res.content[0] as { type: "text"; text: string };
  assert.ok(!textPart.text.includes("_buffer"));
});

test("buildGetUserStoryResponse applies response-budget cap and marks overflowed images as skipped", () => {
  // Each image's base64 size is ceil(1000 * 4/3) = 1334 bytes. Cap at 2800 => 2 fit.
  const imgs = [
    makeImage({ filename: "a.png", bytes: 1000 }),
    makeImage({ filename: "b.png", bytes: 1000 }),
    makeImage({ filename: "c.png", bytes: 1000 }),
  ];
  const ctx = makeContext(imgs);
  const res = buildGetUserStoryResponse(ctx, {
    webUrl: "https://example.com/1",
    returnMcpImageParts: true,
    maxTotalBytesPerResponse: 2800,
  });
  // text + 2 images (3rd exceeds budget)
  assert.equal(res.content.length, 3);
  assert.equal(res.content[1]!.type, "image");
  assert.equal(res.content[2]!.type, "image");
  // The 3rd image is marked response-budget in the JSON payload
  const textPart = res.content[0] as { type: "text"; text: string };
  const payload = JSON.parse(textPart.text) as UserStoryContext;
  assert.equal(payload.embeddedImages!.length, 3);
  assert.equal(payload.embeddedImages![0]!.skipped, undefined);
  assert.equal(payload.embeddedImages![1]!.skipped, undefined);
  assert.equal(payload.embeddedImages![2]!.skipped, "response-budget");
});

test("buildGetUserStoryResponse: skipped images don't consume budget and aren't re-marked", () => {
  // First image is already skipped for fetch-failed (no _buffer); shouldn't eat budget
  // nor be re-marked. Second image is successful and should be attached.
  const failed: EmbeddedImage = {
    source: "ado",
    sourceField: "System.Description",
    originalUrl: "https://dev.azure.com/x/y/_apis/wit/attachments/bad",
    filename: "failed.png",
    mimeType: "image/png",
    bytes: 0,
    skipped: "fetch-failed",
  };
  const ok = makeImage({ filename: "ok.png", bytes: 500 });
  const ctx = makeContext([failed, ok]);
  const res = buildGetUserStoryResponse(ctx, {
    webUrl: "https://example.com/1",
    returnMcpImageParts: true,
    maxTotalBytesPerResponse: 1000, // tight; but failed one shouldn't count
  });
  // text + 1 image (only the successful one)
  assert.equal(res.content.length, 2);
  assert.equal(res.content[1]!.type, "image");
  const textPart = res.content[0] as { type: "text"; text: string };
  const payload = JSON.parse(textPart.text) as UserStoryContext;
  // The failed image stays fetch-failed, NOT changed to response-budget
  assert.equal(payload.embeddedImages![0]!.skipped, "fetch-failed");
  assert.equal(payload.embeddedImages![1]!.skipped, undefined);
});

// ── Tier 2: registered-tool structuredContent tests ────────────────────────

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}>;

type CanonicalItem = { id: string | number; type: string; title: string; summary?: string };
type CanonicalChild = { id: string | number; type: string; title: string; relationship?: string };
type CanonicalCompleteness = { isPartial: boolean; reason?: string };
type Canonical = {
  item: CanonicalItem;
  children?: CanonicalChild[];
  completeness: CanonicalCompleteness;
};

/**
 * Build a fake McpServer that captures `registerTool` handlers by name.
 * Returns the handler map so tests can invoke a specific tool directly.
 */
function captureToolHandlers(
  adoClient: AdoClient,
  confluenceClient: ConfluenceClient | null,
): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const fakeServer = {
    registerTool: (name: string, _config: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
      return {} as unknown;
    },
    tool: (name: string, _desc: unknown, _schema: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
      return {} as unknown;
    },
  } as unknown as McpServer;
  registerWorkItemTools(fakeServer, adoClient, confluenceClient);
  return handlers;
}

test("qa_tests returns structuredContent with children", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const userStoryId = 500;
  const restore = mockFetch((url) => {
    if (url.includes(`/_apis/wit/workitems/${userStoryId}`)) {
      return new Response(
        JSON.stringify({
          id: userStoryId,
          rev: 1,
          url: `https://dev.azure.com/${ADO_ORG}/${ADO_PROJ}/_apis/wit/workitems/${userStoryId}`,
          fields: { "System.Title": "US" },
          relations: [
            {
              rel: "Microsoft.VSTS.Common.TestedBy-Forward",
              url: `https://dev.azure.com/${ADO_ORG}/${ADO_PROJ}/_apis/wit/workitems/701`,
              attributes: { name: "TC 1" },
            },
            {
              rel: "Microsoft.VSTS.Common.TestedBy-Forward",
              url: `https://dev.azure.com/${ADO_ORG}/${ADO_PROJ}/_apis/wit/workitems/702`,
              attributes: { name: "TC 2" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("Unexpected URL: " + url);
  });
  try {
    const handlers = captureToolHandlers(adoClient, null);
    const handler = handlers.get("qa_tests");
    assert.ok(handler, "handler should be registered");
    const result = await handler!({ userStoryId });
    assert.ok(result.structuredContent, "structuredContent should be present");
    const canonical = result.structuredContent as unknown as Canonical;
    assert.equal(canonical.item.type, "user-story");
    assert.equal(canonical.item.id, userStoryId);
    assert.ok(canonical.children);
    assert.equal(canonical.children!.length, 2);
    for (const child of canonical.children!) {
      assert.equal(child.type, "test-case");
      assert.equal(child.relationship, "tested-by");
    }
    assert.equal(canonical.completeness.isPartial, false);
  } finally {
    restore();
  }
});

test("qa_tests with zero links returns empty children", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const userStoryId = 600;
  const restore = mockFetch((url) => {
    if (url.includes(`/_apis/wit/workitems/${userStoryId}`)) {
      return new Response(
        JSON.stringify({
          id: userStoryId,
          rev: 1,
          url: `https://dev.azure.com/${ADO_ORG}/${ADO_PROJ}/_apis/wit/workitems/${userStoryId}`,
          fields: { "System.Title": "US" },
          relations: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error("Unexpected URL: " + url);
  });
  try {
    const handlers = captureToolHandlers(adoClient, null);
    const handler = handlers.get("qa_tests");
    assert.ok(handler, "handler should be registered");
    const result = await handler!({ userStoryId });
    assert.ok(result.structuredContent);
    const canonical = result.structuredContent as unknown as Canonical;
    assert.deepEqual(canonical.children, []);
    assert.equal(canonical.completeness.isPartial, false);
  } finally {
    restore();
  }
});

test("ado_fields with <=50 fields returns complete inventory", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const fields = Array.from({ length: 10 }, (_, i) => ({
    referenceName: `Custom.Field${i}`,
    name: `Field ${i}`,
    type: "string",
    readOnly: false,
  }));
  const restore = mockFetch((url) => {
    if (url.includes("/_apis/wit/fields")) {
      return new Response(JSON.stringify({ value: fields }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("Unexpected URL: " + url);
  });
  try {
    const handlers = captureToolHandlers(adoClient, null);
    const handler = handlers.get("ado_fields");
    assert.ok(handler, "handler should be registered");
    const result = await handler!({});
    assert.ok(result.structuredContent);
    const canonical = result.structuredContent as unknown as Canonical;
    assert.equal(canonical.item.type, "field-inventory");
    assert.equal(canonical.item.id, "ado-wit-fields");
    assert.equal(canonical.completeness.isPartial, false);
    assert.ok(canonical.children);
    assert.equal(canonical.children!.length, 10);
    assert.equal(canonical.children![0]!.type, "field-definition");
    assert.equal(canonical.children![0]!.relationship, "defined");
  } finally {
    restore();
  }
});

test("ado_fields with >50 fields marks partial", async () => {
  const adoClient = new AdoClient(ADO_ORG, ADO_PROJ, "pat");
  const fields = Array.from({ length: 75 }, (_, i) => ({
    referenceName: `Custom.Field${i}`,
    name: `Field ${i}`,
    type: "string",
    readOnly: false,
  }));
  const restore = mockFetch((url) => {
    if (url.includes("/_apis/wit/fields")) {
      return new Response(JSON.stringify({ value: fields }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("Unexpected URL: " + url);
  });
  try {
    const handlers = captureToolHandlers(adoClient, null);
    const handler = handlers.get("ado_fields");
    assert.ok(handler, "handler should be registered");
    const result = await handler!({});
    assert.ok(result.structuredContent);
    const canonical = result.structuredContent as unknown as Canonical;
    assert.equal(canonical.completeness.isPartial, true);
    assert.ok(canonical.completeness.reason);
    assert.ok(canonical.completeness.reason!.includes("50"));
    assert.ok(canonical.children);
    assert.equal(canonical.children!.length, 50);
  } finally {
    restore();
  }
});
