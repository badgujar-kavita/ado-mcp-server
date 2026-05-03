# Re-push Test Cases — Update or Delete & Re-create

When you need to re-push test cases (e.g. draft was revised), use one of these workflows.

## Option A — Repush (Update Existing) — Preferred

Use when you revised the draft and want to **update** existing test cases in ADO. Formatting is re-applied.

### Steps

1. **Restart Cursor** (or reload MCP) so the latest server is loaded.
2. **Edit the draft** (`tc-drafts/US_xxx_test_cases.md`) with your changes.
3. **Keep the draft as APPROVED** — the ADO IDs `(ADO #12345)` must remain in each TC title.
4. Run **`/ado-testforge/create_test_cases`** with Plan ID and User Story ID.
5. When asked to confirm, type **YES** and ensure the AI uses **`repush: true`** when calling `push_tc_draft_to_ado`.

The tool will update each existing test case (by ADO ID) with the revised content. **Formatting (tables, bold, lists) is applied every time.**

## Option B — Delete & Re-create

Use when test cases were created in the wrong suite, or you need structural changes.

### Steps

1. **Restart Cursor** (or reload MCP).
2. **Delete** the existing test cases in ADO (use `delete_test_case` or `delete_test_cases`).
3. **Set draft status to DRAFT** in the markdown header.
4. **Remove ADO IDs** from TC titles (e.g. remove `(ADO #12345)`).
5. Run **`/ado-testforge/create_test_cases`** and confirm with **YES**.

## Duplicate-TC preflight (since 2026-05-03)

`push_tc_draft_to_ado` now runs a counts-based preflight before creating new test cases. If the User Story already has test cases linked via `TestedBy`, and the draft has no ADO IDs, the push aborts and you'll see a message like:

```
## US 12345 — existing test cases detected

ADO already has **4 test case(s)** linked to this User Story, but your
local draft has no ADO IDs for them.

Publishing now will **CREATE 3 new test case(s) alongside the existing 4** —
if they cover the same scenarios, you'll end up with duplicates.

Reply with a letter:
  A. Proceed — create 3 new TCs alongside the existing ones (insertAnyway: true).
  B. Inspect first — run list_test_cases_linked_to_user_story + get_test_case
     to see titles/steps before deciding.
  C. Cancel — do nothing.
```

No titles or steps are dumped in this preflight — that's deliberate. Investigation goes through the dedicated tools (`list_test_cases_linked_to_user_story` → `get_test_case`) on demand via option **B**.

Three ways forward:

| You want to… | Reply | What happens |
|---|---|---|
| **Update** those existing TCs with revised content | (not via preflight) | Exit preflight via **C**, then follow Option A (Repush) above: add ADO IDs to draft + `repush: true`. Preferred. |
| **Delete and re-create** | (not via preflight) | Exit preflight via **C**, then follow Option B above. Use when structural changes needed. |
| **Add new TCs alongside existing** (rare) | **A** | Agent calls push again with `insertAnyway: true`. Creates duplicates in ADO if the existing TCs cover the same scenarios — use with caution. |
| **I don't know what's already there** | **B** | Agent calls `list_test_cases_linked_to_user_story`, then `get_test_case` per ID, shows titles/steps, then re-asks you A / C / Repush. |
| **Abort** | **C** | No changes. |

### When the preflight fails to reach ADO

If the relations check itself errors (timeout, 500, network blip), the tool surfaces the error and asks you to either cancel or, if you're confident no TCs exist on the US, retry with `insertAnyway: true`. It never silently proceeds past a failed check.
