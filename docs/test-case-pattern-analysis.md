# Test Case Writing Pattern Analysis — Generic Reference

**Source:** Generic, mock test cases modeled on a Salesforce CRM application (illustrative only — no real plan or work-item IDs)  
**Purpose:** Document observed test-case patterns so AI drafts match the team's house style. Use this as a structural reference; substitute real project entities, fields, and personas from the active project's Acceptance Criteria, Solution Design, and `conventions.config.json`.

> **About the examples:** Every USID, TC ID, account name, persona, status value, and field name in this document is fictional. They demonstrate the *shape* of titles, prerequisites, and steps — not real data. Treat them the way you'd treat sample data in API documentation.

---

## 1. Title Format Patterns

### Observed Structure

| Pattern | Example |
|---------|---------|
| **TC_USID_## -> Area -> Sub-area -> Persona -> Verify {validation}** | `TC_9000123_06 -> Order Management -> Mass Status Update -> Business Persona -> Order -> Verify the "Audit History" is updated with new entry after successful status update via 'Order Mass Status Update' functionality` |
| **TC_USID_## -> Area -> Sub-area -> Tab/Context -> Persona -> Verify {validation}** | `TC_9000123_05 -> Order Management -> Mass Status Update -> 'Order Mass Status Update' Tab -> Business Persona -> Verify 'Next Status' is disabled or empty when filtered orders have different valid statuses` |
| **TC_USID_## -> Area -> Sub-area -> As Persona, Verify {validation}** | `TC_9000456_01 -> Order/Quote Management -> Permission Optimization -> As Administrator, Verify that user is able to create and view the orders/quotes` |
| **TC_USID_## -> Area -> Sub-area -> Verify {validation}** | `TC_9000789_02 -> Order Management -> Order Workspace -> Orders -> History/ Legacy Data -> Verify the 'Condition Generation' value for History Data` |
| **TC_USID_## -> Condition -> Area -> Tab -> Persona -> Verify {validation}** | `TC_9000234_05 -> Audit Log Setting = True -> Account Business Plan -> KPI Tab -> Business Persona -> Verify item with actuals outside the configured retention window` |
| **TC_USID_## -> Area -> Hierarchy context -> Verify {validation}** | `TC_9000567_04 -> Order Management -> Multi Level Sub Accounts -> "L2 (Region)>L1 (No Attribute)>L0 (Sold To Account)"-> Orders/Order Planning -> Validate that L1 Level Sub Account does not show up in Account Search on New Order Wizard` |

### Title Conventions

- **Separator:** ` -> ` (space-hyphen-greater-space)
- **Persona placement:** Can be before "Verify" or after "As"
- **Quotes:** Use single quotes for UI elements: `'Order Mass Status Update' Tab`, `'Next Status'`
- **Outdated marker:** `[OUTDATED] || TC_...` prefix when TC is obsolete
- **Character limit:** ADO 256 chars — titles are often long; keep under limit

---

## 2. Prerequisites (Custom.PrerequisiteforTest) Structure

### Persona Section

```
Persona:
1. "Admin Persona" User
   - Roles = Admin
   - Profile = Standard_Admin_Profile
   - Group = Admin User Group
2. "Business Persona" User
   - Roles = Business User
   - Profile = Standard_Business_Profile
   - Group = Business User Group
```

> The labels above (`Admin Persona`, `Business Persona`, `Standard_Admin_Profile`, `Group`) are placeholders. Real projects supply the persona names, profile names, and group/permission-set label via `conventions.config.json` (see the `personas` block and the `personaRolesLabel` setting). The fourth line in each persona block (`Group = ...` here) is whatever the project uses to scope record-level access — it could be a Permission Set Group, a Permission Set, a Public Group, a Role, or any equivalent grouping construct.

**Variations observed:**
- `<TeamPrefix> "Admin Persona" User` (some TCs prefix the persona label with a short team / cloud code)
- `"Admin Persona" User` (most common — no prefix)
- System Administrator not always listed (only when setup/config is involved)

### Pre-requisite Section

- **Format:** `Object.Field = Value` or `Object.Field != NULL`
- **Highlighting:** Important configs use `<span style="color:rgb(222, 106, 25);">` (orange) or `<b>`
- **Examples (showing the four common shapes):**
  - Simple equality — `User.Department = Sales`
  - Null check — `Workflows.ApprovalStep.Required_Roles__c != NULL`
  - Boolean checkbox config — `Workflows.ApprovalStep.Auto_Advance checkbox is set to = TRUE`
  - Multi-config combo on one line — `Feature.Enable_Audit_Log = TRUE`, `Feature.Retention_Period = 12 Months`

> The object names, field names, and values above are illustrative. Real prerequisites should reference the actual API field names and configuration toggles named in the active US's Acceptance Criteria and Solution Design.

### Test Data Section

- Often embedded in Pre-requisite or as separate `TEST DATA:` block
- **Format:** `Account = <Sample Account Name>`, `Order.Status = <Status Value>`, `Order Type = <Type Value>` — e.g. `Account = ACME CORPORATION - WEST REGION`, `Order.Status = Draft`, `Order Type = Standard`
- **Use case examples:** `USE CASE 1: <one-line scenario description>` — e.g. `USE CASE 1: Order created on Dec 30, 2024, is visible in the Year 2026 Account Business Plan`

---

## 3. Steps Format

### Action (Imperative)

| Action Type | Examples |
|-------------|----------|
| Login | `Login as Business Persona User` / `Login to Salesforce as Business Persona user` / `Login to Salesforce as a Business Persona User` |
| Navigate | `In Order Management App` / `Go to 'Order Mass Status Update' Tab` |
| Apply filter | `In Filter, Apply filter to search DRAFT Orders/Quotes` |
| Select/Click | `Tick the checkbox next to any Single Order/Quote` / `Click 'Apply' Action` |
| Verify | `Verify that 'Next Status' shows only two values i.e. Submitted and Cancelled` |

