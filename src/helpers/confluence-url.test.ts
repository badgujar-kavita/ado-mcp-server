import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categorizeLink,
  extractAllLinks,
  extractConfluencePageId,
  extractConfluencePageIdFromUrl,
  extractConfluenceUrl,
} from "./confluence-url.ts";

// ── categorizeLink ──

test("categorizeLink: atlassian.net tenant is Confluence", () => {
  assert.equal(
    categorizeLink("https://myco.atlassian.net/wiki/spaces/X/pages/123456/My-Page"),
    "Confluence",
  );
});

test("categorizeLink: different atlassian.net subdomain is still Confluence", () => {
  assert.equal(categorizeLink("https://different-subdomain.atlassian.net/foo"), "Confluence");
});

test("categorizeLink: host containing 'confluence' is Confluence (self-hosted)", () => {
  assert.equal(categorizeLink("https://confluence.example.com/foo"), "Confluence");
});

test("categorizeLink: *.sharepoint.com is SharePoint", () => {
  assert.equal(categorizeLink("https://mycompany.sharepoint.com/sites/X"), "SharePoint");
});

test("categorizeLink: *.office.com is SharePoint", () => {
  assert.equal(categorizeLink("https://outlook.office.com/mail/x"), "SharePoint");
});

test("categorizeLink: figma.com is Figma", () => {
  assert.equal(categorizeLink("https://figma.com/file/abc"), "Figma");
});

test("categorizeLink: www.figma.com (subdomain) is Figma", () => {
  assert.equal(categorizeLink("https://www.figma.com/file/abc"), "Figma");
});

test("categorizeLink: lucid.app is LucidChart", () => {
  assert.equal(categorizeLink("https://lucid.app/lucidchart/abc"), "LucidChart");
});

test("categorizeLink: lucidchart.com is LucidChart", () => {
  assert.equal(categorizeLink("https://lucidchart.com/publicSegments/view/xyz"), "LucidChart");
});

test("categorizeLink: drive.google.com is GoogleDrive", () => {
  assert.equal(categorizeLink("https://drive.google.com/file/d/abc/view"), "GoogleDrive");
});

test("categorizeLink: docs.google.com is GoogleDrive", () => {
  assert.equal(categorizeLink("https://docs.google.com/document/d/abc/edit"), "GoogleDrive");
});

test("categorizeLink: unknown host is Other", () => {
  assert.equal(categorizeLink("https://github.com/owner/repo"), "Other");
});

test("categorizeLink: not-a-url is Other", () => {
  assert.equal(categorizeLink("not-a-url"), "Other");
});

test("categorizeLink: empty string is Other", () => {
  assert.equal(categorizeLink(""), "Other");
});

// ── extractConfluencePageIdFromUrl ──

test("extractConfluencePageIdFromUrl: /pages/{id}/Title path variant", () => {
  assert.equal(
    extractConfluencePageIdFromUrl(
      "https://myco.atlassian.net/wiki/spaces/X/pages/123456/My-Page",
    ),
    "123456",
  );
});

test("extractConfluencePageIdFromUrl: /pages/{id} with no trailing slash", () => {
  assert.equal(
    extractConfluencePageIdFromUrl("https://myco.atlassian.net/wiki/spaces/X/pages/123456"),
    "123456",
  );
});

test("extractConfluencePageIdFromUrl: ?pageId={id} query variant", () => {
  assert.equal(
    extractConfluencePageIdFromUrl("https://myco.atlassian.net/wiki/display/X?pageId=987654"),
    "987654",
  );
});

test("extractConfluencePageIdFromUrl: ?pageId={id} with additional query params", () => {
  assert.equal(
    extractConfluencePageIdFromUrl(
      "https://myco.atlassian.net/wiki/display/X?pageId=987654&foo=bar",
    ),
    "987654",
  );
});

test("extractConfluencePageIdFromUrl: URL without either pattern returns null", () => {
  assert.equal(
    extractConfluencePageIdFromUrl("https://myco.atlassian.net/nothing-here"),
    null,
  );
});

test("extractConfluencePageIdFromUrl: relative /pages/{id}/abc path still matches", () => {
  assert.equal(extractConfluencePageIdFromUrl("/pages/123/abc"), "123");
});

// ── extractAllLinks ──

test("extractAllLinks: single href returns one categorized link with sourceField", () => {
  const html = '<p>See <a href="https://myco.atlassian.net/wiki/pages/42">here</a>.</p>';
  const result = extractAllLinks(html, "System.Description");
  assert.equal(result.length, 1);
  assert.equal(result[0].url, "https://myco.atlassian.net/wiki/pages/42");
  assert.equal(result[0].type, "Confluence");
  assert.equal(result[0].sourceField, "System.Description");
  assert.equal(result[0].pageId, "42");
});

