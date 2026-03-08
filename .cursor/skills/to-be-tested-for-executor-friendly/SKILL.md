---
name: to-be-tested-for-executor-friendly
description: Guide AI when writing the TO BE TESTED FOR section in test case drafts. Use when drafting test cases, editing TO BE TESTED FOR, or reviewing prerequisite content.
---

# TO BE TESTED FOR — Executor-Friendly Writing

Guide AI to write the **TO BE TESTED FOR** section so QA executors understand it without reading the solution design.

---

## Rules

1. **Self-contained** — TO BE TESTED FOR must be understandable on its own. QA should not need to open the Confluence solution design to interpret what to validate.

2. **No Flow references** — Do NOT use "Flow 1", "Flow 2", "Flow 3", "Flow 4". Use plain descriptions instead:
   - ❌ "Flow 1: Rate change triggers reapproval"
   - ✅ "Rate change → Pending Reapproval (auto)"

3. **Short** — Avoid repeating test steps. Summarize what is being validated, not how to execute.

4. **Use headings when grouping** — When multiple related validations apply, use headings like **Validation:** with sub-points A, B.

---

## Example Format

```markdown
**Validation:**
A. Rate change → Pending Reapproval (auto)
B. No rate change → stays Adjusted
```

Or in HTML-compatible format for drafts:

```
**Validation:**<br>A. Rate change → Pending Reapproval (auto)<br>B. No rate change → stays Adjusted
```

---

## When to Use

- When drafting test cases
- When editing or updating the TO BE TESTED FOR section
- When reviewing prerequisite content
