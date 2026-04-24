# Test Case Writing Style Reference

**Source:** ADO test cases from US 1245456 (Fund Selection on Tactics) — Suites 1282528, 1282861  
**Purpose:** Use this as a style reference when AI drafts test cases. The methodology should stay implementation-generic; project-specific entities in this document are illustrative examples, not universal assumptions.

---

## 0. Project Context (Illustrative Example)

**Cloud:** Salesforce Consumer Goods Cloud — Trade Promotion Management (TPM) Application

**Primary User:** KAM / Key Account Manager
- Creates Promotions for Planning and Sub-Accounts Level
- Performs Tactic Planning on Promotions

**Tactic Payment Methods:**
- **OI** (Off Invoice)
- **Retro** (Retrospective)

**When drafting:** Derive business objects, scope dimensions, personas, and configuration labels from the active project's Acceptance Criteria, Solution Design, and configured conventions. Use TPM-specific concepts from this document only when they are explicitly relevant to the current project.

---

## 1. Prerequisites for Test (ADO Field: Custom.PrerequisiteforTest)

### Persona Section
- **Default list of personas** — add to EVERY test case. No change in this requirement.

```
Persona:
- System Administrator
  - Profile = System Admin
- "ADMIN User" User
  - TPM Roles = ADMIN
  - Profile = TPM_User_Profile
  - PSG = TPM Global ADMIN Users
- Key Account Manager (KAM) User
  - TPM Roles = KAM
  - Profile = TPM_User_Profile
  - PSG = TPM Global KAM Users PSG
```

### Pre-requisite Section
- **Technical format:** `Object.Field = Value` (e.g., `Context.BusinessUnit = Primary`)
- **Bracket hints for config:** `Object.Field = [Config should be setup/available]` or `[Config should be setup]`
- **Narrative when describing scenario setup:** e.g. `Tactic Template without Tactic Template Condition Creation Def config OR Tactic for which no mapping exists`
- **Examples from your TCs:**
  - `Context.BusinessUnit = Primary`
  - `TPM_Tactic_SAP_GLAccount_Mapping__c = [Config should be setup/available]`
  - `Tactic Template without Tactic Template Condition Creation Def config OR Tactic for which no mapping exists`
  - `Workflow State Transition Action [Approved->Committed] => [Config should be setup]`
  - `Multiple active funds are available for the tactic template`

---

## 2. Title Format

**Pattern:** `TC_{USID}_{##} -> [Feature Tag] -> [Sub-Feature/Context] -> Verify that [Action/Verification]`

**Feature Tag Rules:**
Always use generic feature tags based on the Acceptance Criteria to keep titles clear and within the character limit:
- **Promotion related US or AC:** `Promotion Management`
- **Account specific AC:** `Account Management`
- **Product use:** `Product Management`
- **Fund use:** `Fund Management`
- **Assortment or ADL:** `Account Management -> ADL`
- **Customer Business Plan or CBP:** `Account Management -> CBP`
- **Customer Managers:** `Account Management -> Customer Managers`
- **Customer Attributes:** `Account Management -> Customer Attributes`

*Note: You need to decide the appropriate tag by looking at the AC.*

| Example | Pattern |
|---------|---------|
| TC_1342896_01 -> Promotion Management -> Review Status -> Verify that enabling LOA selection for the L1 Approval stage renders the LOA lookup | Feature Tag -> Sub-Feature/Context -> Action/Verification |
| TC_1245456_01 -> Fund Management -> Tactic Template -> Verify default fund type can be set | Feature Tag -> Sub-Feature/Context -> Action/Verification |
| TC_1245456_02 -> Fund Management -> Fund Selection -> Verify fund section is visible on promotion tactic detail page and fund can be linked | Feature Tag -> Sub-Feature/Context -> Action/Verification |

**Title limit:** ADO Work Item Title has a 256-character limit. Keep all TC titles within this limit. Verify before finalizing. Simpler, clearer, and to the point is always preferred.

---

## 3. Steps Format

### Action (imperative, short)
- `Login as KAM User`
- `Create a new promotion record`
- `Create a new tactic using Add Tactic button`
- `Go to Tactic detail page and search for Funds section`
- `Go to App Launcher and search for Tactic Template`
- `Choose a Tactic Template -> Fund Template -> Edit -> Set Default checkbox`

### Expected Result

#### "Should" Form (Mandatory)
- **Format:** Expected results **must** use the **"should" form** consistently. Write so the executor (business user or QA) clearly understands what to verify.
  - ✅ `you should be able to do so` (standard for simple actions)
  - ✅ `Tactic record should be updated with GL mapping data`
  - ✅ `All listed fields should be correctly populated; only associated Tactic Template data should be copied; no extraneous data should be present`
  - ❌ `Tactic record is updated` (present tense — avoid)
  - ❌ `All listed fields correctly populated` (missing "should" — avoid)
