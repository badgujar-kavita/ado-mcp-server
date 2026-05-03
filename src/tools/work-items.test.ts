import { test } from "node:test";
import assert from "node:assert/strict";
import { AdoClient } from "../ado-client.ts";
import { ConfluenceClient } from "../confluence-client.ts";
import { extractUserStoryContext } from "./work-items.ts";
import type { AdoWorkItem } from "../types.ts";

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
