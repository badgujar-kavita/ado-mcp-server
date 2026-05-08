import { loadConventionsConfig } from "../config.ts";
import type { Prerequisites, PersonaConfig } from "../types.ts";
import { formatContentForHtml, buildAdoTable } from "./format-html.ts";

/**
 * Builds the HTML Description field content from prerequisites input,
 * merging config defaults with caller overrides.
 */
export function buildPrerequisitesHtml(input?: Prerequisites): string {
  const config = loadConventionsConfig();
  const { prerequisites: prereqConfig, prerequisiteDefaults: defaults } = config;

  const lines: string[] = [];

  const rolesLabel = defaults.personaRolesLabel ?? "Roles";
  const psgLabel = defaults.personaPsgLabel ?? "Permission Set Group";

  for (const section of prereqConfig.sections) {
    const content = renderSection(section.key, section.label, section.required, input, defaults, rolesLabel, psgLabel);
    if (content !== null) {
      lines.push(content);
    }
  }

  if (lines.length === 0) return "";
  return lines.join("");
}

function renderSection(
  key: string,
  label: string,
  required: boolean,
  input: Prerequisites | undefined,
  defaults: {
    personas: Record<string, PersonaConfig>;
    personaRolesLabel?: string;
    personaPsgLabel?: string;
    commonPreConditions: string[];
    testData: string;
  },
  rolesLabel: string,
  psgLabel: string
): string | null {
  switch (key) {
    case "personas":
      return renderPersonas(label, input?.personas, defaults.personas, rolesLabel, psgLabel);
    case "preConditions":
      // Pre-requisite is ALWAYS unique per user story; never use config baseline.
      return renderPreConditions(
        label,
        input?.preConditions,
        [],
        input?.preConditionsTable,
        input?.preConditionsHierarchy,
      );
    case "testData":
      return renderTestData(label, input?.testData, input?.testDataTable, defaults.testData, required);
    default:
      return null;
  }
}

function renderPersonas(
  label: string,
  _override: string | string[] | null | undefined,
  defaultPersonas: Record<string, PersonaConfig>,
  rolesLabel: string,
  psgLabel: string
): string {
  let html = `<div><strong>${label}:</strong> </div><ul>`;
  const personaKeys = Object.keys(defaultPersonas);
  for (const key of personaKeys) {
    const persona = defaultPersonas[key];
    if (!persona) continue;
    html += `<li>${formatContentForHtml(persona.label)}`;
    html += `<ul>`;
    if (persona.user) html += `<li>${formatContentForHtml(persona.user)}</li>`;
    html += `<li>${rolesLabel} = ${formatContentForHtml(persona.roles)}</li>`;
    html += `<li>Profile = ${formatContentForHtml(persona.profile)}</li>`;
    html += `<li>${psgLabel} = ${formatContentForHtml(persona.psg)}</li>`;
    html += `</ul></li>`;
  }
  return html + "</ul><br>";
}

function renderPreConditions(
  label: string,
  extras: string[] | null | undefined,
  defaults: string[],
  structured?: { headers: string[]; rows: string[][] } | null,
  hierarchy?: Array<{ text: string; isChild: boolean }> | null,
): string {
  // Highest priority: structured 3+ column table. Emit <table> with inline styles.
  if (structured && structured.rows.length > 0 && structured.headers.length >= 3) {
    return `<div><strong>${label}:</strong> </div>${buildAdoTable(structured.headers, structured.rows)}<br>`;
  }

  // Second priority: hierarchical 2-column input where some rows are children
  // (authored as `- ...` or `• ...` under a parent). Emits proper nested
  // <ol><li>parent<ul><li>child</li></ul></li></ol> structure. Without this
  // path, child rows would render as broken sibling top-level numbered items.
  if (hierarchy && hierarchy.length > 0 && hierarchy.some((h) => h.isChild)) {
    return `<div><strong>${label}:</strong> </div>${renderHierarchicalList(hierarchy)}<br>`;
  }

  // Fallback: flat <ol> from preConditions[] OR from hierarchy when all rows
  // are non-child (parser may emit hierarchy as the canonical flat carrier).
  const hierarchyAsFlat = hierarchy?.map((h) => h.text) ?? [];
  const rawLines = [...defaults, ...(extras || []), ...(extras ? [] : hierarchyAsFlat)];
  if (rawLines.length === 0) return `<div><strong>${label}:</strong> </div><br>`;
  const allLines = expandListItems(rawLines);
  let html = `<div><strong>${label}:</strong> </div><ol>`;
  for (const line of allLines) {
    html += `<li>${formatContentForHtml(line)}</li>`;
  }
  return html + "</ol><br>";
}

