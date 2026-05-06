# Re-push Test Cases — Update or Delete & Re-create

When you need to re-push test cases (e.g. draft was revised), use one of these workflows.

## Option A — Repush (Update Existing) — Preferred

Use when you revised the draft and want to **update** existing test cases in ADO. Formatting is re-applied.

### Steps

1. **Restart Cursor** (or reload MCP) so the latest server is loaded.
2. **Edit the draft** (`tc-drafts/US_xxx_test_cases.md`) with your changes.
3. **Keep the draft as APPROVED** — the ADO IDs `(ADO #12345)` must remain in each TC title.
4. Run **`/vortex-ado/qa-publish`** with Plan ID and User Story ID.
5. On the first call, `qa_publish_push` will return a structured **`approved-with-ids-no-repush`** response (ℹ️ INFO, `isError: true`) presenting two options:
   - **A.** Repush — update the existing test cases with the revised draft content.
   - **B.** Cancel.

   The agent surfaces these verbatim and waits. Repush does NOT happen until you explicitly reply **A**.
6. Reply **A**. The agent re-runs `qa_publish_push` with `repush: true`.

The tool will update each existing test case (by ADO ID) with the revised content. **Repush is a full-field update** — title, prerequisites, steps, and priority are all rewritten from the draft. No per-field selection. **Formatting (tables, bold, lists) is applied every time.**

> **Note on prior behavior:** pre-Phase-A, typing **YES** was enough and the agent inferred `repush: true` from the draft state. Today the consent gate makes the repush intent a separate explicit pick, so the agent won't silently PATCH ADO based on an ambiguous "sure" or "yes".

## Option B — Delete & Re-create

Use when test cases were created in the wrong suite, or you need structural changes.

### Steps

1. **Restart Cursor** (or reload MCP).
2. **Delete** the existing test cases in ADO (use `qa_tc_delete` or `/vortex-ado/qa-tc-delete` — accepts single ID or a comma-separated list).
3. **Set draft status to DRAFT** in the markdown header.
4. **Remove ADO IDs** from TC titles (e.g. remove `(ADO #12345)`).
5. Run **`/vortex-ado/qa-publish`** and confirm with **YES**.

## Option C — Mapping recovery (since Phase B)

Use when ADO already has the test cases for this User Story, but your local draft has lost (or never had) the `(ADO #N)` suffixes in its TC titles. Typical triggers: the draft was regenerated from `ado_story`, the draft was copied from another workspace, or a reviewer hand-edited the titles and stripped the IDs. Instead of deleting and re-creating (Option B), Phase B's `attemptMapping` path recovers the ID-to-draft link by matching on the TC number, which is always encoded in the title (`TC_<usid>_<nn>`).

### Steps

1. **Restart Cursor** (or reload MCP).
2. **Make sure the draft is APPROVED** in the header but has **no** `(ADO #N)` suffixes on TC titles. (If the draft is DRAFT, Phase A's `draft-status-draft` gate fires first — reply YES to approve + push, then the mapping flow triggers.)
3. Run **`/vortex-ado/qa-publish`**.
4. `qa_publish_push` returns the **`existing-tcs-unmapped`** structured response (⚠️ WARN, `isError: true`) offering three options:
   - **A.** Attempt mapping by TC number.
   - **B.** Create new alongside (duplicate path, uses `insertAnyway: true`).
   - **C.** Cancel.
5. Reply **A**. The agent re-runs with `attemptMapping: true`. The tool pulls the linked TCs from ADO, parses the `TC_<usid>_<nn>` portion of each title, and matches against the draft's TC numbers.
6. The tool returns **`mapping-preview`** (ℹ️ INFO, `isError: true`) — a table showing each draft row with its matched ADO ID. **No ADO writes have happened yet.** Example:

   ```
   tcNumber  adoId     title
   01        1386085   TC_12345_01 -> ... -> Verify ...
   02        1386086   TC_12345_02 -> ... -> Verify ...
   03        1386087   TC_12345_03 -> ... -> Verify ...
   ```

7. Review the table. If it looks right, reply **YES**. The agent re-runs with `acknowledgeMapping: true` AND `userConfirmedMapping: [{tcNumber: 1, adoId: 1386085}, …]` — the full table is echoed back as the confirmation payload so the tool can defensively re-verify it matches current state (`mapping-drift` fires if the draft mutated between preview and confirm — just re-run `attemptMapping: true` and re-confirm).
8. The tool updates each matched TC in ADO with the revised draft content. `repush: true` is **not required** — the consent-gated YES on `mapping-preview` is the authorization.

### When mapping isn't possible

- **`tc-number-mismatch` (🚫 BLOCK)** — ADO's linked TCs use TC numbers your draft doesn't have (e.g. ADO has `_05` / `_06` but draft has `_01` / `_02`). Fall back to **A.** cancel + fix draft, or **B.** `insertAnyway: true`.
- **`extras-in-ado` (ℹ️ INFO)** — after mapping, ADO has more TCs linked to this US than the draft (draft ⊂ ADO, scenario 5). The extras are **left alone** — the tool never deletes orphans. Reply **YES** to update only the TCs the draft covers (re-runs with `acknowledgeExtras: true`). If you actually want the extras gone, use `qa_tc_delete` explicitly.
- **`draft-ids-not-linked` (⚠️ WARN)** — related gate: your draft DID have `(ADO #N)` suffixes but one or more don't point at TCs linked to this US. Resolve via **A.** `proceedWithUnlinkedIds: true` (risky — only if you're sure the IDs are correct and the link is just missing) or **B.** cancel + fix the draft.

