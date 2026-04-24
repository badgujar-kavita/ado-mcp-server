# ADO Test Case Update Guide

Short guide for updating test case prerequisites and TO BE TESTED FOR content in Azure DevOps.

---

## Updating Prerequisites

### Structured vs Raw HTML

- **Always use structured prerequisites** when calling `update_test_case`.
- Pass `{ personas?, preConditions, testData }` — the MCP server converts this to ADO-compatible HTML via `buildPrerequisitesHtml()`.
- **Do not** pass raw HTML from `get_test_case`; parsing it back is error-prone.

### Source of Truth

- Source structured data from the draft (`tc-drafts/US_*_test_cases.md` or `.json`), not from ADO HTML.

---

## TO BE TESTED FOR — Executor-Friendly Format

- **Self-contained:** QA must understand without reading the solution design.
- **No Flow references:** Use plain descriptions (e.g., "Rate change → Pending Reapproval"), not "Flow 1", "Flow 2".
- **Short:** Avoid repeating test steps.
- **Headings:** Use "Validation:" with sub-points A, B when grouping related items.

---

## When to Restart MCP and Deploy

- **Restart MCP** after changes to `buildPrerequisitesHtml` or related formatting logic in `src/helpers/`.
- **Run `npm run deploy`** after any MCP tool, prompt, or convention changes so updates are available in the shared workspace.

---

## Reference

For full implementation details, see `prompt-implement-deploy-and-main-project-changes.md` (if present) or the main setup and implementation docs.
