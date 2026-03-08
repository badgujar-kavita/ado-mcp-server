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
