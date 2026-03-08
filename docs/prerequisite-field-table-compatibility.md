# Prerequisite for Test — Table Compatibility & Future Format

## 1. Field Compatibility

| Aspect | Details |
|--------|---------|
| **Field** | `Custom.PrerequisiteforTest` (or `prerequisiteFieldRef` from config) |
| **Field type** | Must be **HTML** in ADO Process (Organization Settings → Process → Fields) |
| **Table support** | Yes. When the field is HTML, it supports standard HTML tags including `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`. |
| **Verification** | Open a work item, edit the field — if you see a rich text toolbar (bold, lists, etc.), HTML is supported. Tables render when the field type is HTML. |

**Note:** If the field is Plain Text, tables and other HTML will display as raw markup. Change the field to HTML in Process customization.

---

## 2. Current tc_draft Format (Lists)

The MCP currently renders Pre-requisite and TO BE TESTED FOR as **numbered/bulleted lists** (`<ol>`, `<ul>`).

### tc_draft JSON structure (current)

```json
{
  "commonPrerequisites": {
    "preConditions": ["Condition 1", "Condition 2", "Condition 3"],
    "toBeTested": ["Validation 1", "Validation 2"],
    "testData": "N/A"
  },
  "testCases": [
    {
      "tcNumber": 1,
      "prerequisites": {
        "preConditions": ["TC-specific condition"],
        "toBeTested": null,
        "testData": null
      }
    }
  ]
}
```

- **preConditions:** `string[]` — each string becomes one `<li>` in an `<ol>`
- **toBeTested:** `string[]` — each string becomes one `<li>` in a `<ul>`
- **testData:** `string` — single value

---

## 3. Future Table Support — tc_draft Format to Maintain

If tables are needed later, the tc_draft JSON can support them without breaking the current format.

### Option A: Add optional table structure (backward compatible)

```json
{
  "commonPrerequisites": {
    "preConditions": ["Condition 1", "Condition 2"],
    "preConditionsTable": [
      { "col1": "#", "col2": "Condition" },
      { "col1": "1", "col2": "Condition 1" },
      { "col1": "2", "col2": "Condition 2" }
    ],
    "toBeTested": ["Validation 1"],
    "toBeTestedTable": null,
    "testData": "N/A"
  }
}
```

- When `preConditionsTable` or `toBeTestedTable` is present and non-empty, render as `<table>`.
- When absent, fall back to `preConditions` / `toBeTested` as lists (current behavior).

### Option B: Use existing arrays with header hint

```json
{
  "commonPrerequisites": {
    "preConditions": ["Condition 1", "Condition 2"],
    "preConditionsAsTable": true,
    "toBeTested": ["Validation 1"],
    "toBeTestedAsTable": false
  }
}
```

- `preConditionsAsTable: true` → render `preConditions` as a table with columns `#` and `Condition`.
- Keeps the same array structure; only the render mode changes.

### Markdown draft format (for tables)

The draft markdown already uses tables:

```markdown
### Pre-requisite

| # | Condition |
|---|---|
| 1 | Condition 1 |
| 2 | Condition 2 |
```

The parser extracts the second column into `preConditions: ["Condition 1", "Condition 2"]`. To support tables in the future, the parser could either:
- Pass a `renderAsTable` flag when the source is a markdown table, or
- Preserve the full table structure (e.g. `preConditionsRows: [{ num: 1, condition: "..." }]`) for table rendering.

---

## 4. Summary

| Item | Status |
|------|--------|
| **ADO field table support** | Yes, when field type is HTML |
| **Current MCP output** | Lists (`<ol>`, `<ul>`) |
| **Future table format** | Use `preConditionsTable` / `toBeTestedTable` or `*AsTable` flags; keep current arrays as fallback |
| **tc_draft JSON** | Keep `preConditions: string[]` and `toBeTested: string[]`; add optional table fields when needed |
