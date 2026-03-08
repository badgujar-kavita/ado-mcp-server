---
name: update-test-case-prerequisites
description: Guide AI when updating test case prerequisites in ADO. Use when running update_test_case, pushing prerequisites to ADO, or fixing prerequisite formatting.
---

# Update Test Case Prerequisites

Guide AI when updating test case prerequisites in Azure DevOps via `update_test_case` or related tools.

---

## Rules

1. **Always pass structured prerequisites** — Pass the structured prerequisites object to `update_test_case`, never raw HTML. The MCP server uses `buildPrerequisitesHtml()` to convert it to ADO-compatible HTML.

2. **Structure** — Use `{ personas?, preConditions, toBeTested, testData }`:
   - `personas` — Optional; use defaults from `conventions.config.json` (prerequisiteDefaults.personas) unless override needed
   - `preConditions` — Array of strings (Object.Field = Value format)
   - `toBeTested` — Array of strings (executor-friendly; see to-be-tested-for-executor-friendly skill)
   - `testData` — String or "N/A"

3. **Source from draft** — Use structured data from the draft (e.g., `tc-drafts/US_*_test_cases.md` or `.json`), not from `get_test_case` HTML. The HTML in ADO is already rendered; parsing it back is error-prone.

4. **Restart MCP after formatting changes** — If you change `buildPrerequisitesHtml` or related formatting logic in `src/helpers/`, restart the MCP server so the updated logic is loaded.

---

## Example

```json
{
  "prerequisites": {
    "personas": null,
    "preConditions": [
      "Promotion.Status = Adjusted",
      "Tactic.Planned_Dollar_Per_Case__c != NULL"
    ],
    "toBeTested": [
      "Rate change → Pending Reapproval (auto)",
      "No rate change → stays Adjusted"
    ],
    "testData": "N/A"
  }
}
```

---

## When to Use

- When running `update_test_case`
- When pushing prerequisites to ADO
- When fixing prerequisite formatting issues
