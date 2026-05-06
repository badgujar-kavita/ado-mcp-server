/**
 * Pure classifier for the qa_publish_push pre-flight.
 *
 * Given the draft TCs + the ADO TCs currently linked to the User Story, splits
 * the push into four disjoint sets that the tool uses to decide which
 * structured response (if any) to return:
 *
 *   - toUpdate:        draft TC carries an adoWorkItemId AND that ID is linked to this US
 *   - toCreate:        draft TC has no adoWorkItemId AND no matching ADO TC by tcNumber
 *   - unlinkedDraftIds: draft TC carries an adoWorkItemId that is NOT in the US's linked set
 *   - orphansInAdo:    ADO TC linked to the US that is NOT represented in the draft
 *
 * Plus a mapping preview for the "attempt mapping" flow (scenario 3A):
 *   - mappingProposal[]: for each draft TC without an ID, the ADO TC (if any) whose
 *     parsed tcNumber from its title matches the draft TC's tcNumber.
 *
 * Pure function — no I/O, deterministic, fully unit-testable.
 */

export interface DraftTcView {
  tcNumber: number;
  adoWorkItemId?: number;
  titleHint?: string;
}

export interface AdoTcView {
  id: number;
  title: string;
  /** Parsed from title via TC_<usId>_<nn> -> ... — undefined if title doesn't match. */
  tcNumber?: number;
}

export interface PushStateAnalysis {
  toUpdate: Array<{ tcNumber: number; adoId: number }>;
  toCreate: Array<{ tcNumber: number }>;
  /** Draft TCs whose ADO ID is not among the US's currently linked TCs. */
  unlinkedDraftIds: Array<{ tcNumber: number; adoId: number }>;
  /** ADO TCs linked to the US that aren't represented in the draft. */
  orphansInAdo: Array<{ adoId: number; tcNumber?: number; title: string }>;
  /** Candidate mapping for draft TCs that lack an ID but have a same-numbered ADO TC. */
  mappingProposal: Array<{ tcNumber: number; adoId: number; adoTitle: string }>;
  /** Draft TCs with no ID and no same-numbered ADO TC to map to. */
  unmappableDraftTcs: number[];
  /** ADO TCs with parseable tcNumber that don't match any draft TC number (for mapping context). */
  adoTcsWithoutDraftMatch: Array<{ adoId: number; tcNumber: number; title: string }>;
  /** ADO TCs whose titles don't parse into TC_<us>_<nn> — mapping-by-number isn't possible for these. */
  adoTcsWithUnparseableTitles: Array<{ adoId: number; title: string }>;
}

/**
 * Parse `TC_<userStoryId>_<tcNumber>` out of an ADO test case title.
 * Accepts both ASCII `->` and Unicode `→` arrows following the prefix.
 * Returns undefined when the title doesn't match the convention.
 */
export function parseTcNumberFromAdoTitle(title: string, userStoryId: number): number | undefined {
  const re = new RegExp(`^\\s*TC_${userStoryId}_(\\d+)\\b`);
  const m = title.match(re);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Classify a push attempt.
 *
 * @param draftTcs    TCs parsed from the markdown draft
 * @param linkedAdoTcs TCs currently linked to the US in ADO (via TestedBy relation).
 *                     Pass titles as fetched from ADO so tcNumber can be parsed.
 * @param userStoryId  Used to parse tcNumber out of ADO titles.
 */
export function analyzePushState(
  draftTcs: DraftTcView[],
  linkedAdoTcs: Array<{ id: number; title: string }>,
  userStoryId: number,
): PushStateAnalysis {
  // Enrich ADO TCs with parsed tcNumber.
  const adoTcs: AdoTcView[] = linkedAdoTcs.map((t) => ({
    id: t.id,
    title: t.title,
    tcNumber: parseTcNumberFromAdoTitle(t.title, userStoryId),
  }));

  const linkedIdSet = new Set(adoTcs.map((t) => t.id));
  const draftIds = new Set(
    draftTcs.filter((t) => t.adoWorkItemId != null).map((t) => t.adoWorkItemId as number),
  );
  const draftNumbers = new Set(draftTcs.map((t) => t.tcNumber));

  const toUpdate: Array<{ tcNumber: number; adoId: number }> = [];
  const toCreate: Array<{ tcNumber: number }> = [];
  const unlinkedDraftIds: Array<{ tcNumber: number; adoId: number }> = [];
  const mappingProposal: Array<{ tcNumber: number; adoId: number; adoTitle: string }> = [];
  const unmappableDraftTcs: number[] = [];

  for (const d of draftTcs) {
    if (d.adoWorkItemId != null) {
      if (linkedIdSet.has(d.adoWorkItemId)) {
        toUpdate.push({ tcNumber: d.tcNumber, adoId: d.adoWorkItemId });
      } else {
        unlinkedDraftIds.push({ tcNumber: d.tcNumber, adoId: d.adoWorkItemId });
      }
      continue;
    }
    // Draft lacks an ADO ID — try mapping by TC number.
    const adoMatch = adoTcs.find((a) => a.tcNumber === d.tcNumber);
    if (adoMatch) {
      mappingProposal.push({ tcNumber: d.tcNumber, adoId: adoMatch.id, adoTitle: adoMatch.title });
    } else {
      // No ADO TC shares this TC number — it's a brand-new TC.
      toCreate.push({ tcNumber: d.tcNumber });
      unmappableDraftTcs.push(d.tcNumber);
    }
  }

  // Orphans: ADO TCs not represented in the draft at all.
  const draftMappedAdoIds = new Set([
    ...toUpdate.map((x) => x.adoId),
    ...mappingProposal.map((x) => x.adoId),
  ]);
  const orphansInAdo = adoTcs
    .filter((a) => !draftMappedAdoIds.has(a.id))
    .map((a) => ({ adoId: a.id, tcNumber: a.tcNumber, title: a.title }));

  const adoTcsWithoutDraftMatch = adoTcs
    .filter((a) => a.tcNumber != null && !draftNumbers.has(a.tcNumber))
    .map((a) => ({ adoId: a.id, tcNumber: a.tcNumber as number, title: a.title }));

  const adoTcsWithUnparseableTitles = adoTcs
    .filter((a) => a.tcNumber == null)
    .map((a) => ({ adoId: a.id, title: a.title }));

  return {
    toUpdate,
    toCreate,
    unlinkedDraftIds,
    orphansInAdo,
    mappingProposal,
    unmappableDraftTcs,
    adoTcsWithoutDraftMatch,
    adoTcsWithUnparseableTitles,
  };
}
