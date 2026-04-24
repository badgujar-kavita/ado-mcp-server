import { loadConventionsConfig } from "../config.ts";
import type { Prerequisites, PersonaConfig } from "../types.ts";
import { formatContentForHtml } from "./format-html.ts";

/**
 * Builds the HTML Description field content from prerequisites input,
 * merging config defaults with caller overrides.
 */
export function buildPrerequisitesHtml(input?: Prerequisites): string {
  const config = loadConventionsConfig();
  const { prerequisites: prereqConfig, prerequisiteDefaults: defaults } = config;

  const lines: string[] = [];

  for (const section of prereqConfig.sections) {
    const content = renderSection(section.key, section.label, section.required, input, defaults);
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
    commonPreConditions: string[];
    testData: string;
  }
): string | null {
  switch (key) {
    case "personas":
      return renderPersonas(label, input?.personas, defaults.personas);
    case "preConditions":
      // Pre-requisite is ALWAYS unique per user story; never use config baseline.
      return renderPreConditions(label, input?.preConditions, []);
    case "testData":
      return renderTestData(label, input?.testData, defaults.testData, required);
    default:
      return null;
  }
}

function renderPersonas(
  label: string,
  _override: string | string[] | null | undefined,
  defaultPersonas: Record<string, PersonaConfig>
): string {
  let html = `<div><strong>${label}:</strong> </div><ul>`;
  const personaKeys = Object.keys(defaultPersonas);
  for (const key of personaKeys) {
    const persona = defaultPersonas[key];
    if (!persona) continue;
    html += `<li>${formatContentForHtml(persona.label)}`;
    html += `<ul>`;
    if (persona.user) html += `<li>${formatContentForHtml(persona.user)}</li>`;
    html += `<li>TPM Roles = ${formatContentForHtml(persona.tpmRoles)}</li>`;
    html += `<li>Profile = ${formatContentForHtml(persona.profile)}</li>`;
    html += `<li>PSG = ${formatContentForHtml(persona.psg)}</li>`;
    html += `</ul></li>`;
  }
  return html + "</ul><br>";
}

function renderPreConditions(
  label: string,
  extras: string[] | null | undefined,
  defaults: string[]
): string {
  const rawLines = [...defaults, ...(extras || [])];
  if (rawLines.length === 0) return `<div><strong>${label}:</strong> </div><br>`;
  const allLines = expandListItems(rawLines);
  let html = `<div><strong>${label}:</strong> </div><ol>`;
  for (const line of allLines) {
    html += `<li>${formatContentForHtml(line)}</li>`;
  }
  return html + "</ol><br>";
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
  defaultValue: string,
  required: boolean
): string | null {
  const value = override ?? defaultValue;
  if (!value && !required) return null;
  return `<div><strong>${label}:</strong> </div><div>${formatContentForHtml(value || "N/A")}</div><br>`;
}

