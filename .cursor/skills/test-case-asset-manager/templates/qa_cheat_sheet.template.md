# QA Cheat Sheet - US <ID>

Quick reference for test execution and debugging.

---

## Executive Decision Summary

| Aspect | Details |
|--------|---------|
| **What controls behavior** | `<Object.Field>` = TRUE/FALSE |
| **What must match for success** | <Required conditions> |
| **What causes failure/no access** | <Failure conditions> |

---

## Decision Table

<!-- Use consistent outcome language: access granted / not granted, visible / hidden, created / not created -->

| Config Enabled | Access Level | Outcome |
|----------------|--------------|---------|
| TRUE           | Edit         | Access granted (Edit) |
| TRUE           | Read         | Access granted (Read-only) |
| TRUE           | None         | Access not granted |
| FALSE          | Any          | No processing (config disabled) |

---

## Setup Prerequisites

**System Config Requirements:**
- [ ] `<Object.Field>` = <required value>
- [ ] <Feature flag enabled>

**User/Role Requirements:**
- [ ] User has <required role/profile>
- [ ] User.Sales_Organization = <value>

**Data State Requirements:**
- [ ] <Required data exists>
- [ ] <Required relationships established>

---

## Scenario Variables

Variables that change per test (use for test combination planning):

| Variable | Valid Values | Notes |
|----------|--------------|-------|
| <Variable 1> | <Value A, Value B, Value C> | <Combination guidance> |
| <Variable 2> | <TRUE, FALSE> | <Impact on outcome> |

---

## Positive Validations

Expected behaviors when conditions are met (use consistent outcome language):

- Config = TRUE + Access = Edit → Access granted (Edit)
- Config = TRUE + Access = Read → Access granted (Read-only)
- <Additional positive validation>

---

## Negative Validations

Expected behaviors for error/edge/failure cases:

- Config = FALSE → No processing occurs (not: "default access")
- Access = None → Access not granted
- <Missing required data> → <Graceful handling / error message>

---

## Debug / Triage Order

When access or behavior is incorrect, check in this order:

1. [ ] **Config check:** Is `<Object.Field>` = TRUE?
2. [ ] **User check:** Does user have required role/profile?
3. [ ] **Data check:** Does required data exist and have correct values?
4. [ ] **Relationship check:** Are required object relationships established?
5. [ ] **Timing check:** Has background processing completed?

**Common Root Causes:**
- Config not enabled at expected level (Template vs. Record)
- Required data created after trigger event
- User role missing required permission

---

## Regression Triggers

| Change | Impacted Test Areas |
|--------|---------------------|
| <Config value changed> | <Which tests to rerun> |
| <Data relationship changed> | <Which tests to rerun> |
| <Role/permission changed> | <Which tests to rerun> |
| <Related feature updated> | <Which tests to rerun> |

---

## Role-Based Behavior Matrix

| Role | Can Create | Can Edit | Can View | Special Notes |
|------|------------|----------|----------|---------------|
| **KAM** | Yes | <Conditional> | Yes | <Notes> |
| **ADMIN** | Yes | Yes | Yes | <Notes> |
| **System Admin** | Setup only | Setup only | Yes | <Notes> |

---

## Dependency Reminders

- <Parent object> must exist **before** <child object>
- <Config A> must be enabled **for** <feature B> to work
- <Data X> must be associated **with** <Object Y> before trigger

---

## Common Pitfalls

- <Common mistake 1> — <how to avoid / what to check>
- <Common mistake 2> — <how to avoid / what to check>
- Assuming FALSE config means "default access" — it means "no processing"
