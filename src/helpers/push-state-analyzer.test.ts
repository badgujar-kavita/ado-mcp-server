import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzePushState,
  parseTcNumberFromAdoTitle,
  type DraftTcView,
} from "./push-state-analyzer.ts";

// ── parseTcNumberFromAdoTitle ────────────────────────────────────────────

test("parseTcNumberFromAdoTitle parses TC_<us>_<nn> prefix", () => {
  assert.equal(parseTcNumberFromAdoTitle("TC_123_01 -> Feature -> Verify X", 123), 1);
  assert.equal(parseTcNumberFromAdoTitle("TC_123_12 → Feature → Verify X", 123), 12);
});

test("parseTcNumberFromAdoTitle returns undefined when US id doesn't match", () => {
  assert.equal(parseTcNumberFromAdoTitle("TC_999_01 -> ...", 123), undefined);
});

test("parseTcNumberFromAdoTitle returns undefined for non-convention titles", () => {
  assert.equal(parseTcNumberFromAdoTitle("Manually created TC without prefix", 123), undefined);
  assert.equal(parseTcNumberFromAdoTitle("tc_123_01 lowercase", 123), undefined);
});

// ── analyzePushState: scenario 4/12 (pure update) ────────────────────────

test("analyzePushState: all draft IDs match ADO → toUpdate only", () => {
  const draft: DraftTcView[] = [
    { tcNumber: 1, adoWorkItemId: 100 },
    { tcNumber: 2, adoWorkItemId: 200 },
  ];
  const linked = [
    { id: 100, title: "TC_7_01 -> A -> B" },
    { id: 200, title: "TC_7_02 -> A -> C" },
  ];
  const r = analyzePushState(draft, linked, 7);
  assert.deepEqual(
    r.toUpdate.sort((a, b) => a.tcNumber - b.tcNumber),
    [
      { tcNumber: 1, adoId: 100 },
      { tcNumber: 2, adoId: 200 },
    ],
  );
  assert.equal(r.toCreate.length, 0);
  assert.equal(r.unlinkedDraftIds.length, 0);
  assert.equal(r.orphansInAdo.length, 0);
});

// ── analyzePushState: scenario 1 (empty ADO, no IDs) ─────────────────────

test("analyzePushState: fresh push → toCreate only", () => {
  const draft: DraftTcView[] = [
    { tcNumber: 1 },
    { tcNumber: 2 },
  ];
  const r = analyzePushState(draft, [], 7);
  assert.deepEqual(r.toCreate, [{ tcNumber: 1 }, { tcNumber: 2 }]);
  assert.equal(r.toUpdate.length, 0);
  assert.equal(r.orphansInAdo.length, 0);
  assert.equal(r.mappingProposal.length, 0);
});

// ── analyzePushState: scenario 3 (mapping by TC number) ──────────────────

test("analyzePushState: draft has no IDs, ADO has same tc numbers → mappingProposal", () => {
  const draft: DraftTcView[] = [
    { tcNumber: 1 },
    { tcNumber: 2 },
  ];
  const linked = [
    { id: 100, title: "TC_7_01 -> Feature -> Verify A" },
    { id: 200, title: "TC_7_02 -> Feature -> Verify B" },
  ];
  const r = analyzePushState(draft, linked, 7);
  assert.equal(r.mappingProposal.length, 2);
  assert.equal(r.toUpdate.length, 0);
  assert.equal(r.toCreate.length, 0);
  // Draft TCs that ARE mappable should not appear as orphans either way.
  assert.equal(r.orphansInAdo.length, 0);
});

// ── analyzePushState: scenario 6 (mixed update + create) ─────────────────

test("analyzePushState: draft has some IDs + some new TCs → toUpdate + toCreate", () => {
  const draft: DraftTcView[] = [
    { tcNumber: 1, adoWorkItemId: 100 },
    { tcNumber: 2, adoWorkItemId: 200 },
    { tcNumber: 3 }, // brand new
  ];
  const linked = [
    { id: 100, title: "TC_7_01 -> A" },
    { id: 200, title: "TC_7_02 -> B" },
  ];
  const r = analyzePushState(draft, linked, 7);
  assert.equal(r.toUpdate.length, 2);
  assert.deepEqual(r.toCreate, [{ tcNumber: 3 }]);
  assert.equal(r.orphansInAdo.length, 0);
});

// ── analyzePushState: scenario 5 (extras in ADO) ─────────────────────────

test("analyzePushState: draft ⊂ ADO (user pruned draft) → orphansInAdo populated", () => {
  const draft: DraftTcView[] = [
    { tcNumber: 1, adoWorkItemId: 100 },
  ];
  const linked = [
    { id: 100, title: "TC_7_01 -> A" },
    { id: 200, title: "TC_7_02 -> B" }, // orphan
    { id: 300, title: "TC_7_03 -> C" }, // orphan
  ];
  const r = analyzePushState(draft, linked, 7);
  assert.equal(r.toUpdate.length, 1);
  assert.equal(r.orphansInAdo.length, 2);
  assert.deepEqual(
    r.orphansInAdo.map((o) => o.adoId).sort(),
    [200, 300],
  );
});

