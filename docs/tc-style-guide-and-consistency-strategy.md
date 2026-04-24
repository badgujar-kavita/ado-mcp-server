# Test Case Style Guide & AI Consistency Strategy

**Purpose:** Ensure AI-generated test cases match existing ADO test case styling, formatting, and parameters so TCs are consistent across the application with minimal manual rework.

**Reference:** Test Plan GPT_D-HUB (ID: 1066479), Root Suite ID: 1066480. Sample TCs analyzed: 1285303, 1285313, 1282655 (US 1245456).

---

## 1. Observed Patterns from Existing TCs

### 1.1 Title Format

| Element | Pattern | Example |
|---------|---------|---------|
| Structure | `TC_{USID}_{##} -> [Feature Tag] -> [Sub-Feature/Context] -> Verify that [Action/Verification]` | `TC_1342896_01 -> Promotion Management -> Review Status -> Verify that enabling LOA selection for the L1 Approval stage renders the LOA lookup` |
| Separator | ` -> ` (space, hyphen, space) | |
| Feature tags | Generic, based on AC (e.g. "Promotion Management", "Account Management") | "Promotion Management", "Fund Management" |
| Role in title | Omit or simplify | |
| Use case summary | Sentence case, describes outcome | |

**Convention vs. current config:** `conventions.config.json` uses `separator: " -> "` — matches. Feature tags should be generic and standardized (e.g., Promotion Management, Account Management, Product Management, Fund Management).

### 1.2 Step Structure

| Element | Pattern | Example |
|---------|---------|---------|
| Action | Imperative, concise (1–2 lines) | "Login as KAM User" |
| Expected (setup) | "you should be able to do so" for navigation/setup | |
| Expected (validation) | Specific outcome; "User should..." when describing user-visible result | "User should be able to validate that inactive funds are not shown to the user and user is not able to link them to the tactic." |
| Step count | Typically 4–7 steps | |

**Rules:**
- Setup steps (login, create record, navigate): use "you should be able to do so" or similar.
- Validation steps: describe the observable outcome clearly.
- Avoid overly long actions; split if needed.

### 1.3 Prerequisites (Custom.PrerequisiteforTest)

**Formatting:** The MCP server outputs ADO-compatible HTML (`<div>`, `<strong>`, `<ul>`, `<ol>`, `<li>`). See `docs/prerequisite-formatting-instruction.md` and `docs/prerequisite-formatting-ado.md`.

**Note:** The `TO BE TESTED FOR` section has been permanently removed as of 2026-04-15 to reduce verbosity and improve scannability.

**Persona section:** Reflects the configured default personas for the active project. The current project commonly uses System Administrator, ADMIN User, and KAM, but the implementation guidance should treat these as configured examples rather than universal defaults.
- Ordered list format (HTML `<ol>`).
- Each persona: **Bold label** with nested sub-items for the configured persona metadata (for example `TPM Roles`, `Profile`, `PSG` in the current project).
- Personas observed in the current project: "ADMIN User" User, Key Account Manager (KAM) User.
- System Administrator not always present; include when admin validation is needed.

**Pre-requisite section:** (Always unique per user story; never from config.)
- Ordered list.
- **MANDATORY condition-based format** (as of 2026-04-15):
  - **Technical format:** `Object.Field = Value` (e.g., `Promotion.Status = Adjusted`, `CustomerManager.Access__c = Edit`)
  - **Operators:** `!=`, `CONTAINS`, `IN`, `= TRUE/FALSE`
  - **Special types:** `CustomLabel = Value`, `CustomMetadataType.Field = Value`, `CustomSetting.Field = Value`
  - **Narrative with context:** Only when describing scenario setup (e.g., `Entity without X config OR record for which no mapping exists`)
  - **Vague phrasing:** Use only as last resort when condition format is not expressible (e.g., `Setup or configuration is required`)
- See `docs/implementation.md` (Prerequisite Writing Standard) and `.cursor/skills/test-case-asset-manager/SKILL.md` for full details.

### 1.4 Other Parameters

| Field | Value |
|-------|-------|
| Priority | 2 (default) |
| State | Design (new) |
| Automation Status | Not Automated |
| ADO Prerequisite field | `Custom.PrerequisiteforTest` (not System.Description) |

---

## 2. Gaps: AI Output vs. Existing TCs

| Aspect | Current AI Output | Existing ADO Style | Gap |
|--------|-------------------|--------------------|-----|
| Feature tags | Long ("Promotion Re Approval", "Tactic Rate Change Trigger") | Short ("Tactic Card", "Fund selection screen") | AI uses verbose tags |
| Step expected (setup) | "Promotion record is displayed." | "you should be able to do so" | Different phrasing |
| Pre-requisite format | Strict technical only | Mix of technical + narrative with [context] | AI too rigid |
| Persona in title | Often omitted | "Verify as KAM User" when KAM-specific | AI doesn't add role to title |
| Use case summary | Full sentence | Often shorter, outcome-focused | Minor |

---

## 3. Strategy & Implementation Plan

### Phase 1: Config & Convention Updates (Low Effort)