### Test Data in Steps

- **Inline:** `Test Data: Search Criteria 1. Account = ACME CORPORATION - WEST REGION 2. Order.Status = Draft 3. Order Type = Standard`
- **Bold labels:** `Test Data:`, `Test Data: Search Criteria`
- **Step references:** `Repeat Steps #4-13` for iterative flows

### Expected Results

- **Standard for simple actions:** `you should be able to do so` / `You should be able to do so`
- **Validation steps:** Specific, multi-part with "should"
  - `1. A new status update entry should be created in Audit History Tab... 2. Following details should be visible: Status update From to To, Comment, Reviewer Details, Date`
- **"Should" form:** Consistently used (matches style guide)

---

## 4. Persona Usage

| Persona | When Used |
|---------|-----------|
| **Business Persona** | Day-to-day business flows (Order creation, Mass Status Update, Account/Business Plan, line-item planning) |
| **Admin Persona** | User setup, workflow config, Permission Set setup |
| **System Administrator** | Setup/config TCs (e.g., Order Template, Quote Template) |

> Persona labels above are placeholders. Replace with the configured roles for the active project (see `conventions.config.json` → `personas`).

---

## 5. Common Test Data Values (Mock)

- **Account:** `ACME CORPORATION - WEST REGION`
- **Sales Org:** `1000`
- **Order Status:** `Draft`, `Submitted`, `In Review`, `Approved`, `Committed`, `Cancelled`
- **Order Type:** `Standard`
- **Account Hierarchy Level:** `Planning Account`, `L5`, `Sub Account`

> These are illustrative only — pull real values from the active US's Acceptance Criteria and Solution Design.

---

## 6. Gaps vs. Current Style Guide

| Aspect | Style Guide | Observed in ADO |
|--------|-------------|-----------------|
| **Title** | `TC_{USID}_{##} -> {Feature} -> [Sub-context] -> {Validation Type} -> Verify that {Persona} {validation}` | Persona sometimes in middle; "As {Persona}" variant; hierarchy in quotes |
| **Persona** | System Administrator + ADMIN + Standard User (all three) | Often only ADMIN + Standard User; System Admin when setup needed |
| **Expected** | "should" form | Consistent |
| **Steps** | Imperative | Consistent |
| **Prerequisite** | Object.Field = Value | Consistent; Test Data often inline |

---

## 7. Suggestions for AI Draft Improvements

### Title

1. **Support hierarchy in title:** When testing hierarchy (e.g., L2>L1>L0), include quoted hierarchy in title.
2. **Support "As Persona" variant:** `As Administrator, Verify that...` is valid.
3. **Tab/UI context:** Include specific tab or UI context (e.g., `'Order Mass Status Update' Tab`) when relevant.

### Prerequisites

1. **Test Data block:** Add optional `TEST DATA:` or `Test Data:` section when scenario has specific data (Account, Status, etc.).
2. **Highlight critical config:** Use bold or emphasis for config that varies between scenarios (e.g., Auto_Advance = TRUE vs FALSE).

### Steps

1. **Inline Test Data:** When a step has search/filter criteria, include `Test Data: 1. X 2. Y 3. Z` in the action.
2. **Step references:** Support `Repeat Steps #N-M` for iterative flows (e.g., testing multiple status transitions).
3. **FYI in expected:** Allow `FYI, Check the Pre-requisite mentioned above section` or similar when referencing prereqs.

### Commands

1. **qa_draft:** Ensure generated titles follow observed patterns (hierarchy, "As Persona", tab context).
2. **qa_publish:** Validate title length (≤256) before push.
3. **qa_tc_update:** When updating prerequisites, preserve Persona + Pre-requisite + Test Data structure.

---

## 8. Summary Checklist for AI

When drafting test cases for any Salesforce-style application:

- [ ] **Title:** Use `TC_{USID}_{##} -> {Area} -> {Sub-context} -> [Persona/As Persona] -> Verify {validation}`; include hierarchy in quotes when relevant; ≤256 chars
- [ ] **Persona:** Admin Persona + Business Persona at minimum (use the configured names from `conventions.config.json` → `personas`); add System Administrator when setup/config TC
- [ ] **Pre-requisite:** Lead with the most-scoping condition for the scenario (e.g., `User.<ScopeField> = <Value>`); follow with `Object.Field = Value` rows; highlight config variations
- [ ] **Test Data:** Inline in steps when filter/search; or separate TEST DATA block in prerequisites
- [ ] **Steps:** Imperative; "you should be able to do so" for setup; "Verify" for validation; support "Repeat Steps #N-M"
- [ ] **Expected:** "should" form; multi-part numbered when needed
- [ ] **Common data:** Pull Account names, Sales Org, status values, and Order/Quote types from the active project's AC, Solution Design, and `conventions.config.json` — do not reuse the mock values in this document

---

## Appendix: How to Adapt This Reference to a Real Project

1. **Replace persona labels** (`Admin Persona`, `Business Persona`) with the personas in `conventions.config.json` → `personas`.
2. **Replace business object names** (`Order`, `Quote`, `Account Business Plan`) with the entities documented in the active US's AC and Solution Design.
3. **Replace status values** (`Draft`, `Submitted`, `Approved`) with the lifecycle states from the project's workflow definition.
4. **Replace mock account/org values** (`ACME CORPORATION`, `1000`) with the test data the team actually uses.
5. **Keep the structural patterns** (title separator, persona section format, "should" form, step numbering) — those are house style and apply across projects.