/**
 * Render a flat array of `{ text, isChild }` rows as a properly nested
 * `<ol><li>...<ul><li>...</li></ul></li></ol>` structure.
 *
 * Algorithm: walk the array; non-child rows open a new top-level <li>;
 * consecutive child rows fold into a <ul> nested inside the prior parent's
 * <li>. Orphan child rows at the start (no preceding parent) are promoted
 * to parents — defensive against malformed input.
 */
function renderHierarchicalList(rows: Array<{ text: string; isChild: boolean }>): string {
  let html = "<ol>";
  let openParent = false;
  let openChildList = false;

  for (const row of rows) {
    if (row.isChild && openParent) {
      if (!openChildList) {
        html += "<ul>";
        openChildList = true;
      }
      html += `<li>${formatContentForHtml(row.text)}</li>`;
    } else {
      // Close any open child list, then close the prior parent <li>
      if (openChildList) {
        html += "</ul>";
        openChildList = false;
      }
      if (openParent) {
        html += "</li>";
      }
      // Open a new parent <li>
      html += `<li>${formatContentForHtml(row.text)}`;
      openParent = true;
    }
  }
  // Close any trailing open list/li
  if (openChildList) html += "</ul>";
  if (openParent) html += "</li>";
  return html + "</ol>";
}

/**
 * Splits on " • " (bullet) or "; " (semicolon) but ONLY when semicolon is outside parentheses.
 * Avoids breaking "L1 0-25,000; L2 25,001-50,000" inside "(e.g., ...)" into separate items.
 */
function splitListItemSafely(item: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < item.length; i++) {
    const c = item[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;

    const rest = item.slice(i);
    if (depth === 0) {
      if (rest.startsWith(" • ")) {
        result.push(item.slice(start, i).trim());
        start = i + 3;
        i += 2;
      } else if (rest.startsWith("; ")) {
        result.push(item.slice(start, i).trim());
        start = i + 2;
        i += 1;
      }
    }
  }
  const last = item.slice(start).trim();
  if (last) result.push(last);
  return result.length > 0 ? result : [item];
}

function expandListItems(items: string[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    const parts = splitListItemSafely(item).filter(Boolean);
    result.push(...(parts.length > 0 ? parts : [item]));
  }
  return result;
}

function renderOptionalList(
  label: string,
  override: string[] | null | undefined,
  defaultValue: string[] | null,
  required: boolean
): string | null {
  const rawItems = override ?? defaultValue;
  if (!rawItems || rawItems.length === 0) {
    return required ? `<div><strong>${label}:</strong> </div><div>N/A</div><br>` : null;
  }
  const items = expandListItems(rawItems);
  let html = `<div><strong>${label}:</strong> </div><ul>`;
  for (const line of items) {
    html += `<li>${formatContentForHtml(line)}</li>`;
  }
  return html + "</ul><br>";
}

function renderTestData(
  label: string,
  override: string | null | undefined,
  structured: { headers: string[]; rows: string[][] } | null | undefined,
  defaultValue: string,
  required: boolean
): string | null {
  // Prefer a structured table when present — emits a real ADO <table> with inline styles.
  // Mirrors renderPreConditions semantics. Same buildAdoTable used for prerequisites.
  if (structured && structured.rows.length > 0) {
    return `<div><strong>${label}:</strong> </div>${buildAdoTable(structured.headers, structured.rows)}<br>`;
  }

  const value = override ?? defaultValue;
  if (!value && !required) return null;
  // formatContentForHtml normalizes literal `\n` substrings → real <br>s, so even
  // a string-form Test Data with embedded escape sequences renders cleanly.
  return `<div><strong>${label}:</strong> </div><div>${formatContentForHtml(value || "N/A")}</div><br>`;
}

