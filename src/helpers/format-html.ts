/**
 * Shared HTML formatting for ADO work item fields.
 * Converts markdown-style content to ADO-compatible HTML.
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Converts list patterns to HTML:
 * - "A. X B. Y" or "A. X<br>B. Y" -> <ol><li>...</li></ol>
 * - "1. X 2. Y" -> <ol><li>...</li></ol>
 * - "- X<br>- Y" or "- X - Y" -> <ul><li>...</li></ul>
 */
function convertListPatterns(str: string): string {
  const hasLetterList = /(?:<br>|\s+)[A-Z]\.\s+/.test(str);
  const hasNumberList = /(?:<br>|\s+)\d+\.\s+/.test(str);
  const hasBulletList = /(?:^|<br>)-\s+/.test(str);

  if (hasLetterList) {
    const withList = str.replace(/(?:<br>|\s+)([A-Z])\.\s+/g, "</li><li>$1. ");
    return "<ol><li>" + withList + "</li></ol>";
  }
  if (hasNumberList && !hasLetterList) {
    const withList = str.replace(/(?:<br>|\s+)(\d+)\.\s+/g, "</li><li>$1. ");
    return "<ol><li>" + withList + "</li></ol>";
  }
  if (hasBulletList) {
    // "- X<br>- Y" or "- X - Y" -> <ul><li>X</li><li>Y</li></ul>
    const withList = str
      .replace(/^-\s+/, "<ul><li>")
      .replace(/(?:<br>|\s+)-\s+/g, "</li><li>");
    return withList + "</li></ul>";
  }
  return str;
}

/**
 * Escapes HTML and converts markdown-style formatting to ADO-compatible HTML.
 * Used for Prerequisite for Test, TO BE TESTED FOR, and similar fields.
 * Normalizes literal <br> from drafts so convertListPatterns can detect "A. X<br>B. Y".
 */
export function formatContentForHtml(str: string): string {
  // Normalize literal <br> or <br/> so list conversion works (same as formatStepContent)
  const normalized = str.replace(/<br\s*\/?>/gi, "\n");
  const escaped = escapeHtml(normalized);
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const withNewlines = withBold.replace(/\n/g, "<br>");
  return convertListPatterns(withNewlines);
}

/**
 * Formats step action/expected result for ADO test steps XML.
 * Converts **bold** and A./B. list patterns. Result is passed to escapeXml.
 * Normalizes literal <br> from drafts to newlines so they trigger list conversion.
 */
export function formatStepContent(str: string): string {
  // Normalize literal <br> or <br/> from drafts so convertListPatterns can detect "A. X<br>B. Y"
  const normalized = str.replace(/<br\s*\/?>/gi, "\n");
  const escaped = escapeHtml(normalized);
  const withBold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const withNewlines = withBold.replace(/\n/g, "<br>");
  return convertListPatterns(withNewlines);
}
