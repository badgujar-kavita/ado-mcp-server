/**
 * Round-trip fidelity tests for applyPostPushEditsInPlace.
 *
 * Covers Phase 1 of draft_roundtrip_fidelity.plan.md:
 * - Custom reviewer sections survive the publish write-back
 * - Status flip + ADO ID suffixes are the ONLY mutations
 * - Re-pushing is idempotent
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPostPushEditsInPlace } from "./tc-drafts.ts";

const FIXTURE_DRAFT = `# Test Cases: US #9999 — Sample with Custom Content

| | |
|---|---|
| **Status** | DRAFT |
| **Version** | 1 |
| **Last Updated** | 2026-05-06 |
| **Drafted By** | tester |
| **Plan ID** | To be derived |

---

## Functionality Process Flow

Custom flow narrative the parser doesn't fully capture.

---

## Reviewer Notes

- Reviewer-added bullet 1
- Reviewer-added bullet 2

---

## Coverage Validation Checklist

| # | Logic Branch |
|---|---|
| 1 | Custom-added coverage row — must survive publish |

---

## Story Summary

| Field | Value |
|---|---|
| **US ID** | 9999 |

---

## Common Prerequisites

### Persona

| Role | Profile |
|---|---|
| KAM | TPM_User_Profile |

### Test Data

| Setup | Purpose |
|---|---|
| Custom test data row A | Purpose A |
| Custom test data row B | Purpose B |

---

## Test Case 1

**TC_9999_01 -> Feature -> Area -> Verify something**

| | |
|---|---|
| **Priority** | 1 |
| **Use Case** | Sample |

### Pre-requisite (specific to this TC)

| # | Condition |
|---|---|
| 1 | Flag = TRUE for this TC only |

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Do something | Something should happen |

---

## Test Case 2

**TC_9999_02 -> Feature -> Area -> Verify other thing**

| | |
|---|---|
| **Priority** | 2 |
| **Use Case** | Sample 2 |

### Pre-requisite (specific to this TC)

| # | Condition |
|---|---|
| 1 | Flag = FALSE for this TC only |

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Do another thing | Other thing should happen |
`;

test("applyPostPushEditsInPlace flips Status DRAFT → APPROVED", () => {
  const { updatedMd, statusFlipped } = applyPostPushEditsInPlace(FIXTURE_DRAFT, 9999, [
    { tcNumber: 1, adoId: 12345 },
    { tcNumber: 2, adoId: 12346 },
  ]);
  assert.equal(statusFlipped, true);
  assert.match(updatedMd, /\|\s*\*\*Status\*\*\s*\|\s*APPROVED\s*\|/);
  assert.doesNotMatch(updatedMd, /\|\s*\*\*Status\*\*\s*\|\s*DRAFT\s*\|/);
});

test("applyPostPushEditsInPlace appends (ADO #N) to each TC title", () => {
  const { updatedMd, titlesUpdated, titlesSkipped } = applyPostPushEditsInPlace(FIXTURE_DRAFT, 9999, [
    { tcNumber: 1, adoId: 12345 },
    { tcNumber: 2, adoId: 12346 },
  ]);
  assert.equal(titlesUpdated, 2);
  assert.deepEqual(titlesSkipped, []);
  assert.match(updatedMd, /\*\*TC_9999_01 -> Feature -> Area -> Verify something \(ADO #12345\)\*\*/);
  assert.match(updatedMd, /\*\*TC_9999_02 -> Feature -> Area -> Verify other thing \(ADO #12346\)\*\*/);
});

