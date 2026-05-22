---
name: qa-tc-prerequisites
description: Guide AI when updating test case prerequisites in ADO. Use when running qa_tc_update, pushing prerequisites to ADO, or fixing prerequisite formatting.
---

# Update Test Case Prerequisites

Guide AI when updating test case prerequisites in Azure DevOps via `qa_tc_update` or related tools.

---

## Rules

1. **Always pass structured prerequisites** — Pass the structured prerequisites object to `qa_tc_update`, never raw HTML. The MCP server uses `buildPrerequisitesHtml()` to convert it to ADO-compatible HTML.

2. **Structure** — Use `{ personas?, preConditions, preConditionsTable?, testData, testDataTable? }`:
   - `personas` — Optional; use defaults from `conventions.config.json` (prerequisiteDefaults.personas) unless override needed
   - `preConditions` — Array of strings (Object.Field = Value format)
   - `preConditionsTable` — Optional `{ headers, rows }`. Use when the prereq is a 3+ column table (e.g. `# | Component | Required State`). Renders as `<table>` in ADO.
   - `testData` — String or `"N/A"`. Single-line only.
   - `testDataTable` — Optional `{ headers, rows }`. **Strongly preferred** when Test Data has multiple rows (e.g. `| Data | Value |` with several entries). Renders as `<table>` in ADO. Do NOT pass a multi-line string with `\n` escape sequences in `testData` — pass the structured table instead.

3. **Source from draft** — Use structured data from the draft (e.g., `tc-drafts/US_*_test_cases.md` or `.json`), not from `qa_tc_read` HTML. The HTML in ADO is already rendered; parsing it back is error-prone.

4. **Restart MCP after formatting changes** — If you change `buildPrerequisitesHtml` or related formatting logic in `src/helpers/`, restart the MCP server so the updated logic is loaded.

---

## Example

```json
{
  "prerequisites": {
    "personas": null,
    "preConditions": [
      "Opportunity.StageName = Negotiation/Review",
      "Opportunity.Amount != NULL"
    ],
    "testData": "N/A"
  }
}
```

**Multi-row Test Data — use `testDataTable`:**

```json
{
  "prerequisites": {
    "preConditions": ["Case.Origin = Web"],
    "testDataTable": {
      "headers": ["Data", "Value"],
      "rows": [
        ["Support Email", "support@company.com"],
        ["Web Form URL", "/support/contact"],
        ["Test Customer Email", "test@test.com"]
      ]
    }
  }
}
```

This renders as a real `<table>` in ADO. Do NOT serialize the table as a string with `\n` escapes — that used to render as visible literal text.

---

## When to Use

- When running `qa_tc_update`
- When pushing prerequisites to ADO
- When fixing prerequisite formatting issues