test("extractAllLinks: multiple mixed hrefs are all categorized and order preserved", () => {
  const html = `<p>
    <a href="https://myco.atlassian.net/wiki/pages/100">one</a>
    <a href="https://mycompany.sharepoint.com/sites/X">two</a>
    <a href="https://figma.com/file/abc">three</a>
  </p>`;
  const result = extractAllLinks(html, "Custom.SolutionNotes");
  assert.equal(result.length, 3);
  assert.equal(result[0].type, "Confluence");
  assert.equal(result[0].url, "https://myco.atlassian.net/wiki/pages/100");
  assert.equal(result[1].type, "SharePoint");
  assert.equal(result[1].url, "https://mycompany.sharepoint.com/sites/X");
  assert.equal(result[2].type, "Figma");
  assert.equal(result[2].url, "https://figma.com/file/abc");
  for (const link of result) {
    assert.equal(link.sourceField, "Custom.SolutionNotes");
  }
});

test("extractAllLinks: duplicate URL in the same field is deduplicated", () => {
  const html =
    '<p><a href="https://x.atlassian.net/wiki/pages/7">a</a> and ' +
    '<a href="https://x.atlassian.net/wiki/pages/7">b</a></p>';
  const result = extractAllLinks(html, "System.Description");
  assert.equal(result.length, 1);
  assert.equal(result[0].url, "https://x.atlassian.net/wiki/pages/7");
});

test("extractAllLinks: Confluence URL with /pages/{id}/... populates pageId", () => {
  const html = '<a href="https://x.atlassian.net/wiki/spaces/S/pages/123/Title">l</a>';
  const result = extractAllLinks(html, "f");
  assert.equal(result.length, 1);
  assert.equal(result[0].pageId, "123");
});

test("extractAllLinks: Confluence URL with neither path nor query pattern omits pageId", () => {
  const html = '<a href="https://x.atlassian.net/wiki/overview">l</a>';
  const result = extractAllLinks(html, "f");
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "Confluence");
  assert.equal(result[0].pageId, undefined);
  assert.equal("pageId" in result[0], false);
});

test("extractAllLinks: plain-text URL (no <a> tag) is still extracted", () => {
  const result = extractAllLinks("https://myco.atlassian.net/wiki/pages/555", "System.Description");
  assert.equal(result.length, 1);
  assert.equal(result[0].url, "https://myco.atlassian.net/wiki/pages/555");
  assert.equal(result[0].type, "Confluence");
  assert.equal(result[0].pageId, "555");
});

test("extractAllLinks: empty string returns empty array", () => {
  assert.deepEqual(extractAllLinks("", "System.Description"), []);
});

test("extractAllLinks: null-ish input returns empty array", () => {
  // @ts-expect-error — runtime null-safety check
  assert.deepEqual(extractAllLinks(null, "f"), []);
  // @ts-expect-error — runtime null-safety check
  assert.deepEqual(extractAllLinks(undefined, "f"), []);
});

test("extractAllLinks: sourceField is echoed on every link", () => {
  const html =
    '<a href="https://figma.com/a">1</a><a href="https://github.com/b">2</a>';
  const result = extractAllLinks(html, "Custom.Design");
  assert.equal(result.length, 2);
  assert.equal(result[0].sourceField, "Custom.Design");
  assert.equal(result[1].sourceField, "Custom.Design");
});

// ── extractConfluenceUrl backward-compat ──

test("extractConfluenceUrl: still returns first Confluence match", () => {
  const html =
    '<p><a href="https://github.com/foo">code</a> ' +
    '<a href="https://myco.atlassian.net/wiki/pages/42">design</a></p>';
  assert.equal(extractConfluenceUrl(html), "https://myco.atlassian.net/wiki/pages/42");
});

test("extractConfluenceUrl: returns null when no Confluence link present", () => {
  const html = '<a href="https://github.com/foo">code</a>';
  assert.equal(extractConfluenceUrl(html), null);
});

// ── extractConfluencePageId backward-compat ──

test("extractConfluencePageId: still extracts pageId from path variant", () => {
  assert.equal(
    extractConfluencePageId(
      '<a href="https://myco.atlassian.net/wiki/spaces/X/pages/123456/My-Page">l</a>',
    ),
    "123456",
  );
});

test("extractConfluencePageId: still extracts pageId from query variant", () => {
  // Note: the legacy regex requires the pageId value to be terminated by `&` or
  // end-of-string, so we pass a plain URL here. (Inside an HTML attribute the
  // closing `"` would break the match — a long-standing quirk preserved for
  // backward-compat.)
  assert.equal(
    extractConfluencePageId("https://myco.atlassian.net/wiki/display/X?pageId=987654"),
    "987654",
  );
});
