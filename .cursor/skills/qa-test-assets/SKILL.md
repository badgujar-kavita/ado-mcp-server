---
name: qa-test-assets
description: Organize test case assets per user story with dedicated folders, separate files for test cases, solution design summary, and QA cheat sheet. Use when drafting test cases, creating test case folders, or organizing QA documentation for a User Story.
---

# Test Case Asset Manager

Organize and manage test case documentation assets for User Stories with a consistent folder structure.

**When to Use:**
- Drafting test cases for a new User Story
- Creating supporting documentation (solution design summary, QA cheat sheet)
- Organizing existing test case drafts into the standard structure

---

## Folder Structure

### Location
All US folders go inside `tc-drafts/` in the workspace root:
```
tc-drafts/
└── US_<ID>/
    ├── US_<ID>_test_cases.md
    ├── US_<ID>_solution_design_summary.md
    └── US_<ID>_qa_cheat_sheet.md
```

### Naming Conventions

**Folder:**
- `US_<ID>` — preferred (e.g., `US_1399001`)
- `US_<ID>_<short_title_slug>` — optional when disambiguation needed (e.g., `US_1399001_product_category_access`)

**Files:**
- `US_<ID>_test_cases.md` — main test case draft
- `US_<ID>_solution_design_summary.md` — solution design summary
- `US_<ID>_qa_cheat_sheet.md` — QA execution cheat sheet

---

## Optional: `attachments/` subfolder

When the `images.saveLocally: true` config flag is set in `conventions.config.json`, `ado_story` will persist any fetched ADO / Confluence images to disk. The folder layout is:

```
tc-drafts/
  US_<id>/
    US_<id>_test_cases.md
    US_<id>_solution_design_summary.md
    US_<id>_qa_cheat_sheet.md
    attachments/                      # only present when images.saveLocally is true
      ado/
        <guid>_<filename>             # e.g. 669274dd-06e9-47fe-b83a-5b961c810503_diagram.png
      confluence/
        <pageId>/
          <filename>                  # e.g. 7084278127/wireframe-v2.png
```

When absent (default), images are referenced only via `originalUrl` links that require auth to resolve. When present, reviewers can open the draft markdown offline and see the images inline.

---

## File Rules

### Main Test Cases File

**Purpose:** Primary draft containing test cases ready for ADO push.

**Structure:**
1. Title and metadata block
2. **Supporting Documents links** (immediately after metadata)
3. Functionality Process Flow
4. Common Prerequisites
5. Test Data
6. Test Cases
7. Review Notes (optional)

**Link Placement:**
```markdown
## Supporting Documents
- Solution Design Summary: [Open](./US_<ID>_solution_design_summary.md)
- QA Cheat Sheet: [Open](./US_<ID>_qa_cheat_sheet.md)
```

**Rules:**

- Do NOT embed full solution design or cheat sheet content
- Keep focused on test cases
- Use relative paths for links
- Update links in place (do not duplicate)

### Solution Design Summary File

**Purpose:** Concise reference for business logic and configurations.

**Must Include:**

- US ID and title
- Scope note (if partial coverage)
- Business goal (1-2 sentences)
- Core process/access/visibility logic
- Supported functional areas
- New custom fields and configurations (table format)
- Setup prerequisites (compact table: Component → Required State)
- Recalculation/refresh triggers (where relevant)

**Rules:**

- Keep concise and reusable
- Section 6 (Setup Prerequisites): Use compact table format. Max 10 rows. No exact formulas/error messages.
- Use condition-based format for configurations (Object.Field = Value)
- Do not include implementation details or code

### QA Cheat Sheet File

**Purpose:** Quick execution aid for QA testers. Must be scannable in 30-60 seconds.

**Target:** 40-60 lines max (not 80-100+)

**Format Priority:** Tables > Prose. Maps > Paragraphs. One-liners > Explanations.

**Must Include:**

1. **Decision Logic table** — Use Case | Config/Fields | Conditions | Expected Outcome (one row per test scenario)
2. **Quick Maps** (if applicable) — Field mappings, category sources, value translations
3. **Setup Checklist** — Max 5 items, no nested bullets, no exact formulas
4. **Debug Order** — Single numbered list, max 6 steps
5. **Regression Triggers** — Change → TCs table
6. **Role Notes** — Role → Key reminders (short bullets)
7. **Memory Aid** — One-liner rule of thumb

**Anti-Patterns (DO NOT include):**

- ❌ Separate "Positive Validations" and "Negative Validations" sections (merge into Decision Logic table)
- ❌ Exact formulas, full error messages, API names in setup (those belong in test cases)
- ❌ Nested checklists or multi-paragraph explanations
- ❌ Multiple debug sections (consolidate into one)
- ❌ Prose descriptions when a table works better

