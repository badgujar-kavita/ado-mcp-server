# QA Cheat Sheet - US <ID>

Quick reference for test execution. Keep scannable (max 50-60 lines).

---

## Decision Logic

<!-- Use table format for conditional logic. Each row = one test scenario. -->

| Use Case | Config/Field Values | Conditions | Expected Outcome |
|----------|---------------------|------------|------------------|
| Happy path | Config = TRUE, Access = Edit | All conditions met | Access granted (Edit) |
| Read-only | Config = TRUE, Access = Read | All conditions met | Access granted (Read-only) |
| Config disabled | Config = FALSE | Any | No processing |
| Missing prerequisite | Config = TRUE | Relationship missing | Access not granted |

---

## Quick Maps

<!-- Use for field mappings, value translations, source lookups -->

**Field/Value Mappings:**
| Source Field | Maps To | Valid Values |
|--------------|---------|--------------|
| `Object.Field__c` | `Target.Field__c` | Value A, Value B, Value C |

**Category/Type Source:**
| Object | Category Field | Example Values |
|--------|----------------|----------------|
| Promotion | `Effective_Categories__c` | Electronics, Apparel |

---

## Setup Checklist

<!-- Max 5 items. No nested bullets. No exact formulas. -->

- [ ] Fields: `Object.Field__c`, `Object.Field2__c`
- [ ] Rules: Assignment Rule (active), Validation Rule (active)
- [ ] Config: `Feature_Flag__c = TRUE`
- [ ] Queues/Roles: Support Queue configured, User is queue member
- [ ] Relationships: Parent-child associations exist

---

## Debug Order

<!-- Single numbered list. Max 6 steps. -->

1. Check field/config values on record
2. Verify rule/workflow is active
3. Confirm user role/permissions
4. Validate data relationships exist
5. Check timing (async processing complete?)
6. Review logs/debug for errors

---

## Regression Triggers

| Change | Retest TCs |
|--------|------------|
| Config value changed | TC4, TC6, TC9 |
| Rule modified | TC1-TC8 |
| Field added/removed | All admin validation TCs |

---

## Role Notes

| Role | Key Reminders |
|------|---------------|
| KAM | Must be queue member; fills Resolution Notes before close |
| System Admin | Validates field API names, rule formulas, exact error messages |

---

## Memory Aid

<!-- One-liner rule of thumb -->

No [prerequisite] = no [outcome]. Config FALSE = no processing.