// ── analyzePushState: scenario 8 (unlinked draft IDs) ────────────────────

test("analyzePushState: draft has IDs not linked to this US → unlinkedDraftIds", () => {
  const draft: DraftTcView[] = [
    { tcNumber: 1, adoWorkItemId: 9999 }, // foreign ID
    { tcNumber: 2, adoWorkItemId: 200 },
  ];
  const linked = [
    { id: 200, title: "TC_7_02 -> B" },
  ];
  const r = analyzePushState(draft, linked, 7);
  assert.deepEqual(r.unlinkedDraftIds, [{ tcNumber: 1, adoId: 9999 }]);
  assert.equal(r.toUpdate.length, 1);
  assert.equal(r.toUpdate[0].adoId, 200);
});

// ── analyzePushState: scenario 9 (tc number mismatch) ────────────────────

test("analyzePushState: ADO uses TC numbers the draft doesn't know → adoTcsWithoutDraftMatch", () => {
  const draft: DraftTcView[] = [
    { tcNumber: 1 }, // new
    { tcNumber: 2 }, // new
  ];
  const linked = [
    { id: 100, title: "TC_7_03 -> was-tc03" }, // ADO has 03, draft doesn't
    { id: 200, title: "TC_7_05 -> was-tc05" },
  ];
  const r = analyzePushState(draft, linked, 7);
  // No mapping possible — draft TCs land in toCreate.
  assert.deepEqual(r.toCreate, [{ tcNumber: 1 }, { tcNumber: 2 }]);
  assert.deepEqual(r.unmappableDraftTcs.sort(), [1, 2]);
  assert.deepEqual(
    r.adoTcsWithoutDraftMatch.map((a) => a.tcNumber).sort(),
    [3, 5],
  );
  // ADO TCs with parseable titles but no matching draft TC → also orphans.
  assert.equal(r.orphansInAdo.length, 2);
});

// ── analyzePushState: ADO titles that don't parse ────────────────────────

test("analyzePushState: manually-created ADO TCs without TC_<us>_<nn> prefix go to adoTcsWithUnparseableTitles", () => {
  const draft: DraftTcView[] = [{ tcNumber: 1 }];
  const linked = [
    { id: 100, title: "Manual TC without prefix" },
    { id: 200, title: "TC_7_02 -> B" },
  ];
  const r = analyzePushState(draft, linked, 7);
  assert.equal(r.adoTcsWithUnparseableTitles.length, 1);
  assert.equal(r.adoTcsWithUnparseableTitles[0].adoId, 100);
  // Both unparsed-title and the-other unmapped TCs show as orphans.
  assert.equal(r.orphansInAdo.length, 2);
});

// ── analyzePushState: mixed mapping + creation ───────────────────────────

test("analyzePushState: some draft TCs map, some are new", () => {
  const draft: DraftTcView[] = [
    { tcNumber: 1 }, // maps to ADO 100
    { tcNumber: 2 }, // maps to ADO 200
    { tcNumber: 3 }, // new
  ];
  const linked = [
    { id: 100, title: "TC_7_01 -> A" },
    { id: 200, title: "TC_7_02 -> B" },
  ];
  const r = analyzePushState(draft, linked, 7);
  assert.equal(r.mappingProposal.length, 2);
  assert.deepEqual(r.toCreate, [{ tcNumber: 3 }]);
  assert.deepEqual(r.unmappableDraftTcs, [3]);
  assert.equal(r.orphansInAdo.length, 0);
});

// ── analyzePushState: empty draft ────────────────────────────────────────

test("analyzePushState: empty draft + non-empty ADO → all ADO TCs are orphans", () => {
  const linked = [
    { id: 100, title: "TC_7_01 -> A" },
    { id: 200, title: "TC_7_02 -> B" },
  ];
  const r = analyzePushState([], linked, 7);
  assert.equal(r.toUpdate.length, 0);
  assert.equal(r.toCreate.length, 0);
  assert.equal(r.orphansInAdo.length, 2);
});

// ── analyzePushState: both empty ─────────────────────────────────────────

test("analyzePushState: both draft and ADO empty → all zero", () => {
  const r = analyzePushState([], [], 7);
  assert.equal(r.toUpdate.length, 0);
  assert.equal(r.toCreate.length, 0);
  assert.equal(r.orphansInAdo.length, 0);
  assert.equal(r.mappingProposal.length, 0);
  assert.equal(r.unlinkedDraftIds.length, 0);
});