test("applyPostPushEditsInPlace preserves reviewer-added custom sections verbatim", () => {
  const { updatedMd } = applyPostPushEditsInPlace(FIXTURE_DRAFT, 9999, [
    { tcNumber: 1, adoId: 12345 },
    { tcNumber: 2, adoId: 12346 },
  ]);

  // Reviewer Notes section preserved
  assert.match(updatedMd, /## Reviewer Notes/);
  assert.match(updatedMd, /- Reviewer-added bullet 1/);
  assert.match(updatedMd, /- Reviewer-added bullet 2/);

  // Coverage Validation Checklist preserved
  assert.match(updatedMd, /## Coverage Validation Checklist/);
  assert.match(updatedMd, /Custom-added coverage row — must survive publish/);

  // Test Data rows preserved
  assert.match(updatedMd, /Custom test data row A/);
  assert.match(updatedMd, /Custom test data row B/);

  // Per-TC Pre-requisite (specific to this TC) blocks preserved
  const specificPrereqMatches = updatedMd.match(/### Pre-requisite \(specific to this TC\)/g);
  assert.equal(specificPrereqMatches?.length, 2, "Both per-TC prereq blocks should survive");
  assert.match(updatedMd, /Flag = TRUE for this TC only/);
  assert.match(updatedMd, /Flag = FALSE for this TC only/);
});

test("applyPostPushEditsInPlace is byte-identical except for status + ADO ID suffixes", () => {
  const { updatedMd } = applyPostPushEditsInPlace(FIXTURE_DRAFT, 9999, [
    { tcNumber: 1, adoId: 12345 },
    { tcNumber: 2, adoId: 12346 },
  ]);

  // Strip the 3 known differences, then verify remainder is identical
  const normalize = (s: string) =>
    s
      .replace(/\|\s*\*\*Status\*\*\s*\|\s*(DRAFT|APPROVED)\s*\|/, "|STATUS|")
      .replace(/\*\*TC_9999_01 -> Feature -> Area -> Verify something( \(ADO #12345\))?\*\*/, "TC1TITLE")
      .replace(/\*\*TC_9999_02 -> Feature -> Area -> Verify other thing( \(ADO #12346\))?\*\*/, "TC2TITLE");

  assert.equal(normalize(updatedMd), normalize(FIXTURE_DRAFT));
});

test("applyPostPushEditsInPlace is idempotent on re-push", () => {
  const firstPush = applyPostPushEditsInPlace(FIXTURE_DRAFT, 9999, [
    { tcNumber: 1, adoId: 12345 },
    { tcNumber: 2, adoId: 12346 },
  ]);

  const secondPush = applyPostPushEditsInPlace(firstPush.updatedMd, 9999, [
    { tcNumber: 1, adoId: 12345 },
    { tcNumber: 2, adoId: 12346 },
  ]);

  assert.equal(secondPush.statusFlipped, false, "Status already APPROVED, should not flip again");
  assert.equal(secondPush.titlesUpdated, 0, "Titles already have suffix, should not append again");
  assert.equal(secondPush.updatedMd, firstPush.updatedMd, "Byte-identical output on re-push");

  // No duplicate (ADO #N) suffixes
  const tc1Matches = secondPush.updatedMd.match(/\(ADO #12345\)/g);
  assert.equal(tc1Matches?.length, 1);
  const tc2Matches = secondPush.updatedMd.match(/\(ADO #12346\)/g);
  assert.equal(tc2Matches?.length, 1);
});

test("applyPostPushEditsInPlace reports unmatched TC numbers in titlesSkipped", () => {
  const { titlesUpdated, titlesSkipped } = applyPostPushEditsInPlace(FIXTURE_DRAFT, 9999, [
    { tcNumber: 1, adoId: 12345 },
    { tcNumber: 99, adoId: 99999 }, // doesn't exist in fixture
  ]);
  assert.equal(titlesUpdated, 1);
  assert.deepEqual(titlesSkipped, [99]);
});

test("applyPostPushEditsInPlace handles TC already suffixed in mid-file (partial re-push)", () => {
  // Scenario: TC 1 was already pushed previously; TC 2 is new.
  const mixedDraft = FIXTURE_DRAFT
    .replace(/\| \*\*Status\*\* \| DRAFT \|/, "| **Status** | APPROVED |")
    .replace(
      "**TC_9999_01 -> Feature -> Area -> Verify something**",
      "**TC_9999_01 -> Feature -> Area -> Verify something (ADO #12345)**",
    );

  const { updatedMd, statusFlipped, titlesUpdated } = applyPostPushEditsInPlace(
    mixedDraft,
    9999,
    [
      { tcNumber: 1, adoId: 12345 }, // already suffixed
      { tcNumber: 2, adoId: 12346 }, // new
    ],
  );

  assert.equal(statusFlipped, false, "Already APPROVED");
  assert.equal(titlesUpdated, 1, "Only TC 2 title should be updated");
  assert.match(updatedMd, /TC_9999_01 -> Feature -> Area -> Verify something \(ADO #12345\)/);
  assert.match(updatedMd, /TC_9999_02 -> Feature -> Area -> Verify other thing \(ADO #12346\)/);

  // No duplicate suffixes on TC 1
  const tc1Matches = updatedMd.match(/\(ADO #12345\)/g);
  assert.equal(tc1Matches?.length, 1);
});

test("applyPostPushEditsInPlace does not match Status in non-header prose", () => {
  const tricky = FIXTURE_DRAFT.replace(
    "Custom-added coverage row — must survive publish",
    "Test that DRAFT status behavior works (prose mention)",
  );
  const { updatedMd, statusFlipped } = applyPostPushEditsInPlace(tricky, 9999, [
    { tcNumber: 1, adoId: 12345 },
    { tcNumber: 2, adoId: 12346 },
  ]);
  assert.equal(statusFlipped, true, "Header table row should still flip");
  // Prose mention of DRAFT should be untouched
  assert.match(updatedMd, /Test that DRAFT status behavior works/);
});