- **Business/QA friendly:** Use plain language. Each clause in a multi-part expected result should include "should" so the pass/fail criteria are unambiguous.
- **Simple actions:** `you should be able to do so`
- **Validation steps:** Specific, user-focused outcome; use "should" for each assertion
  - `User should be able to set the default fund template for any given tactic template.`
  - `User should not see Standard Manage Funds action button under the Funds section on tactic detail page.`
  - `User should see these listed columns along with From, To, Fund Type fields.`

#### Numbered Format (Automation-Friendly Pattern)
- **Core Rule:** When a single test step produces multiple validations or outcomes, format the Expected Result as a numbered list using automation-friendly patterns.
- **Formatting (ADO Compatible & Automation-Ready):**
  - Use plain numbering: `1.` `2.` `3.` for main points
  - Use `1.1` `1.2` for sub-points (if needed)
  - Each point on a new line
  - NO bold, italics, or special formatting (ADO compatibility)
  - Keep each line short, direct, and parseable
- **When to Apply:** Apply when Expected Result includes:
  - Multiple fields to validate
  - Multiple conditions
  - Ordered rules / logic
  - Multiple UI validations
  - Combined outcomes (visibility + editability + data change)
- **When NOT to Apply:**
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
- **Avoid vague language:** NEVER use "should work properly", "should be correct", "appropriate access", "as expected"

**Examples by Category:**

**1. Field Validation (API/Data validation):**
```
1. Promotion.Status__c should = Adjusted
2. Promotion.Approved_By__c should = [Current User]
3. Promotion.Approval_Date__c should = [Today's Date]
4. Tactic.Planned_Rate__c should != NULL
```
**Automation mapping:**
```python
assert promotion.status == "Adjusted"
assert promotion.approved_by == current_user
assert promotion.approval_date == today
assert tactic.planned_rate is not None
```

**2. UI Element Validation (UI automation):**
```
1. Edit button should be visible
2. Save button should be enabled
3. Delete button should not be visible
4. Error banner should not be displayed
```
**Automation mapping:**
```python
assert page.edit_button.is_visible() == True
assert page.save_button.is_enabled() == True
assert page.delete_button.is_visible() == False
assert page.error_banner.is_displayed() == False
```

**3. Ordered Logic/Rules (Rule engine testing):**
```
Rule Order 1: Case_Category__c = Technical → Technical Support Queue should be assigned
Rule Order 2: Case_Category__c = Billing → Billing Support Queue should be assigned
Rule Order 3: Case_Category__c = blank/other → Default Support Queue should be assigned
```
**Automation mapping:**
```python
if case.category == "Technical":
    assert case.queue == "Technical Support Queue"
elif case.category == "Billing":
    assert case.queue == "Billing Support Queue"
else:
    assert case.queue == "Default Support Queue"
```

**4. Access Control (Combined validation):**
```
1. CBP record should be visible in list view
2. Detail page should open successfully
3. Record.Access_Level__c should = Full Access
4. Edit action should be available
5. Save action should succeed
```
**Automation mapping:**
```python
assert cbp_record in list_view.get_visible_records()
detail_page = list_view.click_record(cbp_record)
assert detail_page.is_loaded()
assert detail_page.get_field_value("Access_Level__c") == "Full Access"
assert detail_page.is_action_available("Edit") == True
assert detail_page.perform_action("Save") == "success"
```

**5. Negative Test Cases (Error validation):**
```
1. Save action should fail
2. Error message should = "Required fields are missing: Name, Status"
3. Promotion.Status__c should = Draft (unchanged)
4. User should remain on edit page
```
**Automation mapping:**
```python
result = page.click_save()
assert result.success == False
assert result.error_message == "Required fields are missing: Name, Status"
assert promotion.status == "Draft"
assert page.current_page == "edit"
```

**❌ Bad Examples (NOT automation-friendly):**
- "User should have appropriate access" → **Too vague, not measurable**
- "System should work correctly" → **No specific validation**
- "Fields should be updated properly" → **Which fields? What values?**
- "Should have read access" → **What does "read" mean in this context?**

**✅ Good Examples (Automation-friendly):**
- "Record.Access_Level__c should = Read Only"
- "Edit button should be disabled"
- "Record should be visible in list view"
- "Save action should succeed"
- "Error message should = 'Insufficient Privileges'"

### Validation step phrasing
- Use **Verify** for validation: `Verify Standard Manage Funds action button is no longer displayed to the user`
- Include **specific UI elements** when relevant: column names, field names, button labels
- Expected results describe **user-observable outcome**, not system internals

