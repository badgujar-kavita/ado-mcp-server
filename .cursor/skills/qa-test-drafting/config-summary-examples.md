# Config Summary Examples for Pre-requisite

Use these as reference when preparing the **Config Summary** section for the Prerequisite for Test field. Adapt to the specific User Story and Solution Design.

---

## Example 1: Opportunity Stage + Validation Rules

```
* User.Region__c IN (North America, EMEA)
* OpportunityValidationConfig.Required_Opportunity_Fields__c != NULL
* OpportunityValidationConfig.Required_Product_Fields__c != NULL
* OpportunityValidationConfig.Amount_Check_Enabled__c = TRUE
* ProductValidationConfig.Required_Product_Fields__c != NULL
* Opportunity Field Set: Required_Opportunity_Fields
* Opportunity Product Field Set: Required_Product_Fields
```

---

## Example 2: Reapproval Workflow (Amount Changes)

```
* User.Region__c = North America
* Opportunity.StageName = Negotiation/Review
* Opportunity.Type = New Business OR Existing Business
* Opportunity.Amount != NULL
* Opportunity.Previous_Approved_Amount__c != NULL
* ApprovalThresholdConfig.Amount_Change_Threshold__c != NULL
* OpportunityApprovalConfig.Reapproval_Workflow_Enabled__c = TRUE
* Lightning Action: "Submit for Approval" assigned to Opportunity Page Layout
* Lightning Action: "Refresh Approval Status" assigned to Opportunity Page Layout
* Approver User.IsActive = TRUE
```

---

## Example 3: Escalation / Config-Driven Logic

```
* User.Region__c = [Configured region]
* CaseRoutingConfig.TriggerCaseStatuses = [Configured values]
* CaseRoutingConfig.TargetCaseStatus = [Configured value]
* CaseRoutingConfig.TriggerThresholdCaseFields = [Configured fields]
* CaseRoutingConfig.EscalationComparisonFields = [Configured fields]
* CaseRoutingConfig.EnableEscalationCheck = TRUE / FALSE (per scenario)
* Case.Escalation_Threshold__c != NULL (when escalation is enabled)
```

---

## Example 4: Queue Mapping / Routing Template

```
* User.Region__c = North America
* Case_Routing_Queue_Mapping__c = [Config should be setup/available]
* CaseTemplate.Routing_Condition_Definition__c = [Config should be setup/available]
* Case template without routing condition definition OR case for which no queue mapping exists
* Workflow State Transition Action [New->In Progress] => [Config should be setup]
```

---

## Format Rules

- Use `Object.Field = Value` or `Object.Field != NULL`
- Use `[Config should be setup/available]` when config is required but not specified
- Use `OR` for alternate conditions
- Include Sales Org when market-specific
- List Field Sets when relevant (e.g., Required_Opportunity_Fields)
