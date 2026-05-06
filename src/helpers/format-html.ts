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
 * Build an ADO-compatible HTML table with inline styles.
 *
 * Inline styles are verified against a manual paste on TC #1391478 — ADO's
 * rich-text field preserves <table>, <thead>, <tbody>, <tr>, <th>, <td> with
 * inline style attributes. <style> blocks and external CSS are stripped by
 * ADO; only inline styles survive.
 *
 * Cells are passed through formatContentForHtml so **bold** and A./B. lists
 * inside cells still render correctly.
 */
export function buildAdoTable(headers: string[], rows: string[][]): string {
  const tableStyle =
    "box-sizing:border-box;border-collapse:collapse;margin:1rem 0;" +
    "border:0px solid;font-size:0.875rem;font-family:Inter, sans-serif;";
  const theadStyle =
    "box-sizing:border-box;border-width:0px 0px 2px;border-style:solid;" +
    "background-color:rgb(248, 249, 250);";
  const thStyle =
    "box-sizing:border-box;border:1px solid rgb(209, 213, 219);" +
    "padding:10px 14px;text-align:left;color:rgb(55, 65, 81);font-weight:600;";
  const tdStyle =
    "box-sizing:border-box;border:1px solid rgb(209, 213, 219);" +
    "padding:8px 14px;color:rgb(75, 85, 99);";

  let html = `<table style="${tableStyle}">`;
  if (headers.length > 0) {
    html += `<thead style="${theadStyle}"><tr>`;
    for (const h of headers) html += `<th style="${thStyle}">${formatContentForHtml(h)}</th>`;
    html += "</tr></thead>";
  }
  html += "<tbody>";
  for (const row of rows) {
    html += "<tr>";
    for (const cell of row) html += `<td style="${tdStyle}">${formatContentForHtml(cell)}</td>`;
    html += "</tr>";
  }
  return html + "</tbody></table>";
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