### Numbered lists in steps
- Use `<br>` between items: `1. Field A<br>2. Field B<br>3. Field C` (in table cells or expected results)

---

## 4. Admin Validation Test Cases

When validating new fields/settings for System Administrator:
- **Personas:** Both ADMIN and KAM (to verify ADMIN edit vs KAM read-only)
- **Pre-requisite:** Include the relevant documented business context or scope condition in technical format
- **Steps:** 
  1. Login as ADMIN User
  2. Navigate to setup (App Launcher, Promotion Template, Tactic Template)
  3. Verify field is accessible and editable — include **API field name** (e.g., `TPM_Default_Fund_Value__c`, `TPM_Display_Custom_Fund_Card__c`)
  4. Log out, Login as KAM User
  5. Verify field is read-only for KAM

---

## 5. Feature Tags (for AI drafts)

Align with the title structure rules based on the Acceptance Criteria:
- **Promotion related:** `Promotion Management`
- **Account specific:** `Account Management`
- **Product use:** `Product Management`
- **Fund use:** `Fund Management`
- **Assortment or ADL:** `Account Management -> ADL`
- **Customer Business Plan or CBP:** `Account Management -> CBP`
- **Customer Managers:** `Account Management -> Customer Managers`
- **Customer Attributes:** `Account Management -> Customer Attributes`

---

## 6. Flow / Context

- **Promotion → Tactic:** Tests often start with "Create a new promotion record" then "Create a new tactic"
- **Tactic Template setup:** "App Launcher -> Tactic Template -> Fund Template -> Edit -> Set Default checkbox"
- **Fund section:** Located on "Tactic detail page" under "Funds section"

---

## 7. Drafting from Clumsy AC + Solution Design (US 1234453 Example)

**US 1234453** has a complex AC: HTML table with Notification | Type | Trigger(s) | Notification Text | Audience. Here's how the team distilled it:

### How to Parse Clumsy AC
1. **Extract rows** from tables — each row = one notification scenario
2. **Map Trigger(s)** → Pre-requisite conditions (Object.Field = Value)
3. **Map Notification Text** → Expected result (exact message text)
4. **Map Audience** → Persona for the TC
5. **Group related validations** — e.g. "Draft → Planned" validations in one TC with multiple steps

### Pre-requisite from Solution Design
- Pull **API field names** from SD: `PromotionTemplate.TPM_Required_Promotion_Fields__c`, `PromotionTemplate.TPM_Tactic_Fund_Validation__c`, `PromotionTemplate.TPM_Required_Tactic_Fields__c`
- Use **Config 1 / Config 2** when testing alternate paths (e.g. TPM_Tactic_Fund_Validation__c = TRUE vs FALSE)
- Include **Field Sets** when relevant: `TPM_Required_Promotion_Fields`, `TPM_Required_Tactic_Fields`

### TO BE TESTED FOR Section
- Use when TC validates **specific items** from AC: "At least one ZREP is added", "At least one Tactic is added", "Consolidated Required fields missing validation"
- Or when scoping: "Promotion Template", "Tactic Template"

### Steps with Inline Test Data
- When wizard/flow has many options: add **Test Data** in the step: "Test Data: Account Hierarchy Level = Planning, Account = You work on, Planning Type = Shipment, Event Type = LTA"
- Reference pre-requisite: "FYI, Check the Pre-requisite mentioned above section"

### Expected Result — Exact AC Text
- Copy **notification message format** from AC: `"Required Fields are Missing : {all field labels} for the tactic : {cgcloud__Tactic_Type__c value}"`
- Use placeholders `{field labels}`, `{cgcloud__Tactic_Type__c value}` when exact values vary

### Persona Variant
- Some TCs list **3 personas**: System Administrator (Profile = System Admin), "ADMIN User" User, Key Account Manager (KAM) User
- Use when TC may involve setup (System Admin) or different user types

### Title for Validation TCs
- `TC_{USID}_{##} -> [Feature Tag] -> [Sub-Feature/Context] -> Verify that [Action/Verification]`
- Example: `TC_1234453_01 -> Promotion Management -> Status 'Draft to Planned' -> Verify that KAM user observes the required field missing notifications on Status Transition`

---

## 8. Improvement Pointers (from US 1270230 Feedback)

Apply these when drafting future test cases:

### Phrasing
- **Status transitions:** Use generic phrasing derived from the source requirements. Prefer neutral wording that matches the documented entity and target state.
- **Payment / variant dimensions:** When a dimension such as payment method, channel, region, tenant, or market changes behavior, include the relevant combinations in Test Data and repeat steps only where needed.

