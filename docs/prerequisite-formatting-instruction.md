# Prerequisite for Test Field – Formatting Instruction

**Reference:** [Azure DevOps Markdown Syntax](https://learn.microsoft.com/en-us/azure/devops/project/wiki/markdown-guidance?view=azure-devops)

This document defines how to format the **Prerequisite for Test** (`Custom.PrerequisiteforTest`) field in ADO test cases.

## 1. Field Requirements

| Requirement | Details |
|-------------|---------|
| **Field type** | Must be **HTML** in ADO Process. Plain Text fields will not render formatting. |
| **Where it renders** | Work item form (full edit view). Grid/list views may show plain text. |

## 2. Supported HTML Tags (ADO Work Item Fields)

| Tag | Use |
|-----|-----|
| `<div>` | Section blocks |
| `<strong>` | Bold labels (prefer over `<b>`) |
| `<ul>`, `<ol>`, `<li>` | Lists |
| `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>` | Tables (supported when field is HTML; see `docs/prerequisite-field-table-compatibility.md`) |
| `<br/>` or `<br>` | Line breaks |

## 3. Prerequisite for Test Structure (Current: Lists)

- **Persona:** `<div><strong>Persona:</strong> </div><ul><li>Label<ul><li>{personaRolesLabel} = x</li><li>Profile = y</li><li>{personaPsgLabel} = z</li></ul></li></ul>` — `{personaRolesLabel}` and `{personaPsgLabel}` are placeholders for the labels configured under `prerequisiteDefaults` (defaults: `Roles`, `Permission Set Group`; this project overrides to `TPM Roles`, `PSG`).
- **Pre-requisite:** `<div><strong>Pre-requisite:</strong> </div><ol><li>...</li></ol>`
- **TO BE TESTED FOR:** `<div><strong>TO BE TESTED FOR:</strong> </div><ul><li>...</li></ul>`
- **Test Data:** `<div><strong>Test Data:</strong> </div><div>N/A</div>`

Use `<br>` (not `<br/>`) for line breaks. Space after colon in section labels.

## 4. HTML Escaping Rules

| Character | Replacement |
|-----------|-------------|
| `&` | `&amp;` |
| `<` | `&lt;` |
| `>` | `&gt;` |
| `"` | `&quot;` |

## 5. MCP Implementation

`buildPrerequisitesHtml` uses `<div>`, `<strong>`, `<ol>`, `<ul>`, `<li>` and applies `formatContentForHtml()` to all user-provided strings. This:

- Escapes HTML (`&`, `<`, `>`, `"`) for security
- Converts markdown `**bold**` to `<strong>bold</strong>` so draft content renders correctly in ADO
- Converts newlines to `<br>` for multi-line content
- Converts list patterns: "A. X B. Y" → `<ol><li>`, "- X<br>- Y" → `<ul><li>`
- **Persona** section: each persona has nested sub-bullets for `personaRolesLabel` (default `Roles`), Profile, and `personaPsgLabel` (default `Permission Set Group`)
- **TO BE TESTED FOR / Pre-requisite:** Rendered as lists (`<ol>` for Pre-requisite, `<ul>` for TO BE TESTED FOR). Items are split on " • " or "; " only when outside parentheses. For table compatibility and future format, see `docs/prerequisite-field-table-compatibility.md`.

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Raw HTML visible | Field is Plain Text | Change field type to HTML in Process |
| No formatting | Viewing in grid/list | Open work item in full form |
| Special chars broken | Missing escaping | Apply escapeHtml to all text |
