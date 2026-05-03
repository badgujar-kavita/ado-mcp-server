# Test Case Writing Pattern Analysis — GPT_D-HUB (Plan 1066480)

**Source:** Test cases from GPT_D-HUB test plan (excluding Smoke/Regression suite 1083214)  
**Purpose:** Document observed patterns to improve AI draft quality and command suggestions  
**Reviewed:** US 1025573, 1061882, 1053963, 1025414, 1078433, 1092919 (sample TCs: 1090667, 1089215, 1088846, 1085926, 1067846, 1067659, 1115267, 1126078)

---

## 1. Title Format Patterns

### Observed Structure

| Pattern | Example |
|---------|---------|
| **TC_USID_## -> Area -> Sub-area -> Persona -> Verify {validation}** | `TC_1025573_06 -> Promotion Management -> Mass Status Update -> Event Manager -> Event -> Verify the "Review History" is updated with new entry after successful status update via 'Promotion Mass Status Update' functionality` |
| **TC_USID_## -> Area -> Sub-area -> Tab/Context -> Persona -> Verify {validation}** | `TC_1025573_05 -> Promotion Management -> Mass Status Update -> 'Promotion Mass Status Update' Tab -> KAM User -> Verify 'Next Status' is disabled or empty when filtered promotions have different valid statuses` |
| **TC_USID_## -> Area -> Sub-area -> As Persona, Verify {validation}** | `TC_1053963_1 -> Promotion/Event Management -> Permission Optimization -> As Administrator, Verify that user is able to create and view the promotions/Events` |
| **TC_USID_## -> Area -> Sub-area -> Verify {validation}** | `TC_1078433_02 -> Promotion Management -> Event Manager -> Events -> History/ Legacy Data -> Verify the 'Condition Generation' value for History Data` |
| **TC_USID_## -> Condition -> Area -> Tab -> Persona -> Verify {validation}** | `TC_1061882_05 -> Discontinued Products Settings = True -> Customer Business Plan -> KPI Tab -> KAM User -> Verify Product with actuals outside lookback period` |
| **TC_USID_## -> Area -> Hierarchy context -> Verify {validation}** | `TC_1092919_04 -> Promotion Management -> Multi Level Sub Accounts -> "L2 (Planning Group)>L1 (No Attribute)>L0 (Sold To Account)"-> Events/Promotion Planning -> Validate that L1 Level Sub Account does not show up in Customer Search on New Event Wizard` |

### Title Conventions

- **Separator:** ` -> ` (space-hyphen-greater-space)
- **Persona placement:** Can be before "Verify" or after "As"
- **Quotes:** Use single quotes for UI elements: `'Promotion Mass Status Update' Tab`, `'Next Status'`
- **Outdated marker:** `[OUTDATED] || TC_...` prefix when TC is obsolete
- **Character limit:** ADO 256 chars — titles are often long; keep under limit

---

## 2. Prerequisites (Custom.PrerequisiteforTest) Structure

### Persona Section

```
Persona:
1. "ADMIN User" User
   - TPM Roles = ADMIN
   - Profile = TPM_User_Profile
   - PSG = TPM Global ADMIN Users
2. Key Account Manager (KAM) User
   - TPM Roles = KAM
   - Profile = TPM_User_Profile
   - PSG = TPM Global KAM Users PSG
```

**Variations observed:**
- `CG "ADMIN User" User` (some TCs)
- `"ADMIN User" User` (most common)
- System Administrator not always listed (only when setup/config is involved)

### Pre-requisite Section

- **Format:** `Object.Field = Value` or `Object.Field != NULL`
- **Highlighting:** Important configs use `<span style="color:rgb(222, 106, 25);">` (orange) or `<b>`
- **Examples:**
  - `User.Sales Organization = 1111`
  - `Workflows.WorkflowStateTransition.TPM_User_Roles__c != NULL`
  - `Workflows.WorkflowStateTransition.Enable Mass Transition checkbox is set to = TRUE`
  - `Include Discontinued Products = TRUE`, `Lookback Period In Years = 1 Year`

### Test Data Section

- Often embedded in Pre-requisite or as separate `TEST DATA:` block
- **Format:** `Account = ALBERTSONS - SAFEWAY CNFY`, `Event.Status = Draft`, `Promotion Type = ShortTerm`
- **Use case examples:** `USE CASE 1: Discontinued a Product on Dec 30, 2024, is visible in Year 2026 CBP`

---

## 3. Steps Format

