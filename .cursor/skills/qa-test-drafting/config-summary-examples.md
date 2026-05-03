# Config Summary Examples for Pre-requisite

Use these as reference when preparing the **Config Summary** section for the Prerequisite for Test field. Adapt to the specific User Story and Solution Design.

---

## Example 1: Promotion Template + Tactic Validation

```
* User.Sales Organization = 1111 / 0404
* PromotionTemplate.TPM_Required_Promotion_Fields__c != NULL
* PromotionTemplate.TPM_Required_Tactic_Fields__c != NULL
* PromotionTemplate.TPM_Tactic_Fund_Validation__c = TRUE
* TacticTemplate.TPM_Required_Tactic_Fields__c != NULL
* Promotion Field Set: TPM_Required_Promotion_Fields
* Tactic Field Set: TPM_Required_Tactic_Fields
```

---

## Example 2: Reapproval Workflow (Rate Changes)

```
* User.Sales Organization = 1111
* Promotion.Status = Adjusted
* Promotion.Phase = Not Yet Started OR In-Flight
* Tactic.CompensationModel = Planned $ Per Case OR Planned % Per Case
* Tactic.Planned_Dollar_Per_Case__c != NULL
* Tactic.Planned_Percent_Per_Case__c != NULL
* Promotion.LOA_Threshold__c != NULL
* PromotionTemplate.Reapproval_Workflow_Enabled__c = TRUE
* Lightning Action: "Save and Refresh" assigned to Promotion Page Layout
* Lightning Action: "Review Status" assigned to Promotion Page Layout
* LOA Approver User.IsActive = TRUE
```

---

## Example 3: LOA / Config-Driven Logic

```
* User.Sales Organization = 1111 (or market-specific)
* PromotionTemplate.TriggerPromotionStatuses = [Configured values]
* PromotionTemplate.TargetPromotionStatus = [Configured value]
* PromotionTemplate.TriggerThresholdPromotionFields = [Configured fields]
* PromotionTemplate.LOAComparisonPromotionFields = [Configured fields]
* PromotionTemplate.EnableLOACheck = TRUE / FALSE (per scenario)
* TPM_LOA__c != NULL (when LOA enabled)
```

---

## Example 4: GL Mapping / Tactic Template

```
* User.Sales Organization = 1111
* TPM_Tactic_SAP_GLAccount_Mapping__c = [Config should be setup/available]
* TacticTemplate.Tactic_Template_Condition_Creation_Def__c = [Config should be setup/available]
* Tactic Template without Tactic Template Condition Creation Def config OR Tactic for which no mapping exists
* Workflow State Transition Action [Approved->Committed] => [Config should be setup]
```

---

## Format Rules

- Use `Object.Field = Value` or `Object.Field != NULL`
- Use `[Config should be setup/available]` when config is required but not specified
- Use `OR` for alternate conditions
- Include Sales Org when market-specific
- List Field Sets when relevant (e.g., TPM_Required_Promotion_Fields)
