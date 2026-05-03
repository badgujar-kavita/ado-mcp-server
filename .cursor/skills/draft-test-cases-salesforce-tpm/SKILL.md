---
name: draft-test-cases-salesforce-tpm
description: Generate complete, precise, non-ambiguous test cases in Azure DevOps format from User Story Acceptance Criteria and Confluence Solution Design. Use when drafting test cases, running draft_test_cases or create_test_cases commands, or when the user asks to draft test cases for a User Story.
---

# Draft Test Cases — QA Architect Methodology

You are a Senior QA Test Designer. Generate complete, precise, and non-ambiguous test cases in Azure DevOps format by combining User Story Acceptance Criteria with Confluence Solution Design.

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

## Context Inputs from `get_user_story`

When building a draft, consume the full context object in this priority order:

1. **`namedFields` (primary)** — Title, Description, Acceptance Criteria, Solution Notes, Impact Assessment, Reference Documentation. Use `plainText` for analysis. These drive the Test Coverage Matrix.

2. **`fetchedConfluencePages[].body` (primary)** — authoritative solution design content. When present, Solution Notes is usually the first entry; later ones are from Impact Assessment / Reference Documentation / other custom fields.

3. **`embeddedImages[]` and `fetchedConfluencePages[].images[]` (visual evidence)** — wireframes, screenshots, diagrams. When available, describe what they show in the Functionality Process Flow section. Reference each via `originalUrl` as a markdown link. Never describe UI from memory when an image is available.

4. **`allFields` (supporting)** — every other populated ADO field. Scan for test-design-relevant signals: `Custom.NonFunctional` (boolean — triggers NFR scenarios), `*Dependency` flags (set integration scope), `Microsoft.VSTS.Common.Priority` (priority hint for generated test cases), `System.Tags`, persona / region flags. Never invent meaning for unrecognized fields; mention them and ask.

5. **`unfetchedLinks[]` (safety)** — SharePoint, Figma, LucidChart, GoogleDrive, cross-instance Confluence. BEFORE generating test cases, show the user which links were not fetched + the reason + the workaround. Ask whether to proceed or wait for manual content.

---

## Step 1 — Analyze the User Story

**Extract from Acceptance Criteria:**

- Functional behavior
- Field updates
- Status transitions
- Configuration dependency
- Scope-specific dependency (for example market, region, business unit, tenant, channel, or sales organization when explicitly documented)
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
| Configuration variables | Trigger statuses, target state, feature toggle, scope-specific behavior documented in requirements |
| Conditional flows | Validation enabled vs disabled |
| Fixed elements | Required field must not be blank; OR logic (not AND); Skip processing if config missing |

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
| A. Scope/config variations | Different documented region, business unit, market, tenant, or similar scope configs |
| B. Trigger field scenarios | Each configured trigger field |
| C. Status scenarios | All relevant status transitions |
| D. Configuration logics | Config present vs missing; enabled vs disabled |
| E. Backward compatibility | If applicable |

**If any category is not covered → generate additional test cases.**

---

## Step 5 — Strict Rules

1. NEVER skip configuration-based scenarios
2. ALWAYS consider scope-specific configuration documented in the requirements
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
    A[User moves record to Approved] --> B{Validation feature enabled?}
    B -->|TRUE| C[Evaluate configured eligibility rules]
    B -->|FALSE| D[Skip validation and continue]
    C --> E{Rules satisfied?}
    E -->|Yes| F[Complete transition]
    E -->|No| G[Block transition and show validation message]
```

**DO NOT use Mermaid for:**

- Object relationships / data model diagrams when relationships are NOT explicitly documented in Solution Design
- Technical dependencies between classes, triggers, or components that you are inferring from code snippets
- Any diagram where you would need to GUESS connections between objects or systems

**When details are insufficient for a Mermaid diagram**, use a text-based flow instead:
```
1. User changes the record to the target status
2. System checks whether the relevant validation/configuration is enabled
3. If enabled -> system evaluates the documented business rules
4. System either completes the transition or blocks it with the expected message
```

**Golden Rule:** Diagram what is documented. If you are unsure about any relationship or dependency, ask the user or fall back to text-based flow for that part.

### 2. Test Coverage Insights

Classify every coverage scenario derived from the coverage matrix (Step 4) into a structured table.

For each scenario, provide:
- **scenario**: Concise description of the logic branch or test condition
- **covered**: `true` if a test case covers it, `false` if not yet covered
- **positiveNegative**: `P` (Positive/happy path) or `N` (Negative/error path)
- **functionalNonFunctional**: `F` (Functional) or `NF` (Non-Functional)
- **priority**: `High`, `Medium`, or `Low`
- **notes**: Optional, keep extremely concise (e.g., "Missing config case", "Deferred")

Pass these as the `testCoverageInsights` array to `save_tc_draft`. The formatter auto-computes a Coverage Summary (total, covered count, coverage %, P/N and F/NF distribution) and renders emoji indicators for instant visual scanning:
- Covered: ✅ / ❌
- P/N: 🟢 P / 🔴 N
- F/NF: 🔵 F / 🟣 NF
- Priority: 🔴 High / 🟡 Medium / 🟢 Low

If any scenario has `covered: false` → generate an additional test case to cover it.

---

## Step 7 — Config Summary for Prerequisites

Add config summary to **Pre-requisite** (Prerequisite for Test field) in technical format. Example:

```
* Context.BusinessUnit IN [Primary, Secondary]
* FeatureConfig.RequiredFields != NULL
* FeatureConfig.ValidationEnabled = TRUE
* WorkflowRule.TargetStatus = Approved
* Entity.TemplateMapping != NULL
* Validation field set is available
```

Adapt to the specific US and Solution Design.

---

## Step 8 — Output Format

Follow existing project conventions:

- **Format:** See `docs/test-case-writing-style-reference.md` and `conventions.config.json`
- **Title:** `TC_{USID}_{##} -> [Feature Tag] -> [Sub-Feature/Context] -> Verify that [Action/Verification]` (≤ 256 chars). Keep it simple, clear, and to the point.
- **Feature Tags:** Use generic feature tags derived from the Acceptance Criteria and documented business language. Do not assume project-specific entities unless they appear in the source material.
- **Expected results (AUTOMATION-FRIENDLY):** Use "should" form with structured, measurable outcomes. When a single test step produces multiple validations, format as a numbered list using automation-friendly patterns:
  - **Field validation:** `Object.Field__c should = Value` (e.g., `Promotion.Status__c should = Adjusted`)
  - **UI element:** `UI_Element should be state` (e.g., `Edit button should be enabled`)
  - **Action outcome:** `Action should outcome` (e.g., `Save action should succeed`)
  - **Message/Error:** `Message should [not] be displayed` (e.g., `Error message should = "Required fields missing"`)
  - **Rule logic:** `Rule Order N: condition → outcome should happen` (e.g., `Rule Order 1: Category = Technical → Technical Queue should be assigned`)
  - **Avoid vague:** NEVER use "should work properly", "appropriate access", "should be correct"
  - **Single outcomes:** Use simple form: `you should be able to do so` or single assertion
- **Steps:** Imperative actions; use `**bold**` for emphasis; use "A. X B. Y" or "A. X<br>B. Y" for multi-point expected results (server converts to proper lists)
- **Personas:** Use the configured default personas for the active project. Include them consistently unless the project conventions or source material explicitly require a different set.
- **Pre-requisite:** Object.Field = Value; use `[Config should be setup/available]` when config is required

---

## QA Architect Mindset

When generating test cases, think:

- Scope/configurable logic
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
