/**
 * Phase 2 tests for draft_roundtrip_fidelity.plan.md:
 * - Pre-requisite HTML builder emits real <table> when the draft source was
 *   a multi-column Markdown table (preConditionsTable present).
 * - Falls back to existing <ol>/<li> rendering when only flat preConditions[]
 *   is populated (backward compat).
 * - The buildAdoTable helper produces ADO-compatible inline-styled HTML.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdoTable, formatContentForHtml } from "./format-html.ts";
import { buildPrerequisitesHtml } from "./prerequisites.ts";

test("buildAdoTable emits <table> with inline styles + thead + tbody", () => {
  const html = buildAdoTable(
    ["Component", "Required State", "Notes"],
    [
      ["Feature X", "Enabled", "Required for test"],
      ["Market Config", "Populated", "Per Sales Org"],
    ],
  );
  assert.match(html, /<table style="[^"]*border-collapse:collapse[^"]*"/);
  assert.match(html, /<thead style="[^"]*"/);
  assert.match(html, /<tbody>/);
  assert.match(html, /<th style="[^"]*">Component<\/th>/);
  assert.match(html, /<th style="[^"]*">Required State<\/th>/);
  assert.match(html, /<th style="[^"]*">Notes<\/th>/);
  assert.match(html, /<td style="[^"]*">Feature X<\/td>/);
  assert.match(html, /<td style="[^"]*">Enabled<\/td>/);
  assert.match(html, /<td style="[^"]*">Per Sales Org<\/td>/);
});

test("buildAdoTable escapes HTML-unsafe cell content", () => {
  const html = buildAdoTable(["A"], [["<script>alert(1)</script>"]]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("buildAdoTable renders **bold** inside cells via formatContentForHtml", () => {
  const html = buildAdoTable(["Label"], [["**Required** condition"]]);
  assert.match(html, /<strong>Required<\/strong> condition/);
});

test("formatContentForHtml is called for each cell (sanity)", () => {
  // Prove the escape works end-to-end with the helper chain
  const cell = formatContentForHtml("a & b < c");
  assert.match(cell, /a &amp; b &lt; c/);
});

test("buildPrerequisitesHtml emits <table> when preConditionsTable is present and 3+ columns", () => {
  const html = buildPrerequisitesHtml({
    preConditions: ["Feature X must be enabled"], // flat fallback (ignored when table present)
    preConditionsTable: {
      headers: ["#", "Component", "Required State"],
      rows: [
        ["1", "Feature X", "Enabled"],
        ["2", "Market Config", "Populated"],
      ],
    },
  });
  assert.match(html, /<table style=/);
  assert.match(html, /<th style="[^"]*">Component<\/th>/);
  assert.match(html, /<td style="[^"]*">Feature X<\/td>/);
  // Should NOT fall back to <ol> when table is present
  assert.doesNotMatch(html, /<ol>/);
});

test("buildPrerequisitesHtml falls back to <ol> when preConditionsTable is absent (backward compat)", () => {
  const html = buildPrerequisitesHtml({
    preConditions: ["Condition A", "Condition B", "Condition C"],
  });
  assert.match(html, /<ol>/);
  assert.match(html, /<li>Condition A<\/li>/);
  assert.match(html, /<li>Condition B<\/li>/);
  assert.match(html, /<li>Condition C<\/li>/);
  assert.doesNotMatch(html, /<table/);
});

test("buildPrerequisitesHtml falls back to <ol> when preConditionsTable has only 2 columns", () => {
  // 2-column `| # | Condition |` is the standard flat form — must NOT emit <table>
  // because downstream readers still expect flat <ol> semantics for that shape.
  const html = buildPrerequisitesHtml({
    preConditions: ["Condition A", "Condition B"],
    preConditionsTable: {
      headers: ["#", "Condition"],
      rows: [
        ["1", "Condition A"],
        ["2", "Condition B"],
      ],
    },
  });
  assert.match(html, /<ol>/);
  assert.doesNotMatch(html, /<table/);
});

test("buildPrerequisitesHtml falls back to <ol> when preConditionsTable has zero rows", () => {
  const html = buildPrerequisitesHtml({
    preConditions: ["Fallback condition"],
    preConditionsTable: {
      headers: ["#", "Component", "State"],
      rows: [],
    },
  });
  assert.match(html, /<ol>/);
  assert.match(html, /<li>Fallback condition<\/li>/);
  assert.doesNotMatch(html, /<table/);
});

test("buildAdoTable inline styles include border, padding, font-family (ADO-friendly)", () => {
  const html = buildAdoTable(["H"], [["C"]]);
  // Verify key style fragments that match what survives in ADO rich-text
  assert.match(html, /border-collapse:collapse/);
  assert.match(html, /font-family:Inter/);
  assert.match(html, /border:1px solid rgb\(209, 213, 219\)/);
});
