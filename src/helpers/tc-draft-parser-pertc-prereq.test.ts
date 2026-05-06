/**
 * Phase 1 tests for md_ado_sync_gaps.plan.md:
 * Parser extracts per-TC Pre-requisite blocks from both canonical and legacy headings.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTcDraftFromMarkdown } from "./tc-draft-parser.ts";

const FIXTURE_CANONICAL_HEADING = `# Test Cases: US #7777 — Per-TC Prereq Canonical

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
| **US ID** | 7777 |
| **Title** | Per-TC Prereq Canonical |
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
| 1 | Common condition A |
| 2 | Common condition B |

### Test Data

N/A

---

## Test Case 1

**TC_7777_01 -> Feature -> Area -> Verify with canonical per-TC prereq**

| | |
|---|---|
| **Priority** | 1 |
| **Use Case** | Sample |

### Pre-requisite (specific to this TC)

| # | Condition |
|---|---|
| 1 | TC-specific condition X |
| 2 | TC-specific condition Y |

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Do something | Happens |

---

## Test Case 2

**TC_7777_02 -> Feature -> Area -> Verify with no per-TC prereq**

| | |
|---|---|
| **Priority** | 2 |
| **Use Case** | No extra |

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Do it | OK |
`;

const FIXTURE_LEGACY_HEADING = `# Test Cases: US #7778 — Per-TC Prereq Legacy

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
| **US ID** | 7778 |
| **Title** | Per-TC Prereq Legacy |
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
| 1 | Common A |

### Test Data

N/A

---

## Test Case 1

**TC_7778_01 -> Feature -> Area -> Verify with legacy heading**

| | |
|---|---|
| **Priority** | 1 |
| **Use Case** | Legacy |

**Additional Pre-requisite (TC-specific):**

| # | Condition |
|---|---|
| 1 | Legacy TC-specific |

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Do it | OK |
`;

test("parser extracts per-TC Pre-requisite via canonical ### heading", () => {
  const data = parseTcDraftFromMarkdown(FIXTURE_CANONICAL_HEADING);
  assert.ok(data, "draft should parse");
  const tc1 = data!.testCases.find((t) => t.tcNumber === 1);
  assert.ok(tc1, "TC 1 should parse");
  assert.ok(tc1!.prerequisites, "TC 1 should have per-TC prerequisites");
  assert.deepEqual(tc1!.prerequisites!.preConditions, [
    "TC-specific condition X",
    "TC-specific condition Y",
  ]);
});

test("parser leaves prerequisites undefined when no per-TC block", () => {
  const data = parseTcDraftFromMarkdown(FIXTURE_CANONICAL_HEADING);
  const tc2 = data!.testCases.find((t) => t.tcNumber === 2);
  assert.ok(tc2, "TC 2 should parse");
  assert.equal(
    tc2!.prerequisites,
    undefined,
    "TC 2 has no per-TC block → prerequisites should be undefined",
  );
});

test("parser accepts legacy `**Additional Pre-requisite (TC-specific):**` heading (back-compat)", () => {
  const data = parseTcDraftFromMarkdown(FIXTURE_LEGACY_HEADING);
  assert.ok(data, "draft should parse");
  const tc1 = data!.testCases.find((t) => t.tcNumber === 1);
  assert.ok(tc1, "TC 1 should parse");
  assert.ok(tc1!.prerequisites, "TC 1 should have per-TC prerequisites via legacy heading");
  assert.deepEqual(tc1!.prerequisites!.preConditions, ["Legacy TC-specific"]);
});

test("parser common prereq + per-TC prereq are both extracted (additive at merge time)", () => {
  const data = parseTcDraftFromMarkdown(FIXTURE_CANONICAL_HEADING);
  assert.ok(data, "draft should parse");

  // Common prereq: 2 conditions
  assert.deepEqual(data!.commonPrerequisites?.preConditions, [
    "Common condition A",
    "Common condition B",
  ]);

  // Per-TC prereq on TC 1: 2 conditions
  const tc1 = data!.testCases.find((t) => t.tcNumber === 1)!;
  assert.deepEqual(tc1.prerequisites!.preConditions, [
    "TC-specific condition X",
    "TC-specific condition Y",
  ]);

  // Additive merge is the responsibility of mergePrerequisites() at push time;
  // parser job is just to expose both sides.
});
