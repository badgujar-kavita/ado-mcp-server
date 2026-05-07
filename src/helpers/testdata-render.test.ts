/**
 * Test Data render + literal-`\n` normalization tests.
 *
 * Covers:
 * - renderTestData via buildPrerequisitesHtml emits a real <table> when
 *   testDataTable is present (mirrors preConditionsTable behavior).
 * - Falls back to <div> rendering when only the string `testData` is provided.
 * - formatContentForHtml + formatStepContent normalize literal `\n` substrings
 *   (the two-character escape sequence) into real <br>s — defensive recovery
 *   for agent paths that mis-escaped multi-row content.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatContentForHtml, formatStepContent } from "./format-html.ts";
import { buildPrerequisitesHtml } from "./prerequisites.ts";

test("buildPrerequisitesHtml: testDataTable → real <table> in ADO HTML", () => {
  const html = buildPrerequisitesHtml({
    testDataTable: {
      headers: ["Data", "Value"],
      rows: [
        ["Support Email", "support@company.com"],
        ["Web Form URL", "/support/contact"],
      ],
    },
  });
  // Test Data section emits <table> with thead + tbody, NOT a flat <div>.
  assert.match(html, /<table style="[^"]*border-collapse:collapse/);
  assert.match(html, /<th style="[^"]*">Data<\/th>/);
  assert.match(html, /<th style="[^"]*">Value<\/th>/);
  assert.match(html, /<td style="[^"]*">Support Email<\/td>/);
  assert.match(html, /<td style="[^"]*">support@company\.com<\/td>/);
  assert.match(html, /<td style="[^"]*">\/support\/contact<\/td>/);
});

test("buildPrerequisitesHtml: testData string (no table) → falls back to <div>", () => {
  const html = buildPrerequisitesHtml({
    testData: "A test customer with status Active",
  });
  // Falls back to legacy single-line div rendering.
  assert.match(html, /<div>A test customer with status Active<\/div>/);
  // Does NOT emit a <table>.
  assert.doesNotMatch(html, /<table /);
});

test("buildPrerequisitesHtml: testData with literal \\n substrings → real <br>s in HTML", () => {
  // The agent-side bug: testData passed as a single string with `\n` escape
  // sequences instead of real newlines. Renderer must normalize.
  const html = buildPrerequisitesHtml({
    testData: "Line one\\nLine two\\nLine three",
  });
  // Each segment becomes <br>-separated.
  assert.match(html, /Line one<br>Line two<br>Line three/);
  // No raw `\n` text leaks through.
  assert.doesNotMatch(html, /\\n/);
});

test("formatContentForHtml normalizes literal \\n to <br>", () => {
  const out = formatContentForHtml("a\\nb\\nc");
  assert.match(out, /a<br>b<br>c/);
  assert.doesNotMatch(out, /\\n/);
});

test("formatContentForHtml still handles real newlines (no regression)", () => {
  const out = formatContentForHtml("a\nb\nc");
  assert.match(out, /a<br>b<br>c/);
});

test("formatContentForHtml handles MIXED literal \\n + real newlines", () => {
  const out = formatContentForHtml("a\\nb\nc");
  assert.match(out, /a<br>b<br>c/);
});

test("formatStepContent normalizes literal \\n to <br> (steps too)", () => {
  const out = formatStepContent("Step 1\\nStep 2");
  assert.match(out, /Step 1<br>Step 2/);
});

test("formatContentForHtml preserves <br> from drafts AND normalizes \\n in same string", () => {
  // Mixed-source resilience: some drafts have <br>, some have \\n, some have both.
  const out = formatContentForHtml("a<br>b\\nc");
  assert.match(out, /a<br>b<br>c/);
});

test("buildPrerequisitesHtml: testDataTable wins over string testData when both present", () => {
  const html = buildPrerequisitesHtml({
    testData: "this should be ignored",
    testDataTable: {
      headers: ["K", "V"],
      rows: [["a", "b"]],
    },
  });
  assert.match(html, /<table /);
  assert.match(html, /<td style="[^"]*">a<\/td>/);
  assert.doesNotMatch(html, /this should be ignored/);
});
