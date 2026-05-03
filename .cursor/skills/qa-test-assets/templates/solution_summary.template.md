# Solution Summary - US <ID>

**US ID:** <ID>
**Title:** <Title>
**Scope:** Full | Partial — <note if partial>

---

## 1. Purpose and Scope

**Business Problem:**
<What business problem this solution addresses>

**Behavior Introduced/Changed:**
<What is being introduced or changed>

**In Scope:**
- <Item 1>
- <Item 2>

**Out of Scope:**
- <Item not covered>

---

## 2. Business Process Overview

**Triggering Action:** <Entry point / trigger event>

**Key Actors:**
- <Role 1> — <what they do>
- <Role 2> — <what they do>

**Process Flow:**
1. <Trigger event>
2. <System check/evaluation>
3. <Outcome based on conditions>

**Expected Outcome:** <What happens when successful>

**Alternate Flows:**
- If <condition> → <alternate outcome>

---

## 3. Core Decision Logic

<!-- Use decision table or rule matrix for clarity -->

| Condition A | Condition B | Outcome |
|-------------|-------------|---------|
| TRUE        | Edit        | <Result> |
| TRUE        | Read        | <Result> |
| TRUE        | None        | <Result> |
| FALSE       | Any         | <Result> |

**Feature Flags / Controlling Settings:**
- `Object.Field = Value` → <behavior enabled/disabled>

**Eligibility Rules:**
- <Rule 1>
- <Rule 2>

---

## 4. Key Solution Decisions

| Decision | Why It Matters | QA Impact |
|----------|----------------|-----------|
| <Decision 1> | <Business/technical reason> | <What QA must verify> |
| <Decision 2> | <Business/technical reason> | <What QA must verify> |

---

## 5. Fields and Configuration

**New Custom Fields:**
| Field Label | API Name | Object | Type | Purpose |
|-------------|----------|--------|------|---------|
| <Label> | `Object.Field__c` | <Object> | <Type> | <What it does> |

**New Configurations:**
| Component | Detail |
|-----------|--------|
| <Rule/Queue/Setting> | <What it controls> |

---

## 6. Setup Prerequisites (Compact Format)

<!-- Keep concise. Use table format. No exact formulas. -->

| Component | Required State |
|-----------|----------------|
| `Object.Field__c` | Deployed on <Object> page layout |
| <Rule Name> | Active with <N> entries |
| <Queue Name> | Configured with <Object> as Supported Object |
| <Validation Rule> | Active on <Object> |

---

## 7. Behavior by Scenario

| Scenario | Conditions | Expected Behavior |
|----------|------------|-------------------|
| Happy path | <All conditions met> | <Success outcome> |
| Negative - config disabled | <Config = FALSE> | <No processing> |
| Edge - missing data | <Required data absent> | <Graceful handling> |
| Role variation | <Different user role> | <Role-specific behavior> |

---

## 8. QA Impact / Test Design Guidance

**What Must Always Be Validated:**
- <Critical validation 1>
- <Critical validation 2>

**High-Value Test Combinations:**
- <Combination 1>
- <Combination 2>

**Risks Easy to Miss:**
- <Risk 1> — <why it's easy to miss>
- <Risk 2> — <why it's easy to miss>

**Coverage Guidance:**
- Positive: <What to test>
- Negative: <What to test>
- Boundary: <What to test>

---

## 9. Risk Areas and Regression Triggers

| Risk Area | Why It Matters | Regression Test When |
|-----------|----------------|----------------------|
| <Area 1> | <Explanation> | <Trigger condition> |
| <Area 2> | <Explanation> | <Trigger condition> |

---

## 10. Open Questions / Assumptions

**Missing Information:**
- <What is unknown>

**Assumptions Needing Confirmation:**
- <Assumption 1> — awaiting confirmation from <source>

---

## 11. QA Reuse Notes

**Test Case Generation:** Use Section 3 (Decision Logic) and Section 7 (Behavior by Scenario) to derive test cases.

**Cheat Sheet Creation:** Use Section 3 for decision tables, Section 6 for setup requirements.

**Regression Scoping:** Use Section 9 (Risk Areas) to identify regression test scope.

---

## Executive QA Snapshot

| Aspect | Details |
|--------|---------|
| **What controls behavior** | <Key config/flag> |
| **What must match for success** | <Required conditions> |
| **What causes failure/no access** | <Failure conditions> |
| **Regression test areas** | <Key areas to retest> |