1. **Add style rules to `conventions.config.json`:**
   - `testCaseTitle.featureTagMaxWords`: 4 (keep tags short).
   - `testCaseTitle.includeRoleWhenSinglePersona`: true (add "Verify as {Role}" when TC uses one persona).
   - `stepPhrasing.setupExpectedDefault`: "you should be able to do so".
   - `stepPhrasing.validationPrefix`: "User should" or "User should be able to" for user-visible outcomes.

2. **Add `preConditionFormat.allowNarrativeWithContext`:**
   - When a condition needs setup context, use: `{Condition} [ {Context} ]`.
   - Example: `Tactic Template has default fund selected [ Tactic Template -> Fund Template -> Inactive Fund is present ]`.

3. **Document ADO field mapping:**
   - Prerequisites → `Custom.PrerequisiteforTest` (verify project uses this; some use System.Description).
   - Ensure `buildPrerequisitesHtml` output matches existing HTML structure (h2, ol, nested lists).

### Phase 2: Prompt & Draft Enhancements (Medium Effort)

4. **Update `draft_test_cases` and `create_test_cases` prompts:**
   - Add explicit instructions:
     - "Use generic feature tags based on Acceptance Criteria (e.g., Promotion Management, Account Management, Product Management, Fund Management)."
     - "For setup steps, use expected result: 'you should be able to do so'."
     - "For validation steps, start expected result with 'User should' when describing user-visible outcome."
     - "Keep titles simple, clear, and to the point. Omit or simplify persona in the title to save space."
     - "Pre-requisites: Prefer technical format (Object.Field = Value). When setup context is needed, use: Condition [ Context ]."

5. **Add TC style examples to prompt context:**
   - Include 1–2 real TC examples (title + 2 steps + prerequisites snippet) in the prompt so the model sees the target style.

### Phase 3: Reference Data & Tooling (Higher Effort)

6. **`list_tc_style_samples` tool (new):**
   - Fetches N sample test cases from a given plan/suite.
   - Returns: title, steps (action/expected), prerequisites (stripped HTML).
   - Used at draft time to inject style examples into the prompt.

7. **`tc_style_reference` config or file:**
   - Optional JSON/MD file with curated examples.
   - Loaded when generating drafts; ensures consistency even if ADO samples change.

8. **Validation step (optional):**
   - Before `push_tc_draft_to_ado`, run lightweight checks:
     - Title matches `TC_{USID}_{##} -> ...` pattern.
     - Feature tags length.
     - Step expected phrasing for setup vs. validation.
   - Report deviations; user can revise before push.

### Phase 4: Continuous Improvement

9. **Periodic style audit:**
   - Quarterly: Fetch 20–30 TCs from plan 1066479, extract patterns, update conventions.config and prompts.

10. **Feedback loop:**
    - Track manual edits post-push (if ADO supports revision diff).
    - Use common edits to refine prompts and config.

---

## 4. Quick Wins (Immediate)

| Action | Impact | Effort |
|--------|--------|--------|
| Update prompts with style rules (Phase 2.4) | High | Low |
| Add `stepPhrasing` to conventions.config | Medium | Low |
| Shorten default feature tags in draft examples | Medium | Low |
| Verify Custom.PrerequisiteforTest vs System.Description | High | Low |

---

## 5. ADO Field Verification (Critical) — Implemented

**Finding:** Existing TCs in plan 1066479 use **Custom.PrerequisiteforTest** for Persona + Pre-requisite content.

**Implementation:** Added `prerequisiteFieldRef` to `conventions.config.json` (set to `"Custom.PrerequisiteforTest"`). Both `createTestCase` and `update_test_case` now write prerequisites to the configured field, with fallback to `System.Description` when not set.

---

## 6. Summary

To maximize consistency with existing TCs:

1. **Config:** Add step phrasing defaults and pre-condition format options.
2. **Prompts:** Add explicit style rules and 1–2 example TCs.
3. **Field mapping:** Verify and fix prerequisite field (Custom.PrerequisiteforTest vs System.Description).
4. **Tooling (optional):** Add style-sample fetcher and validation.

Implementing Phase 1 and Phase 2 will yield the largest improvement with minimal effort.

---

## 7. Recent Enhancements (2026-04-15)

### Test Case Asset Management

Test case drafts now follow a structured folder convention:
- **Folder structure:** `tc-drafts/US_<ID>/` containing three files per User Story
- **Main draft:** `US_<ID>_test_cases.md` with links to supporting documents
- **Solution summary:** `US_<ID>_solution_design_summary.md` (11-section structured analysis)
- **QA cheat sheet:** `US_<ID>_qa_cheat_sheet.md` (40-60 lines, scannable quick reference)

See `.cursor/skills/test-case-asset-manager/SKILL.md` for full structure rules.

### Automation-Friendly Expected Results

Expected results now use automation-friendly patterns:
- **Field validation:** `Object.Field should = Value`
- **UI element:** `UI_Element should be state`
- **Action outcome:** `Action should outcome`
- **Message/error:** `Message should [not] be displayed`
- **Rule logic:** `Rule Order N: condition → outcome should happen`

See `docs/automation-friendly-test-patterns.md` for complete reference with pseudocode mappings.

### Prerequisite Standard

All prerequisites must use **condition-based format** (Object.Field = Value, !=, CONTAINS, IN). Vague language ("setup is configured") only as last resort. See `docs/implementation.md` (Prerequisite Writing Standard).
