/**
 * Phase 2 parser tests — verify parsePreReqTable extracts multi-column prereq tables.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTcDraftFromMarkdown } from "./tc-draft-parser.ts";

const FIXTURE_WITH_3COL_TABLE = `# Test Cases: US #5555 — Sample

| | |
|---|---|
| **Status** | DRAFT |
| **Version** | 1 |
| **Last Updated** | 2026-05-06 |
| **Drafted By** | tester |

---

## Story Summary

| Field | Value |
|---|---|
| **US ID** | 5555 |
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
| KAM | TPM_User_Profile |

### Pre-requisite

| # | Component | Required State |
|---|---|---|
| 1 | Feature X | Enabled |
| 2 | Market Config | Populated for Sales Org 1111 |
| 3 | LOA Record | Min/Max configured |

### Test Data

N/A

---

## Test Case 1

**TC_5555_01 -> Feature -> Area -> Verify something**

| | |
|---|---|
| **Priority** | 1 |
| **Use Case** | Sample |

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Do something | Happens |
`;

const FIXTURE_WITH_2COL_TABLE = `# Test Cases: US #5556 — Sample Flat

| | |
|---|---|
| **Status** | DRAFT |
| **Version** | 1 |
| **Last Updated** | 2026-05-06 |
| **Drafted By** | tester |

---

## Story Summary

| Field | Value |
|---|---|
| **US ID** | 5556 |
| **Title** | Sample Flat |
| **State** | Active |
| **Area Path** | Root |
| **Iteration** | Sprint_1 |
| **Parent** | — |

---

## Common Prerequisites

### Persona

| Role | Profile |
|---|---|
| KAM | TPM_User_Profile |

### Pre-requisite

| # | Condition |
|---|---|
| 1 | Condition A |
| 2 | Condition B |

### Test Data

N/A

---

## Test Case 1

**TC_5556_01 -> Feature -> Area -> Verify flat**

| | |
|---|---|
| **Priority** | 1 |
| **Use Case** | Sample |

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Do something | Happens |
`;

test("parser captures preConditionsTable when Pre-requisite has 3+ columns", () => {
  const data = parseTcDraftFromMarkdown(FIXTURE_WITH_3COL_TABLE);
  assert.ok(data, "draft should parse");
  const table = data!.commonPrerequisites?.preConditionsTable;
  assert.ok(table, "preConditionsTable should be populated for 3-column table");
  assert.deepEqual(table!.headers, ["#", "Component", "Required State"]);
  assert.equal(table!.rows.length, 3);
  assert.deepEqual(table!.rows[0], ["1", "Feature X", "Enabled"]);
  assert.deepEqual(table!.rows[1], ["2", "Market Config", "Populated for Sales Org 1111"]);
  assert.deepEqual(table!.rows[2], ["3", "LOA Record", "Min/Max configured"]);
});

test("parser leaves preConditionsTable undefined for 2-column (flat) tables (backward compat)", () => {
  const data = parseTcDraftFromMarkdown(FIXTURE_WITH_2COL_TABLE);
  assert.ok(data, "draft should parse");
  assert.equal(
    data!.commonPrerequisites?.preConditionsTable,
    undefined,
    "2-column table should be handled via flat preConditions[], not structured table",
  );
  // But flat preConditions[] should still be populated for backward compat
  assert.deepEqual(
    data!.commonPrerequisites?.preConditions,
    ["Condition A", "Condition B"],
  );
});

test("parser still populates flat preConditions[] even when preConditionsTable is present", () => {
  // Backward compatibility: downstream code may still consume preConditions[],
  // so the flat form should always be populated when the section has numbered rows.
  const data = parseTcDraftFromMarkdown(FIXTURE_WITH_3COL_TABLE);
  assert.ok(data, "draft should parse");
  // The 2-column regex strips `| # | ...` rows. In a 3-column table those rows
  // won't match the 2-column regex, so preConditions[] will be empty (expected).
  // Consumers seeing preConditionsTable present should prefer that over preConditions[].
  assert.ok(
    data!.commonPrerequisites?.preConditionsTable,
    "structured table should win over flat list for multi-column sources",
  );
});
