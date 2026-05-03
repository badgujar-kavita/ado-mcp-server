# ADO Test Case Update Guide

Short guide for updating test case prerequisites and TO BE TESTED FOR content in Azure DevOps.

---

## Updating Prerequisites

### Structured vs Raw HTML

- **Always use structured prerequisites** when calling `qa_tc_update`.
- Pass `{ personas?, preConditions, testData }` — the MCP server converts this to ADO-compatible HTML via `buildPrerequisitesHtml()`.
- **Do not** pass raw HTML from `qa_tc_read`; parsing it back is error-prone.

### Source of Truth

- Source structured data from the draft (`tc-drafts/US_*_test_cases.md` or `.json`), not from ADO HTML.

---

## TO BE TESTED FOR — Executor-Friendly Format

- **Self-contained:** QA must understand without reading the solution design.
- **No Flow references:** Use plain descriptions (e.g., "Rate change → Pending Reapproval"), not "Flow 1", "Flow 2".
- **Short:** Avoid repeating test steps.
- **Headings:** Use "Validation:" with sub-points A, B when grouping related items.

---

## When to Restart MCP and Rebuild

- **Restart MCP** after changes to `buildPrerequisitesHtml` or related formatting logic in `src/helpers/`.
- **Run `npm run build:dist`** after any MCP tool, prompt, or convention changes to rebuild `dist-package/`. Distribution to end users is handled automatically by the Vercel tarball pipeline (`scripts/build-website.sh` rebuilds the tarball on every Vercel deploy).

---

## Reference

For full implementation details, see `prompt-implement-deploy-and-main-project-changes.md` (if present) or the main setup and implementation docs.
