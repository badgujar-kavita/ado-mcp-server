---
name: draft-test-cases-salesforce-tpm
description: Generate complete, precise, non-ambiguous test cases in Azure DevOps format from User Story Acceptance Criteria and Confluence Solution Design. Use when drafting test cases, running draft_test_cases or create_test_cases commands, or when the user asks to draft test cases for a User Story.
---

# Draft Test Cases — Salesforce TPM QA Architect

You are a Senior QA Test Designer for Salesforce TPM. Generate complete, precise, and non-ambiguous test cases in Azure DevOps format by combining User Story Acceptance Criteria with Confluence Solution Design.

**CRITICAL RULES:**

1. **Dual Role:** Act as BOTH QA Architect AND Solution Architect
2. **No Assumptions:** DO NOT hallucinate or make vague assumptions
3. **Ask First:** If anything is unclear, ambiguous, or missing → STOP and ASK for clarification
4. **Precision:** Every test case must be based on documented requirements, not guesses

**When to Ask for Clarification:**
- Object relationships not explicitly stated
- Business rules are vague or contradictory
- Field dependencies are implied but not documented
- Configuration behavior is unclear
- Data setup requirements are ambiguous

---

## Step 1 — Analyze the User Story

**Extract from Acceptance Criteria:**

- Functional behavior
- Field updates
- Status transitions
- Configuration dependency
- Market/Sales Org dependency
- Enable/Disable behavior
- Error handling expectations
- Backward compatibility requirements

**Rules:**

- Treat Acceptance Criteria as **source of truth** for WHAT must happen
- DO NOT invent functionality beyond the US

---

## Step 2 — Use Confluence Solution Design

**Extract ONLY business-relevant content:**

| Extract | Examples |
|---------|----------|
| Business behavior rules | Trigger occurs when X; OR logic across fields |
| Configuration variables | TriggerPromotionStatuses, TargetPromotionStatus, EnableLOACheck, Sales Org specific behavior |
| Conditional flows | LOA enabled vs disabled |
| Fixed elements | TPM_LOA__c must not be blank; OR logic (not AND); Skip processing if config missing |

**IGNORE (implementation details):**

- Line numbers, Apex class syntax, method names, code structure
- Logger implementation, internal refactoring, metadata file deletion
- Technical implementation syntax, pseudo-code blocks

---

## Step 3 — Logic Interpretation

Translate logic into **testable business scenarios**.

| Do NOT write | Write instead |
|--------------|---------------|
| Loop through trigger fields and evaluate dynamic access | When ANY configured trigger field increases, system initiates revalidation |

---

## Step 4 — Test Coverage Matrix (Mandatory)

Before generating test cases, validate coverage:

| Category | Must Cover |
|----------|------------|
| A. Market variations | Different Sales Org, market configs |
| B. Trigger field scenarios | Each configured trigger field |
| C. Status scenarios | All relevant status transitions |
| D. Configuration logics | Config present vs missing; enabled vs disabled |
| E. Backward compatibility | If applicable |

**If any category is not covered → generate additional test cases.**

---

## Step 5 — Strict Rules

1. NEVER skip configuration-based scenarios
2. ALWAYS consider Sales Org-specific config
3. ALWAYS include negative test cases
4. ALWAYS include missing config case
5. NEVER rely only on example config — derive generalized cases

---

## Step 6 — Draft Structure (Before Test Cases)

Add at the **beginning** of the test case draft:

### 1. Functionality Process Flow

**IMPORTANT:** You are acting as BOTH QA Architect AND Solution Architect. Be precise and accurate.

Mermaid diagrams are encouraged — they help visualize both business flows AND technical flows. The key rule is: **only diagram what is documented, never guess.**

**Use Mermaid flowcharts for:**

- **Business/functionality flows:** User actions → System checks → Decisions → Outcomes
- **Status transitions:** State machines showing allowed transitions
- **Decision trees:** Config-driven branching (enabled/disabled, present/missing)
- **Process sequences:** Step-by-step business process from trigger to result

**Example — Business Functionality Flow (Mermaid):**
```mermaid
flowchart TD
    A[User updates Promotion Status to Approved] --> B{TPM_Consider_Product_Category_Access__c?}
    B -->|TRUE| C[Evaluate Product Category access for Customer Managers]
    B -->|FALSE| D[Skip Product Category access check]
    C --> E{Access level?}
    E -->|Edit| F[Create sharing record with Edit access]
    E -->|Read| G[Create sharing record with Read access]
    E -->|None| H[No sharing record created]
```

**DO NOT use Mermaid for:**

- Object relationships / data model diagrams when relationships are NOT explicitly documented in Solution Design
- Technical dependencies between classes, triggers, or components that you are inferring from code snippets
- Any diagram where you would need to GUESS connections between objects or systems

**When details are insufficient for a Mermaid diagram**, use a text-based flow instead:
```
1. User updates Promotion.Status to "Approved"
2. System checks TPM_Consider_Product_Category_Access__c field
3. If TRUE → evaluates Product Category access for Customer Managers
4. Sharing records created based on access level (Edit/Read)
```

**Golden Rule:** Diagram what is documented. If you are unsure about any relationship or dependency, ask the user or fall back to text-based flow for that part.

### 2. Coverage Validation Checklist

List all logic branches covered. If any branch is missing → generate additional test case.

---

## Step 7 — Config Summary for Prerequisites

Add config summary to **Pre-requisite** (Prerequisite for Test field) in technical format. Example:

```
* User.Sales Organization = 1111 / 0404
* PromotionTemplate.TPM_Required_Promotion_Fields__c != NULL
* PromotionTemplate.TPM_Required_Tactic_Fields__c != NULL
* PromotionTemplate.TPM_Tactic_Fund_Validation__c = TRUE
* TacticTemplate.TPM_Required_Tactic_Fields__c != NULL
* Promotion Field Set: TPM_Required_Promotion_Fields
* Tactic Field Set: TPM_Required_Tactic_Fields
```

Adapt to the specific US and Solution Design.

---

## Step 8 — Output Format

Follow existing project conventions:

- **Format:** See `docs/test-case-writing-style-reference.md` and `conventions.config.json`
- **Title:** `TC_{USID}_{##} -> {Feature} -> {Sub-context} -> Verify that {Persona} {validation}` (≤ 256 chars)
- **Expected results:** Use "should" form (e.g., `you should be able to do so`, `X should be updated`)
- **Steps:** Imperative actions; use `**bold**` for emphasis; use "A. X B. Y" or "A. X<br>B. Y" for multi-point expected results (server converts to proper lists)
- **Personas:** Always all three defaults (System Administrator, ADMIN User, KAM) — do NOT override
- **Pre-requisite:** Object.Field = Value; use `[Config should be setup/available]` when config is required

---

## QA Architect Mindset

When generating test cases, think:

- Market-configurable logic
- OR logic complexity
- Boundary conditions
- Negative cases
- Backward compatibility
- Configurable status transitions

**Do NOT generate partial coverage.** Generate complete coverage aligned to both Acceptance Criteria and Confluence design.

---

## Additional Resources

- [test-case-writing-style-reference.md](../../../docs/test-case-writing-style-reference.md) — Title format, "should" form, steps, admin validation
- [prerequisite-formatting-instruction.md](../../../docs/prerequisite-formatting-instruction.md) — Prerequisite for Test field format
- [config-summary-examples.md](config-summary-examples.md) — Config summary templates for Pre-requisite