### Action (Imperative)

| Action Type | Examples |
|-------------|----------|
| Login | `Login as KAM User` / `Login to Salesforce as KAM user` / `Login to Salesforce as a KAM User` |
| Navigate | `In Trade Promotion Management App` / `Go to 'Promotion Mass Status Update' Tab` |
| Apply filter | `In Filter, Apply filter to search DRAFT Promotions/Events` |
| Select/Click | `Tick the checkbox next to any Single Promotion/Event` / `Click 'Apply' Action` |
| Verify | `Verify that 'Next Status' shows only two values i.e. Planned and Cancelled` |

### Test Data in Steps

- **Inline:** `Test Data: Search Criteria 1. Customer = ALBERTSONS - SAFEWAY CNFY 2. Event.Status = Draft 3. Promotion Type = ShortTerm`
- **Bold labels:** `Test Data:`, `Test Data: Search Criteria`
- **Step references:** `Repeat Steps #4-13` for iterative flows

### Expected Results

- **Standard for simple actions:** `you should be able to do so` / `You should be able to do so`
- **Validation steps:** Specific, multi-part with "should"
  - `1. A new status update entry should be created in Review History Tab... 2. Following details should be visible: Status update From to To, Comment, Reviewer Details, Date`
- **"Should" form:** Consistently used (matches style guide)

---

## 4. Persona Usage

| Persona | When Used |
|---------|-----------|
| **KAM User** | Promotion flows, Event Manager, Mass Status Update, CBP, Tactic planning |
| **ADMIN User** | User Setup, Workflow config, Permission Set setup |
| **System Administrator** | Setup/config TCs (e.g., Tactic Template, Promotion Template) |

---

## 5. Common Test Data Values

- **Account:** `ALBERTSONS - SAFEWAY CNFY`
- **Sales Org:** `1111`
- **Event Status:** `Draft`, `Planned`, `In Approval`, `Approved`, `Committed`, `Cancelled`
- **Promotion Type:** `ShortTerm`
- **Account Hierarchy Level:** `Planning Account`, `L5`, `Sub Account`

---

## 6. Gaps vs. Current Style Guide

| Aspect | Style Guide | Observed in ADO |
|--------|-------------|-----------------|
| **Title** | `TC_{USID}_{##} -> {Feature} -> [Sub-context] -> {Validation Type} -> Verify that {Persona} {validation}` | Persona sometimes in middle; "As {Persona}" variant; hierarchy in quotes |
| **Persona** | System Administrator + ADMIN + KAM (all three) | Often only ADMIN + KAM; System Admin when setup needed |
| **Expected** | "should" form | ✅ Consistent |
| **Steps** | Imperative | ✅ Consistent |
| **Prerequisite** | Object.Field = Value | ✅ Consistent; Test Data often inline |

---

## 7. Suggestions for AI Draft Improvements

### Title

1. **Support hierarchy in title:** When testing hierarchy (e.g., L2>L1>L0), include quoted hierarchy in title.
2. **Support "As Persona" variant:** `As Administrator, Verify that...` is valid.
3. **Tab/UI context:** Include specific tab or UI context (e.g., `'Promotion Mass Status Update' Tab`) when relevant.

### Prerequisites

1. **Test Data block:** Add optional `TEST DATA:` or `Test Data:` section when scenario has specific data (Account, Status, etc.).
2. **Highlight critical config:** Use bold or emphasis for config that varies between scenarios (e.g., Enable Mass Transition = TRUE vs FALSE).

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

When drafting test cases for GPT_D-HUB / TPM Product Ecosystem:

- [ ] **Title:** Use `TC_{USID}_{##} -> {Area} -> {Sub-context} -> [Persona/As Persona] -> Verify {validation}`; include hierarchy in quotes when relevant; ≤256 chars
- [ ] **Persona:** ADMIN + KAM minimum; add System Administrator when setup/config TC
- [ ] **Pre-requisite:** `User.Sales Organization = 1111` first; Object.Field = Value; highlight config variations
- [ ] **Test Data:** Inline in steps when filter/search; or separate TEST DATA block in prerequisites
- [ ] **Steps:** Imperative; "you should be able to do so" for setup; "Verify" for validation; support "Repeat Steps #N-M"
- [ ] **Expected:** "should" form; multi-part numbered when needed
- [ ] **Common data:** Account (e.g., ALBERTSONS - SAFEWAY CNFY), Sales Org 1111, Event statuses, Promotion Type ShortTerm
