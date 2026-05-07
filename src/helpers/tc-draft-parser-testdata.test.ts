/**
 * Test Data parsing — verify parseTestDataTable extracts multi-row markdown tables
 * from the `### Test Data` block, recovers from literal `\n` strings, and falls
 * back to the legacy single-string shape when no table is present.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTcDraftFromMarkdown } from "./tc-draft-parser.ts";

function buildFixture(testDataBlock: string): string {
  return `# Test Cases: US #6000 — Sample

| | |
|---|---|
| **Status** | DRAFT |
| **Version** | 1 |
| **Last Updated** | 2026-05-07 |
| **Drafted By** | tester |

---

## Story Summary

| Field | Value |
|---|---|
| **US ID** | 6000 |
| **Title** | Sample |
| **State** | Active |
| **Area Path** | Root |
| **Iteration** | Sprint_1 |
| **Parent** | — |

---

## Common Prerequisites

### Persona

| Role | Profile |
|---|---|
| KAM | profile_x |

### Pre-requisite

| # | Condition |
|---|---|
| 1 | Some condition |

${testDataBlock}

---

## Test Case 1

**TC_6000_01 -> Feature -> Area -> Verify**

| | |
|---|---|
| **Priority** | 2 |
| **Use Case** | Verify |

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | step | result |
`;
}

test("parser: multi-row markdown Test Data table populates testDataTable", () => {
  const md = buildFixture(`### Test Data

| Data | Value |
|------|-------|
| Support Email | support@company.com |
| Web Form URL | /support/contact |
| Test Customer Email | test@test.com |`);
  const data = parseTcDraftFromMarkdown(md);
  assert.ok(data, "parser should return data");
  const t = data!.commonPrerequisites?.testDataTable;
  assert.ok(t, "testDataTable should be populated");
  assert.deepEqual(t!.headers, ["Data", "Value"]);
  assert.equal(t!.rows.length, 3);
  assert.deepEqual(t!.rows[0], ["Support Email", "support@company.com"]);
  assert.deepEqual(t!.rows[2], ["Test Customer Email", "test@test.com"]);
});

test("parser: literal \\n in Test Data block (legacy bug) recovers into testDataTable", () => {
  // This fixture mimics the buggy state from the screenshot: the entire table
  // collapsed onto one line with literal `\n` substrings (the two-character
  // escape sequence) between rows.
  const md = buildFixture(`### Test Data

| Data | Value |\\n|------|-------|\\n| Support Email | support@company.com |\\n| Web Form URL | /support/contact |`);
  const data = parseTcDraftFromMarkdown(md);
  assert.ok(data);
  const t = data!.commonPrerequisites?.testDataTable;
  assert.ok(t, "testDataTable should be populated even when rows were joined by literal \\n");
  assert.deepEqual(t!.headers, ["Data", "Value"]);
  assert.equal(t!.rows.length, 2);
  assert.deepEqual(t!.rows[0], ["Support Email", "support@company.com"]);
});

test("parser: N/A Test Data leaves testDataTable undefined and testData=N/A", () => {
  const md = buildFixture(`### Test Data

N/A`);
  const data = parseTcDraftFromMarkdown(md);
  assert.ok(data);
  assert.equal(data!.commonPrerequisites?.testDataTable, undefined);
  assert.equal(data!.commonPrerequisites?.testData, "N/A");
});

test("parser: legacy single-line Test Data string is preserved when no table", () => {
  const md = buildFixture(`### Test Data

A test customer with status Active and email test@example.com`);
  const data = parseTcDraftFromMarkdown(md);
  assert.ok(data);
  assert.equal(data!.commonPrerequisites?.testDataTable, undefined);
  assert.equal(
    data!.commonPrerequisites?.testData,
    "A test customer with status Active and email test@example.com",
  );
});

test("parser: Test Data block stops at next ### / ## / --- boundary", () => {
  const md = buildFixture(`### Test Data

| Data | Value |
|------|-------|
| K | V |`);
  const data = parseTcDraftFromMarkdown(md);
  assert.ok(data);
  const t = data!.commonPrerequisites?.testDataTable;
  assert.ok(t);
  assert.equal(t!.rows.length, 1);
  // Make sure the parser didn't bleed into the Test Case section below.
  assert.deepEqual(t!.rows[0], ["K", "V"]);
});