**Rules:**

- Keep compact and scannable
- Use tables for conditional logic (not if/then bullet lists)
- Decision Logic table replaces separate positive/negative sections
- Self-contained (no external references needed during execution)

---

## Accuracy Rules

1. **Source Material Only:** Use only supported sources:
  - User Story / Acceptance Criteria
  - Confluence Solution Design
  - Approved documentation
  - Supporting files provided by user (images, Excel, Google Sheets, CSV, PDF, etc.)
  - Explicit user clarification
2. **No Invention:** Do not invent:
  - Requirements
  - Scope
  - Logic
  - Conditions
  - Assumptions
3. **Partial Coverage:** If source only supports part of the story scope, state that clearly in the supporting documents.
4. **Terminology Conflicts:** Prefer the latest explicit user clarification.
5. **Story-Specific:** Keep prompts generic to the current US. Do not reuse story-specific assumptions from previous work.

---

## Prerequisite Writing Standard

**MANDATORY:** Prerequisites MUST always be written as condition-based setup statements using the patterns below. Every prerequisite in every test case, solution summary, and cheat sheet must follow this format.

**Required Patterns:**

| Pattern                                  | Example                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `<Object>.<Field> = <Value>`             | `Promotion.Status = Adjusted`, `CustomerManager.Access__c = Edit`      |
| `<Object>.<Field> != NULL`               | `Tactic.Planned_Rate__c != NULL`                                       |
| `<Object>.<Field> = TRUE/FALSE`          | `Template.TPM_Enable_LOA__c = TRUE`                                    |
| `<Object>.<Field> CONTAINS <Value>`      | `FieldSet.Fields CONTAINS Rate`                                        |
| `<Object>.<Field> IN (<Values>)`         | `User.Sales_Org IN (1111, 0404)`                                       |
| `<CustomLabel> = <Value>`                | `TPM_Error_Message = "Record not found"`                               |
| `<CustomMetadataType>.<Field> = <Value>` | `TPM_Setting.Enabled__c = TRUE`                                        |
| `<CustomSetting>.<Field> = <Value>`      | `TPM_Config__c.Max_Records__c = 100`                                   |

**Minimize vague phrasing (use only as last resort):**

When a condition genuinely cannot be expressed in the patterns above, fall back to minimal vague language such as `"Setup or configuration is required"`. Avoid the following over-generic forms:

- "Required configuration exists"
- "Conditions are met"
- "Appropriate setup in place"
- "System is ready for testing"
- "Prerequisites are in place"

Prefer specific condition-based wording whenever possible.

---

## Artifact Cleanliness Standards

All three artifacts (test cases, solution summary, cheat sheet) MUST be:

1. **Scannable** — QA should understand the content in under 2 minutes
2. **Consistent** — Same terminology, same prerequisite format across all three files
3. **Minimal** — No filler text, no redundant sections, no over-explanation
4. **Table-first** — Use tables for any conditional logic, mappings, or decision rules
5. **Technical-precise** — Use condition-based prerequisites; vague language only as a last resort
6. **Self-contained** — Each artifact stands alone but references the others appropriately

---

## Test Case Quality Standard

Each test case must have:

- Clear use case (what is being validated)
- Relevant prerequisites (condition-based)
- Unambiguous action (imperative, short)
- Precise expected result ("should" form)
- **Reuse confirmed logic** from the linked solution summary and QA cheat sheet

### Expected Result Formatting (Automation-Friendly)

**Core Rule:** When a single test step produces multiple validations or outcomes, format the Expected Result as a numbered list using automation-friendly patterns.

**Formatting (ADO Compatible & Automation-Ready):**
- Use plain numbering: `1.` `2.` `3.` for main points
- Use `1.1` `1.2` for sub-points (if needed)
- Each point on a new line
- NO bold, italics, or special formatting (ADO compatibility)
- Keep each line short, direct, and parseable

**When to Apply:**
Apply numbered formatting when Expected Result includes:
- Multiple fields to validate
- Multiple conditions
- Ordered rules / logic
- Multiple UI validations
- Combined outcomes (visibility + editability + data change)

**When NOT to Apply:**
- Only one simple outcome exists
- Do NOT merge multiple test steps into one just to create a list

**Automation-Friendly Pattern (MANDATORY):**

Use this structured format for maximum automation compatibility:

```
1. <Object>.<Field> should <operator> <Value>
2. <UI_Element> should be <state>
3. <Action> should <outcome>
4. <Message/Error> should [not] be displayed
```

