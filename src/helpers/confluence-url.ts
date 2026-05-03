/**
 * Extracts Confluence page ID and URL from ADO rich text fields (e.g. Technical Solution / Solution Notes).
 *
 * ADO rich text area fields return HTML. The field may contain:
 *   - Descriptive text plus one or more links: "See Solution Design: <a href='...'>Confluence page</a>"
 *   - Plain URL pasted directly
 *   - HTML anchor only: <a href="...">Link text</a>
 *
 * This module scans the raw value and extracts the first Confluence link.
 * Links are found via href attributes; plain URLs are supported as fallback.
 *
 * Supported URL formats:
 *   - .../pages/{pageId}/Page+Title
 *   - .../pages/{pageId}
 *   - ...?pageId={pageId}
 */

import type { CategorizedLink, ExternalLinkType } from "../types.ts";

/** Matches /pages/123 or /pages/123/ in path - single scan over full string */
const PAGE_ID_IN_PATH = /\/pages\/(\d+)(?:\/|$|\?|&)/;
/** Matches ?pageId=123 or &pageId=123 in query string */
const PAGE_ID_IN_QUERY = /[?&]pageId=(\d+)(?:&|$)/;
/** href with optional whitespace - handles ADO rich text output */
const HREF_PATTERN = /href\s*=\s*["']([^"']+)["']/gi;

/** Confluence URL indicators - used to filter relevant links from rich text */
const isConfluenceUrl = (url: string): boolean =>
  url.includes("atlassian.net") || url.includes("confluence");

/**
 * Extracts the Confluence page ID from a rich text field value.
 * Single-pass scan: searches the entire string for distinctive Confluence patterns.
 * Works with HTML anchors, plain URLs, or mixed content.
 *
 * @deprecated Use `extractAllLinks()` + `extractConfluencePageIdFromUrl()` instead.
 *   Retained for backward compatibility with `src/tools/work-items.ts`.
 */
export function extractConfluencePageId(rawValue: string | null | undefined): string | null {
  if (!rawValue || typeof rawValue !== "string") return null;

  const s = rawValue.trim();
  if (!s) return null;

  const pathMatch = s.match(PAGE_ID_IN_PATH);
  if (pathMatch) return pathMatch[1];

  const queryMatch = s.match(PAGE_ID_IN_QUERY);
  if (queryMatch) return queryMatch[1];

  return null;
}

/**
 * Extracts the Confluence page URL from a rich text field value.
 * Prioritizes href attributes (links in rich text), then falls back to plain URL.
 * Returns only Confluence URLs (atlassian.net or confluence) when multiple links exist.
 *
 * @deprecated Use `extractAllLinks()` instead — it returns every link categorized
 *   by type, not just the first Confluence match. Retained for backward
 *   compatibility with `src/tools/work-items.ts`.
 */
export function extractConfluenceUrl(rawValue: string | null | undefined): string | null {
  if (!rawValue || typeof rawValue !== "string") return null;

  const s = rawValue.trim();
  if (!s) return null;

  const urls = extractUrlsFromRichText(s);

  // Return first Confluence URL (filters out ADO links, other non-Confluence hrefs in rich text)
  const confluenceUrl = urls.find(isConfluenceUrl);
  if (confluenceUrl) return confluenceUrl;

  // Plain URL pasted directly (no <a href>)
  if (/^https?:\/\//.test(s) && isConfluenceUrl(s)) return s;

  return null;
}

/**
 * Extracts URLs from ADO rich text: href attributes and plain URLs.
 * Handles href with optional whitespace around = for robustness.
 */
function extractUrlsFromRichText(value: string): string[] {
  const urls: string[] = [];
  let match: RegExpExecArray | null;

  HREF_PATTERN.lastIndex = 0;
  while ((match = HREF_PATTERN.exec(value)) !== null) {
    const url = match[1].trim();
    if (url) urls.push(url);
  }

  if (urls.length === 0 && /^https?:\/\//.test(value.trim())) {
    urls.push(value.trim());
  }

  return urls;
}

/**
 * Categorize a URL into one of the known external-system types.
 * Host-based classification; query string and path are ignored.
 */
export function categorizeLink(url: string): ExternalLinkType {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "Other";
  }

  if (host.endsWith("atlassian.net") || host.includes("confluence")) return "Confluence";
  if (host.endsWith("sharepoint.com") || host.endsWith("office.com")) return "SharePoint";
  if (host === "figma.com" || host.endsWith(".figma.com")) return "Figma";
  if (host === "lucid.app" || host === "lucidchart.com" || host.endsWith(".lucid.app") || host.endsWith(".lucidchart.com")) return "LucidChart";
  if (host === "drive.google.com" || host === "docs.google.com") return "GoogleDrive";
  return "Other";
}

/**
 * Extract the Confluence pageId from a URL (both /pages/{id} and ?pageId={id} variants).
 * Returns null if the URL doesn't contain either pattern. Does NOT check that the URL
 * is actually a Confluence URL — use `categorizeLink()` for that.
 */
export function extractConfluencePageIdFromUrl(url: string): string | null {
  const pathMatch = url.match(/\/pages\/(\d+)(?:\/|$|\?|&)/);
  if (pathMatch) return pathMatch[1];
  const queryMatch = url.match(/[?&]pageId=(\d+)(?:&|$)/);
  if (queryMatch) return queryMatch[1];
  return null;
}

/**
 * Extract every link from a rich-text / HTML field value, categorized by type.
 * Preserves the order in which links appear (document order). Deduplicates
 * on exact URL within the same call. `sourceField` tags each link so callers
 * can attribute it back to the ADO field it came from.
 *
 * For Confluence links, `pageId` is populated when extractable.
 *
 * Unlike `extractConfluenceUrl()` (which returned first-match-only), this
 * returns ALL links regardless of type.
 */
export function extractAllLinks(rawHtmlOrText: string, sourceField: string): CategorizedLink[] {
  if (!rawHtmlOrText) return [];
  const urls = extractUrlsFromRichText(rawHtmlOrText);
  const seen = new Set<string>();
  const result: CategorizedLink[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const type = categorizeLink(url);
    const link: CategorizedLink = { url, type, sourceField };
    if (type === "Confluence") {
      const pageId = extractConfluencePageIdFromUrl(url);
      if (pageId) link.pageId = pageId;
    }
    result.push(link);
  }
  return result;
}
