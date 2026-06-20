/**
 * Parser tests for TC↔ADO ID extraction.
 *
 * Regression: inline `(ADO #<id>)` references inside step text were being picked
 * up as the TC's adoWorkItemId because the regex scanned the whole TC section.
 * The parser must read the ID only from the title line.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTcDraftFromMarkdown } from "./tc-draft-parser.ts";

const FIXTURE_HEADER = `# Test Cases: US #1435557 — Sample

| | |
|---|---|
| **Status** | APPROVED |
| **Version** | 1 |
| **Last Updated** | 2026-06-20 |
| **Drafted By** | tester |

---

## Story Summary

| Field | Value |
|---|---|
| **US ID** | 1435557 |
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

| # | Condition |
|---|---|
| 1 | Baseline |

### Test Data

N/A

---
`;

test("parser ignores inline (ADO #<id>) in step text when title has no ADO ID", () => {
  const md = `${FIXTURE_HEADER}
## Test Case 1

**TC_1435557_01 -> Feature -> Area -> Verify something**

| | |
|---|---|
| **Priority** | 1 |
| **Use Case** | Sample |

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Create base data (reference: ADO #1446798). Then do X. | Happens |
`;
  const data = parseTcDraftFromMarkdown(md);
  assert.ok(data, "draft should parse");
  assert.equal(
    data!.testCases[0].adoWorkItemId,
    undefined,
    "inline ADO reference inside step text must NOT be treated as the TC's adoWorkItemId",
  );
});

test("parser captures adoWorkItemId from the title (ADO #<id>) suffix", () => {
  const md = `${FIXTURE_HEADER}
## Test Case 1

**TC_1435557_01 -> Feature -> Area -> Verify something (ADO #1447807)**

| | |
|---|---|
| **Priority** | 1 |
| **Use Case** | Sample |

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Do something | Happens |
`;
  const data = parseTcDraftFromMarkdown(md);
  assert.ok(data, "draft should parse");
  assert.equal(data!.testCases[0].adoWorkItemId, 1447807);
});

test("parser prefers title ADO ID over any (ADO #<id>) appearing in steps", () => {
  const md = `${FIXTURE_HEADER}
## Test Case 1

**TC_1435557_01 -> Feature -> Area -> Verify something (ADO #1447807)**

| | |
|---|---|
| **Priority** | 1 |
| **Use Case** | Sample |

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Create base (reference: ADO #1446798). | Happens |
`;
  const data = parseTcDraftFromMarkdown(md);
  assert.ok(data, "draft should parse");
  assert.equal(
    data!.testCases[0].adoWorkItemId,
    1447807,
    "the title-level ADO ID is the canonical TC mapping; step-level references must be ignored",
  );
});
