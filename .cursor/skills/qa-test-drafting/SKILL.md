---
name: qa-test-drafting
description: Generate complete, precise, non-ambiguous test cases in Azure DevOps format from User Story Acceptance Criteria and Confluence Solution Design. Use when drafting test cases, running qa-draft or qa-publish commands, or when the user asks to draft test cases for a User Story.
---

# Draft Test Cases — QA Skill

This skill is a general QA drafting skill. Salesforce-specific examples below illustrate the patterns; apply the same rules to any domain.

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

## Context Inputs from `ado_story`

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

Follow the detailed rules in the dedicated section below (§ Functionality Process Flow — Authoring Rules) to decide between Mermaid and numbered text-block format, and to ensure every flow ends with a terminal observable state.

### 2. Test Coverage Insights

Classify every coverage scenario derived from the coverage matrix (Step 4) into a structured table.

For each scenario, provide:
- **scenario**: Concise description of the logic branch or test condition
- **covered**: `true` if a test case covers it, `false` if not yet covered
- **positiveNegative**: `P` (Positive/happy path) or `N` (Negative/error path)
- **functionalNonFunctional**: `F` (Functional) or `NF` (Non-Functional)
- **priority**: `High`, `Medium`, or `Low`
- **notes**: Optional, keep extremely concise (e.g., "Missing config case", "Deferred")

Pass these as the `testCoverageInsights` array to `qa_draft_save`. The formatter auto-computes a Coverage Summary (total, covered count, coverage %, P/N and F/NF distribution) and renders emoji indicators for instant visual scanning:
- Covered: ✅ / ❌
- P/N: 🟢 P / 🔴 N
- F/NF: 🔵 F / 🟣 NF
- Priority: 🔴 High / 🟡 Medium / 🟢 Low

If any scenario has `covered: false` → generate an additional test case to cover it.

---

## Functionality Process Flow — Authoring Rules

Every draft MUST include a `## Functionality Process Flow` section near the top. Choose the format based on the logic being documented:

### Use Mermaid diagrams WHEN:
- The decision logic is clean (single trigger → evaluation → outcome branches)
- All decision points have documented (not inferred) criteria
- The flow fits cleanly in 5–8 nodes (larger diagrams hurt readability)
- Business flow with clear actor → action → system response

### Use numbered text-block format WHEN:
- Decision logic has multiple interacting paths (e.g., Path A + Path B with short-circuiting)
- Variations within a flow matter (Variation A, Variation B, Variation C)
- Mermaid would require too many branches to remain readable
- Configuration-sensitive behavior (e.g., flag TRUE vs FALSE changes outcome)
- Multi-persona handoffs with conditional state transitions

### Required elements in EVERY flow block (Mermaid or text):

1. **Actor / entry point** — who triggers it (KAM User, Admin, System, Scheduled Job, etc.)
2. **Action chain** — sequential `→` arrows showing steps, indented under the actor
3. **Bracketed variations** where applicable: `[Variation A: ...]` `[Variation B: ...]` — cover all documented paths
4. **Terminal state** — every flow MUST end with an observable, documented state:
   - `Status: X → Y` (status transition)
   - `Record locks (read-only)` OR `Record stays unlocked (editable)`
   - `Re-Approval fires` OR `Stays Adjusted`
   - `Notification sent` / `Webhook delivered` / `Record created`
5. **Numbered Flow headings** when there are multiple flows — `### Flow 1 — ...`, `### Flow 2 — ...`

### Quality checks (self-review before saving):

- [ ] Every flow ends with a TERMINAL observable state — not a "next step" placeholder
- [ ] Bracketed variations cover ALL documented paths (not just the happy path)
- [ ] No guessed transitions — if Solution Design doesn't document a step, label it `(to confirm)` or omit
- [ ] Naming is consistent (same field names, same tool names as Solution Design)
- [ ] If you used Mermaid, re-read it — does it faithfully represent all documented logic? If it simplifies too much, switch to numbered text blocks

### Reference exemplar:

The draft at `tc-drafts/US_1370221/US_1370221_test_cases.md` (Flows 1–5) demonstrates the correct numbered-text-block format for multi-path, config-sensitive behavior.

### Anti-patterns to AVOID:

- ❌ Flow ends mid-chain without a terminal state (reader left wondering "what happens next?")
- ❌ Mermaid diagram that glosses over a documented variation (be faithful, not pretty)
- ❌ Mixing Mermaid + text in the same flow (pick one per flow)
- ❌ Using Mermaid when the Solution Design only loosely sketches behavior — write text-based flows when in doubt
- ❌ Guessing an outcome — when unsure, write `→ (expected behavior to be confirmed with Solution Design author)`

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