### When to pick Option C vs. Option A

| Situation | Use |
|---|---|
| Draft has `(ADO #N)` IDs + you just revised content | **Option A — Repush** |
| Draft has NO IDs but ADO has the TCs (draft was regenerated / copied) | **Option C — Mapping** |
| Draft has NO IDs AND you want to delete + re-create | **Option B — Delete & Re-create** |
| Draft has some IDs + some new TCs | Phase B's `mixed-update-create` gate handles this in one push |

## Duplicate-TC preflight (since 2026-05-03)

> **Superseded by Phase B.** The A/B/C "existing-tcs-detected" response described below has been replaced by the `existing-tcs-unmapped` structured response (see **Option C — Mapping recovery** above), which offers a third option — **A.** attempt mapping by TC number — before falling back to **B.** (`insertAnyway: true`) or **C.** (cancel). The "inspect first" investigative path from the old flow is no longer a tool-level option; the user can still reach `qa_tests` + `qa_tc_read` manually at any point. This section is kept for historical reference.

`qa_publish_push` now runs a counts-based preflight before creating new test cases. If the User Story already has test cases linked via `TestedBy`, and the draft has no ADO IDs, the push aborts and you'll see a message like:

```
## US 12345 — existing test cases detected

ADO already has **4 test case(s)** linked to this User Story, but your
local draft has no ADO IDs for them.

Publishing now will **CREATE 3 new test case(s) alongside the existing 4** —
if they cover the same scenarios, you'll end up with duplicates.

Reply with a letter:
  A. Proceed — create 3 new TCs alongside the existing ones (insertAnyway: true).
  B. Inspect first — run qa_tests + qa_tc_read
     to see titles/steps before deciding.
  C. Cancel — do nothing.
```

No titles or steps are dumped in this preflight — that's deliberate. Investigation goes through the dedicated tools (`qa_tests` → `qa_tc_read`) on demand via option **B**.

Three ways forward:

| You want to… | Reply | What happens |
|---|---|---|
| **Update** those existing TCs with revised content | (not via preflight) | Exit preflight via **C**, then follow Option A (Repush) above: add ADO IDs to draft + `repush: true`. Preferred. |
| **Delete and re-create** | (not via preflight) | Exit preflight via **C**, then follow Option B above. Use when structural changes needed. |
| **Add new TCs alongside existing** (rare) | **A** | Agent calls push again with `insertAnyway: true`. Creates duplicates in ADO if the existing TCs cover the same scenarios — use with caution. |
| **I don't know what's already there** | **B** | Agent calls `qa_tests`, then `qa_tc_read` per ID, shows titles/steps, then re-asks you A / C / Repush. |
| **Abort** | **C** | No changes. |

### When the preflight fails to reach ADO

If the relations check itself errors (timeout, 500, network blip), the tool surfaces the error and asks you to either cancel or, if you're confident no TCs exist on the US, retry with `insertAnyway: true`. It never silently proceeds past a failed check.
