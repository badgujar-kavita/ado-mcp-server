# Automation-Friendly Test Case Patterns

**Purpose:** Quick reference for writing test case expected results that are easily translatable to automated assertions.

---

## Core Pattern

When multiple validations exist in a single step, use this structured format:

```
1. <Object>.<Field> should <operator> <Value>
2. <UI_Element> should be <state>
3. <Action> should <outcome>
4. <Message/Error> should [not] be displayed
```

---

## Pattern Categories with Automation Mapping

### 1. Field Validation (API/Data validation)

**Test Case Format:**
```
1. Promotion.Status__c should = Adjusted
2. Promotion.Approved_By__c should = [Current User]
3. Promotion.Approval_Date__c should = [Today's Date]
4. Tactic.Planned_Rate__c should != NULL
```

**Automation Pseudocode:**
```python
assert promotion.status == "Adjusted"
assert promotion.approved_by == current_user
assert promotion.approval_date == today
assert tactic.planned_rate is not None
```

**When to Use:** Data updates, field population, record creation, API responses

---

### 2. UI Element Validation (UI automation)

**Test Case Format:**
```
1. Edit button should be visible
2. Save button should be enabled
3. Delete button should not be visible
4. Error banner should not be displayed
```

**Automation Pseudocode:**
```python
assert page.edit_button.is_visible() == True
assert page.save_button.is_enabled() == True
assert page.delete_button.is_visible() == False
assert page.error_banner.is_displayed() == False
```

**When to Use:** UI state verification, button availability, element visibility, form validation

---

### 3. Ordered Logic/Rules (Rule engine testing)

**Test Case Format:**
```
Rule Order 1: Case_Category__c = Technical → Technical Support Queue should be assigned
Rule Order 2: Case_Category__c = Billing → Billing Support Queue should be assigned
Rule Order 3: Case_Category__c = blank/other → Default Support Queue should be assigned
```

**Automation Pseudocode:**
```python
if case.category == "Technical":
    assert case.queue == "Technical Support Queue"
elif case.category == "Billing":
    assert case.queue == "Billing Support Queue"
else:
    assert case.queue == "Default Support Queue"
```

**When to Use:** Decision trees, conditional logic, assignment rules, workflow routing

---

### 4. Access Control (Combined validation)

**Test Case Format:**
```
1. CBP record should be visible in list view
2. Detail page should open successfully
3. Record.Access_Level__c should = Full Access
4. Edit action should be available
5. Save action should succeed
```

**Automation Pseudocode:**
```python
# Step 1: List view visibility
assert cbp_record in list_view.get_visible_records()

# Step 2: Navigation
detail_page = list_view.click_record(cbp_record)
assert detail_page.is_loaded()

# Step 3: Field validation
assert detail_page.get_field_value("Access_Level__c") == "Full Access"

# Step 4: Action availability
assert detail_page.is_action_available("Edit") == True

# Step 5: Action execution
assert detail_page.perform_action("Save") == "success"
```

**When to Use:** Permission testing, role-based access, sharing rules, record-level security

---

### 5. Negative Test Cases (Error validation)

**Test Case Format:**
```
1. Save action should fail
2. Error message should = "Required fields are missing: Name, Status"
3. Promotion.Status__c should = Draft (unchanged)
4. User should remain on edit page
```

**Automation Pseudocode:**
```python
result = page.click_save()
assert result.success == False
assert result.error_message == "Required fields are missing: Name, Status"
assert promotion.status == "Draft"
assert page.current_page == "edit"
```

**When to Use:** Validation rules, required fields, business rule violations, error handling

---

## Writing Style Rules

### ✅ DO Use:
- **Specific targets:** `Promotion.Status__c`, `Edit button`, `Error message`
- **Clear operators:** `=`, `!=`, `CONTAINS`, `IN`, `>`, `<`
- **Measurable states:** `enabled`, `disabled`, `visible`, `hidden`, `displayed`
- **Deterministic outcomes:** `succeed`, `fail`, `be assigned`, `be updated`

### ❌ DON'T Use:
- Vague language: "should work properly", "should be correct"
- Ambiguous access: "appropriate access", "proper permissions"
- Generic outcomes: "as expected", "correctly", "successfully" (without context)
- Unclear targets: "fields should update" (which fields?)

---

## Comparison: Bad vs Good

| ❌ Bad (NOT automation-friendly) | ✅ Good (Automation-friendly) |
|----------------------------------|-------------------------------|
| User should have appropriate access | Record.Access_Level__c should = Read Only |
| System should work correctly | Save action should succeed |
| Fields should be updated properly | 1. Status__c should = Active<br>2. Updated_Date__c should = [Today] |
| Should have read access | 1. Record should be visible<br>2. Edit button should be disabled |
| Record should be created successfully | 1. Record.Id should != NULL<br>2. Record.Status__c should = New<br>3. Success message should be displayed |

---

## Operator Reference

| Operator | Use Case | Example |
|----------|----------|---------|
| `=` | Exact match | `Status__c should = Active` |
| `!=` | Not equal / exists | `Field__c should != NULL` |
| `CONTAINS` | Substring match | `Description__c should CONTAINS "Approved"` |
| `IN` | List membership | `Sales_Org__c should IN (1111, 0404)` |
| `>` / `<` | Numeric comparison | `Count__c should > 0` |
| `>=` / `<=` | Inclusive range | `Discount__c should >= 10` |

---

## State Reference

| State | UI Context | Example |
|-------|-----------|---------|
| `visible` | Element can be seen | `Edit button should be visible` |
| `hidden` | Element exists but not shown | `Delete button should be hidden` |
| `enabled` | Element is interactive | `Save button should be enabled` |
| `disabled` | Element is grayed out | `Submit button should be disabled` |
| `displayed` | Message/banner is shown | `Error banner should be displayed` |
| `not be displayed` | Message/banner is absent | `Success message should not be displayed` |

---

## Action Outcome Reference

| Outcome | Use Case | Example |
|---------|----------|---------|
| `succeed` | Action completes successfully | `Save action should succeed` |
| `fail` | Action does not complete | `Approval action should fail` |
| `be assigned` | Value is set | `Queue should be assigned` |
| `be updated` | Value changes | `Status should be updated` |
| `be created` | Record exists | `Record should be created` |
| `be deleted` | Record removed | `Record should be deleted` |
| `remain unchanged` | Value stays same | `Field should remain unchanged` |

---

## Quick Decision Tree

```
Does the step produce multiple validations?
├─ YES → Use numbered list with automation-friendly patterns
│   ├─ Validating fields? → Use Object.Field should = Value
│   ├─ Validating UI? → Use UI_Element should be state
│   ├─ Validating actions? → Use Action should outcome
│   ├─ Validating messages? → Use Message should [not] be displayed
│   └─ Rule logic? → Use Rule Order N: condition → outcome should happen
│
└─ NO → Use simple form
    ├─ Simple action? → "you should be able to do so"
    └─ Single validation? → One assertion (e.g., "Record should be visible")
```

---

## Summary

**Goal:** Every expected result line should map to a clear, executable assertion in automation code.

**Key Principle:** If a manual tester OR an automation engineer can't determine EXACTLY what to verify from your expected result, it needs to be more specific.

**Test Your Writing:** Ask yourself: "Can I write an assert statement for this?" If no, make it more specific.