### Field Validation Steps
- **Format:** When listing fields to validate, format for readability:
  - Use numbered list: `1. Field A<br>2. Field B<br>3. Field C` (in table cells, use `<br>` for line breaks)
  - Or bullet list outside table
- **Scope:** Be explicit about validation scope — e.g., "only data from the associated Tactic Template's config record is copied (no other data)".

### Step Structure
- **Split compound steps:** If a step has Part A and Part B, split into two steps so each expected result is clear and testable.

### Admin Validation
- **Existing vs newly introduced:** For **existing** fields/config (not created in the US), do **not** create Admin validation TCs.
- **Newly introduced config:** Create Admin validation TCs for **Custom Metadata Type** and **Workflow State Transition Action** (or equivalent) when these are introduced in the US. Refer to Solution Design Confluence for exact config names.

### Work Item Title Character Limit
- **ADO limit:** 256 characters. Keep all TC titles within this limit. Verify before finalizing.

### Edge Cases
- Consider edge cases: no config present, multiple records, fallback behavior, etc.
- Examples: Tactic without mapping config (no data copied), Promotion with multiple Tactics (each gets correct mapping).

### Test Case Optimization
- Combine similar combinations (e.g., alternate region or business-unit values) into a single TC with Test Data table and "Repeat for each combination" step instead of separate TCs per combination.

### Push to ADO (create_test_cases command)
- **Only test cases are pushed to ADO** — not the JSON file. The draft is stored as markdown until push; `push_tc_draft_to_ado` parses the markdown, creates test case work items in ADO, then generates JSON for reference. The JSON file is created only at push time.
- **Prerequisite for Test field:** Common Prerequisites from the draft are written to ADO's Custom.PrerequisiteforTest field. When calling `save_tc_draft`, always pass `commonPrerequisites` with `preConditions` and `testData` so all test cases get prerequisites when pushed. If the JSON lacks commonPrerequisites, the push tool parses the markdown to extract them.

### Expected Result — "Should" Form (Business/QA Friendly)
- **Rule:** Every expected result must use "should" so the executor understands what to verify. Avoid present tense (e.g., "is updated", "are generated").
- **Multi-part:** Use "should" in each clause: `X should be true; Y should be copied; Z should not be present`.
- **Examples:**
  - ✅ `All listed fields should be correctly populated; only associated Tactic Template data should be copied; no extraneous data should be present`
  - ✅ `Tactic should be updated with GL mapping data; Tactic Condition Creation Definition.Maintenance should be set to Upsert`
  - ✅ `Configuration should be saved successfully`
  - ❌ `Tactic updated; Maintenance = Upsert` (missing "should")

---

## Summary: AI Draft Checklist

When drafting test cases, apply:
0. ✅ **Project Context:** Treat project-specific examples in this guide as illustrative. Derive the real business objects, personas, and scope dimensions from the active AC, Solution Design, and project conventions.
1. ✅ **Persona:** Use the configured default personas for the active project and include their configured metadata consistently; add setup/admin personas when the scenario requires them.
2. ✅ **Pre-requisite:** Start with the primary documented scope/config condition for the scenario; add technical conditions with `Object.Field = Value` from AC/Solution Design; use `[ context ]` for setup details; use Config 1/Config 2 for alternate paths
3. ✅ **Title:** `TC_{USID}_{##} -> [Feature Tag] -> [Sub-Feature/Context] -> Verify that [Action/Verification]` (Use generic tags like Promotion Management, Account Management, etc.)
4. ✅ **Steps:** Imperative actions; "you should be able to do so" for setup; specific user-observable outcomes; include inline Test Data when flow has many options; reference pre-requisite when needed; split Part A/Part B into separate steps
5. ✅ **Expected:** Use **"should" form** consistently (e.g., "X should be updated; Y should be copied"); business/QA friendly; for validation TCs, use exact notification/message text from AC (with placeholders like `{field labels}`)
6. ✅ **TO BE TESTED FOR:** Use when TC validates specific AC items (e.g. "At least one ZREP is added")
7. ✅ **Admin validation TCs:** Include API field names from Solution Design; verify the relevant setup/admin persona and the relevant business user persona for access behavior
8. ✅ **Clumsy AC:** Parse tables row-by-row; map Trigger → Pre-requisite, Notification Text → Expected, Audience → Persona; group related validations in one TC
9. ✅ **Phrasing:** Use generic status transitions and cover the documented variant dimensions that affect behavior; format field lists (numbered, readable)
10. ✅ **Admin validation:** Only for newly introduced config (Custom Metadata, Workflow State Transition Action); not for existing fields
11. ✅ **Title limit:** ADO Work Item Title ≤ 256 characters
12. ✅ **Edge cases:** Include TCs for no config, multiple records, fallback behavior where relevant
