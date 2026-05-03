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

## Duplicate-TC guard (since 2026-05-03)

`push_tc_draft_to_ado` now checks ADO before creating new test cases. If the User Story already has test cases linked via `TestedBy`, and the draft has no ADO IDs, the push is aborted with a listing of the existing TCs and you'll see a message like:

```
US 12345 already has 4 test case(s) linked in ADO:

  - ADO #67890 [Design] TC_12345_01 — Verify user can log in with valid credentials
  - ADO #67891 [Design] TC_12345_02 — Verify lockout after 3 failed attempts
  ...
```

Three ways forward:

| You want to… | Use | Notes |
|---|---|---|
| **Update** those existing TCs with revised content | Option A (Repush) above | Requires ADO IDs in draft + `repush: true`. Preferred. |
| **Delete and re-create** | Option B above | Use when you need structural changes or the existing TCs were wrong. |
| **Add new TCs alongside existing** (rare) | Call with `insertAnyway: true` | Only after the user sees the listing and explicitly confirms. Creates duplicates in ADO if the existing TCs cover the same scenarios — use with caution. |