**Writing Style Rules:**
- **Specific targets:** Name the object, field, or UI element explicitly
- **Clear operators:** Use `=`, `!=`, `CONTAINS`, `IN`, `>`, `<`
- **Measurable states:** `enabled`, `disabled`, `visible`, `hidden`, `displayed`
- **Deterministic outcomes:** `succeed`, `fail`, `be assigned`, `be updated`
- **Avoid vague language:** Never use "should work properly", "should be correct", "appropriate access", "as expected"

**Examples by Category:**

**1. Field Validation (API/Data validation):**
```
1. Promotion.Status__c should = Adjusted
2. Promotion.Approved_By__c should = [Current User]
3. Promotion.Approval_Date__c should = [Today's Date]
4. Tactic.Planned_Rate__c should != NULL
```
*Automation mapping: Direct field assertions*

**2. UI Element Validation (UI automation):**
```
1. Edit button should be visible
2. Save button should be enabled
3. Delete button should not be visible
4. Error banner should not be displayed
```
*Automation mapping: Element state checks*

**3. Ordered Logic/Rules (Rule engine testing):**
```
Rule Order 1: Case_Category__c = Technical → Technical Support Queue should be assigned
Rule Order 2: Case_Category__c = Billing → Billing Support Queue should be assigned
Rule Order 3: Case_Category__c = blank/other → Default Support Queue should be assigned
```
*Automation mapping: Conditional assertions*

**4. Access Control (Combined validation):**
```
1. CBP record should be visible in list view
2. Detail page should open successfully
3. Record.Access_Level__c should = Full Access
4. Edit action should be available
5. Save action should succeed
```
*Automation mapping: Multi-layer validation (list → detail → field → action)*

**5. Negative Test Cases (Error validation):**
```
1. Save action should fail
2. Error message should = "Required fields are missing: Name, Status"
3. Promotion.Status__c should = Draft (unchanged)
4. User should remain on edit page
```
*Automation mapping: Failure assertions + state verification*

**❌ Bad Examples (NOT automation-friendly):**
- "User should have appropriate access" (vague)
- "System should work correctly" (not measurable)
- "Fields should be updated properly" (no specific fields/values)
- "Should have read access" (ambiguous - what does "read" mean?)

**✅ Good Examples (Automation-friendly):**
- "Record.Access_Level__c should = Read Only"
- "Edit button should be disabled"
- "Record should be visible in list view"
- "Save action should succeed"

**Content Quality:** For test case content rules (coverage matrix, logic interpretation, step format), reference the [qa-test-drafting](../qa-test-drafting/SKILL.md) skill.

---

## Maintenance Rules

1. **Update Together:** When updating a US draft, update or validate linked summary and cheat-sheet files.
2. **Create Folder First:** If US folder doesn't exist, create it before adding files.
3. **Consistent Naming:** Keep naming consistent within the same folder.
4. **Version Control:** Update version number in metadata when making revisions.

---

## Final Validation Checklist

Before considering a US draft complete:

- All files belong to the same US
- Draft links point to correct files (relative paths)
- Test case draft is lightweight (no embedded large summaries)
- Prerequisites use condition-based wording
- Folder structure is clean and self-contained
- Solution design summary has all required sections
- QA cheat sheet is scannable and self-contained

---

## Templates

Use templates in `templates/` folder as starting points:

- [test_cases.template.md](./templates/test_cases.template.md)
- [solution_summary.template.md](./templates/solution_summary.template.md)
- [qa_cheat_sheet.template.md](./templates/qa_cheat_sheet.template.md)
- [cheat_sheet_review_guide.md](./templates/cheat_sheet_review_guide.md)

---

## Using Examples (Learning Patterns)

Examples in this plan document are **learning patterns**, not copy-paste content.

**Learn from examples:**
- Structure and section organization
- Condition-based wording patterns
- Decision table formatting
- How to identify regression triggers
- How to separate setup from scenario variables

**Never copy verbatim:**
- Domain-specific field names
- Project-specific business logic
- User Story-specific assumptions
- Sample test data values

**Key insight:** Each user's documents are generated fresh from their own User Story context and source material.

---

## Regression Test Case Preparation

When asked to prepare regression test cases:

1. **Start with Solution Summary Section 8** (Risk Areas and Regression Triggers)
   - Identify what changed
   - Map change to risk areas

2. **Use Cheat Sheet Regression Triggers**
   - Find impacted scenarios per trigger
   - Generate test cases for each impacted scenario

3. **Use Decision Table for Combinations**
   - Identify which condition columns are affected
   - Generate test cases for affected combinations

4. **Cross-reference QA Impact section**
   - Include high-value combinations
   - Include risks easy to miss

5. **Output format:** Separate `US_<ID>_regression_tests.md` file in the same US folder
