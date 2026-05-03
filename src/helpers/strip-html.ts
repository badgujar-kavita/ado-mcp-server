/**
 * Convert HTML to a markdown-ish plain-text form.
 *
 * Extracted from `ConfluenceClient` so that ADO rich-text fields (descriptions,
 * acceptance criteria, solution notes, custom HTML fields) can use the same
 * converter. Behavior is preserved exactly from the original private method —
 * later phases may add options (e.g. `preserveImageMarkers`) without changing
 * the default output.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<h[1-6][^>]*>/gi, "## ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
