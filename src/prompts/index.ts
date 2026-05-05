import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  INTERACTIVE_READ_CONTRACT,
  DIAGNOSTIC_CONTRACT,
  CONFIRM_BEFORE_ACT_CONTRACT,
  OPTION_SELECTION_CONTRACT,
} from "./shared-contracts.ts";

export function registerAllPrompts(server: McpServer) {
  server.registerPrompt("ado-connect", {
    title: "Connect to Azure DevOps",
    description: "Set up ADO and Confluence credentials via a guided web UI",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "Launch the configuration UI using the ado_connect tool. This opens a web interface where I can enter my Azure DevOps and Confluence credentials, test the connections, and save them securely.",
      },
    }],
  }));

  server.registerPrompt("ado-check", {
    title: "Check ADO Setup Status",
    description: "Verify ADO credentials, Confluence config, and server health",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "Check if the VortexADO MCP server is fully configured using the ado_check tool. Show the current setup status and, when appropriate, the first-run welcome or version update message.",
          "",
          DIAGNOSTIC_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("ado-plans", {
    title: "List Test Plans",
    description: "List all test plans in the ADO project",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "List all test plans in the project using the ado_plans tool. Show results in a table with ID, name, area path, state, and root suite ID.",
          "",
          INTERACTIVE_READ_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("ado-story", {
    title: "Read User Story",
    description: "Fetch a User Story — fields, Confluence pages, images, and links",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to fetch a User Story from ADO. Ask me for the work item ID, then use the ado_story tool.",
          "",
          "Present a structured summary in this order:",
          "1. **Primary fields** — title, description, acceptance criteria, area path, iteration path, state, parent info.",
          "2. **Named context fields** (`namedFields`) — every rich-text field from the primary allowlist + configured `additionalContextFields`. Show label + concise plainText snippet.",
          "3. **Confluence content** (`fetchedConfluencePages[]`) — for each fetched page, show title + URL + a 2-3 line body summary.",
          "4. **Images** — total count from `embeddedImages[]` + `fetchedConfluencePages[].images[]`. Note how many were skipped and why.",
          "5. **Unfetched links** (`unfetchedLinks[]`) — if any, list them with URL + type + reason + workaround. Flag these clearly so I can decide whether to paste content manually.",
          "6. **Other populated fields** (`allFields`) — scan for test-design-relevant signals (Custom.NonFunctional, *Dependency flags, priority, tags, persona/region flags); mention any that look relevant without inventing meaning.",
          "",
          "Keep each section short — this is a summary, not a data dump. If anything meaningful is missing or empty, say so explicitly.",
          "",
          INTERACTIVE_READ_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("qa-tests", {
    title: "List Test Cases for User Story",
    description: "List test cases linked to a User Story (Tests/Tested By)",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to list test cases linked to a User Story. Ask me for the User Story ID, then use the qa_tests tool. Show the linked test case IDs in a numbered list with clickable webUrl links when present.",
          "",
          INTERACTIVE_READ_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("ado-plan", {
    title: "Read Test Plan",
    description: "Read a test plan by ID — area path, state, root suite",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to get details of a test plan. Ask me for the plan ID, then use the ado_plan tool. Show the name, area path, iteration, owner, state, and root suite ID.",
          "",
          INTERACTIVE_READ_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("ado-suites", {
    title: "List Test Suites",
    description: "List all test suites in a test plan",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to list all test suites in a test plan. Ask me for the plan ID, then use the ado_suites tool. Show results in a table with ID, name, suite type, parent suite ID, and hasChildren.",
          "",
          INTERACTIVE_READ_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("ado-suite", {
    title: "Read Test Suite",
    description: "Read a test suite by ID — type, parent, query string",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to get details of a test suite. Ask me for the plan ID and suite ID, then use the ado_suite tool.",
          "",
          INTERACTIVE_READ_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("qa-suite-setup", {
    title: "Set Up Suite Hierarchy",
    description: "Create or fix the Sprint → Epic → US suite hierarchy from a User Story ID",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to ensure the test suite folder structure for a User Story. Ask only for the User Story ID. Use qa_suite_setup — it derives plan and sprint from the US AreaPath and Iteration, creates folders if missing, and updates naming if wrong format.",
          "",
          "If plan or sprint resolution fails, the tool returns a structured needs-input response with a suggestion to provide planId or sprintNumber overrides.",
          "",
          "**Override mismatch handling:** If the tool returns `status: \"needs-confirmation\"` with `reason: \"override-mismatch\"`, the user provided a planId or sprintNumber that doesn't match the US's auto-derived values. Show the mismatch details and present exactly two options:",
          "  1. **Confirm override** — re-run with confirmMismatch: true to force creation in the overridden plan",
          "  2. **Use auto-derived** — re-run without the planId/sprintNumber overrides",
          "",
          OPTION_SELECTION_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("qa-suite-update", {
    title: "Update Test Suite",
    description: "Update a test suite — rename, move, or change its query",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to update a test suite.",
          "",
          "**Preferred:** If this is for a User Story, ask only for the User Story ID. Use qa_suite_setup — it checks if folders exist, creates if missing, and updates naming if wrong format.",
          "",
          "**Alternative:** If updating a specific suite by ID, ask for plan ID and suite ID, show current state with ado_suite, then use qa_suite_update with the fields to change.",
          "",
          CONFIRM_BEFORE_ACT_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("qa-suite-delete", {
    title: "Delete Test Suite",
    description: "Delete a test suite — test cases stay in ADO, only the suite link is removed",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to delete a test suite. Ask me for the plan ID and suite ID, then confirm with: 'Delete suite {id} from plan {planId}? Reply **YES** to delete, **no** to cancel, or tell me what you'd like instead.' Apply the consent rule from AGENTS.md — do not proceed on ambiguous replies. On affirmative, use the qa_suite_delete tool. Note: Test cases in the suite are not deleted—only their association with the suite is removed.",
          "",
          CONFIRM_BEFORE_ACT_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("qa-draft", {
    title: "Draft Test Cases",
    description: "Draft test cases as reviewable markdown — never pushes to ADO",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to draft test cases for a User Story.",
          "",
          "IMPORTANT: You are acting as BOTH QA Architect AND Solution Architect. Be precise and accurate. DO NOT hallucinate or make vague assumptions. If something is unclear or missing from the US/Solution Design, ASK for clarification instead of guessing.",
          "",
          "Apply BOTH skills:",
          "1. .cursor/skills/qa-test-assets/SKILL.md for folder structure (tc-drafts/US_<ID>/), file organization, and supporting documents (solution summary, QA cheat sheet).",
          "2. .cursor/skills/qa-test-drafting/SKILL.md for content quality: analyze US + Solution Design, validate coverage matrix, add Functionality Process Flow and Test Coverage Insights at the start of the draft, then generate test cases.",
          "For Test Coverage Insights: classify each scenario with covered (true/false), P/N (Positive/Negative), F/NF (Functional/Non-Functional), Priority (High/Medium/Low), and optional Notes. Pass as testCoverageInsights array to qa_draft_save. The formatter auto-computes the coverage summary.",
          "Derive business terminology and scope dimensions from the actual User Story and Solution Design. Do not assume TPM-specific terms such as Sales Org, Promotion, or KAM unless they are explicitly documented for the current project.",
          "",
          "Please:",
          "1. Ask me for the user story ID only (Test Plan ID will be auto-derived from US AreaPath during push).",
          "2. Fetch the user story using the ado_story tool (includes Solution Design if linked).",
          "   a. Read the US fully. Primary inputs are `namedFields[*].plainText` (Title, Description, Acceptance Criteria, Solution Notes, Impact Assessment, Reference Documentation) and `fetchedConfluencePages[].body` (authoritative Solution Design content). The legacy top-level `description`, `acceptanceCriteria`, and `solutionDesignContent` fields are still present and equivalent — use whichever is convenient.",
          "   b. When Solution Design is present, apply the usage rules from conventions.config.json solutionDesign section:",
          "      - USE: Business process, functionality context, new fields (Object.Field__c), new configurations, pre-requisite conditions (technical format), admin validation TCs.",
          "      - IGNORE: Code snippets, Apex/JavaScript/LWC, implementation details, deployment steps. Do not use coding parts in test cases.",
          "      - Extract new fields and config from SD; add them to pre-requisites in technical format (Object.Field = Value).",
          "      - For each new field or config introduced, create a System Administrator validation test case: verify the field/setting is accessible and present in the system.",
          "   c. If anything is unclear, ambiguous, or missing (e.g., unclear dependencies, missing object relationships, vague business rules), STOP and ASK the user for clarification before proceeding.",
          "   d. Consume the full context payload. `ado_story` now returns five additional fields beyond the primary text:",
          "      - `namedFields` — a keyed map of the primary rich-text fields (Title, Description, Acceptance Criteria, Solution Notes, Impact Assessment, Reference Documentation if configured). Each entry has `label` (UI label), `html` (raw ADO HTML), `plainText` (markdown-ish text). Use `plainText` for reading; use `html` only if you need to detect `<img>` markers. These are your PRIMARY inputs for test design.",
          "      - `allFields` — every other populated ADO field on this work item (system-noise filtered). Scan for custom fields the team has configured that look relevant: `Custom.NonFunctional` (boolean — if true, include NFR test scenarios), `Custom.*Dependency` flags (determine integration test scope), `Microsoft.VSTS.Common.Priority` (test case priority hint), `System.Tags`, region/persona flags, etc. Use as SUPPORTING context — do not invent meaning for fields you don't recognize. If a field's relevance is unclear, mention it in your draft and ASK the user whether it should influence test coverage.",
          "      - `fetchedConfluencePages[]` — every Confluence page linked from any context field that was successfully fetched. Each entry has `{ pageId, title, url, body, sourceField, images[] }`. Treat `body` as authoritative solution design content. Multiple pages may be present — the first is typically Solution Notes; later ones are from Impact Assessment / Reference Documentation / custom fields.",
          "      - `embeddedImages[]` — screenshots, wireframes, and diagrams embedded directly in ADO rich-text fields as `<img>` attachments. Each has `sourceField` (which ADO field it came from), `originalUrl` (clickable), `altText`, `mimeType`, `bytes`. If `skipped: \"fetch-failed\"` appears, the image was detected but couldn't be downloaded — tell the user their Confluence/ADO token may lack download permission, then proceed without it.",
          "      - `unfetchedLinks[]` — SharePoint, Figma, LucidChart, GoogleDrive, cross-instance Confluence, or other links that were detected but not fetched. Each has `url`, `type`, `sourceField`, `reason` (one of: cross-instance, non-confluence, access-denied, not-found, auth-failure, link-budget, time-budget), and `workaround` (instructions for the user). If `unfetchedLinks.length > 0`: BEFORE generating the draft, show the user a brief summary ('I found N links I could not fetch: {list with reason + workaround}') and ask whether they want to (a) proceed without those sources, or (b) paste in the content manually. Do not silently skip.",
          "   e. Reference images in the draft. When `embeddedImages` is non-empty (and any entry has no `skipped` flag), treat those images as visual evidence. Describe what the image conveys in the Functionality Process Flow section of your draft (e.g. 'The wireframe in AC shows a two-column layout with...'). Reference each image using its `originalUrl` as a markdown link so reviewers can click through. Same applies to `fetchedConfluencePages[].images[]`. If you cannot actually see the images (Phase H not enabled — only metadata is present), be honest: 'I have metadata for N images but have not been given their pixel content; I can describe them based on `altText` and `filename` only.'",
          "4. Functionality Process Flow — Mermaid diagrams are encouraged for visualizing business flows:",
          "   - USE Mermaid for: business/functionality flows (user actions → system checks → decisions → outcomes), status transitions, decision trees, process sequences.",
          "   - DO NOT use Mermaid for: object relationship/data model diagrams when relationships are NOT explicitly documented, or technical dependencies you are inferring from code.",
          "   - If you would need to GUESS any connection or dependency, use a text-based flow for that part instead.",
          "   - Golden rule: Diagram what is documented. Ask or fall back to text when unsure.",
          "5. Prerequisites rules (MANDATORY condition-based format):",
          "   - PERSONA: Use the configured default personas for the active project. Include them consistently; do not invent project-specific personas unless they are defined in project conventions or explicitly required by the source material.",
          "   - PRE-REQUISITE: Always unique per user story. Generate from US + Solution Design. MUST use condition-based format:",
          "     • Object.Field = Value (e.g. Promotion.Status = Adjusted, CustomerManager.Access__c = Edit)",
          "     • Object.Field != NULL, Object.Field = TRUE/FALSE",
          "     • Object.Field CONTAINS Value, Object.Field IN (Values)",
          "     • CustomLabel = Value, CustomMetadataType.Field = Value, CustomSetting.Field = Value",
          "   - Only as a last resort, if a condition cannot be expressed in these formats, fall back to minimal vague language (e.g. 'Setup or configuration is required'). Avoid over-generic phrases like 'Conditions are met' or 'Prerequisites are in place'.",
          "   - Use narrative only for scenario setup (e.g. 'Entity without X config OR record for which no mapping exists'). Use [Config should be setup/available] brackets when config must exist.",
          "6. Styling rules:",
          "   - Ensure all test case titles are ≤ 256 characters (ADO limit). Shorten featureTags or useCaseSummary if needed.",
          "   - Use \"should\" form for all expected results (e.g., \"you should be able to do so\", \"X should be updated\").",
          "   - Expected result AUTOMATION-FRIENDLY format: When a single test step produces multiple validations, format as a numbered list using automation-friendly patterns:",
          "     • Field validation: Object.Field__c should = Value (e.g., Promotion.Status__c should = Adjusted)",
          "     • UI element: UI_Element should be state (e.g., Edit button should be enabled)",
          "     • Action outcome: Action should outcome (e.g., Save action should succeed)",
          "     • Message/Error: Message should [not] be displayed (e.g., Error message should = \"Required fields missing\")",
          "     • Rule logic: Rule Order N: condition → outcome should happen",
          "     • Use specific targets (object.field, UI element names), clear operators (=, !=, CONTAINS, IN), measurable states (enabled, disabled, visible, hidden), deterministic outcomes (succeed, fail, be assigned).",
          "     • NEVER use vague: 'should work properly', 'appropriate access', 'should be correct'. Do NOT apply for single simple outcomes.",
          "   - Use <br> between numbered items in steps/expected results (e.g., \"Fields to validate:<br>1. X<br>2. Y\").",
          "7. Based on ALL available context (description, acceptance criteria, and Solution Design), propose test cases. If you need to make ANY assumptions about business logic, object relationships, or data dependencies, EXPLICITLY STATE your assumptions and ask the user to confirm before proceeding.",
          "8. Create organized US folder and all assets per qa-test-assets skill:",
          "   a. Call qa_draft_save for the main test cases file. This AUTOMATICALLY creates tc-drafts/US_<ID>/ folder and writes US_<ID>_test_cases.md with Supporting Documents links (auto-generated). Do NOT pass planId (auto-derived during push). Pass workspaceRoot or draftsPath.",
          "   b. Generate solution_design_summary content following the 11-section template (Purpose, Process, Decision Logic, Fields/Config, Setup Prerequisites as compact table with max 10 rows, Behavior by Scenario, etc.). Keep Section 6 (Setup Prerequisites) concise: use table format with Component → Required State, no exact formulas/error messages. Call qa_draft_doc_save with docType: 'solution_summary'.",
          "   c. Generate qa_cheat_sheet content — CRITICAL: Keep scannable (40-60 lines max). Use Decision Logic TABLE (Use Case | Config/Fields | Conditions | Outcome) instead of separate positive/negative sections. Include Quick Maps for field/value lookups. Max 5 setup items. Single debug order (6 steps max). Favor tables over prose. Call qa_draft_doc_save with docType: 'qa_cheat_sheet'.",
          "   d. Regression tests: when explicitly requested, generate per the SKILL §Regression Test Case Preparation and call qa_draft_doc_save with docType: 'regression_tests'.",
          "9. After creating all files, present a concise summary with file links prominently displayed: test cases, solution summary, and QA cheat sheet. Include: version, test case count, and key highlights (coverage checklist, process flow type [Mermaid/Text], TC breakdown by category).",
          "10. Remind the user: 'Plan ID will be auto-derived from the User Story when you push. Provide feedback for revisions, or run /vortex-ado/qa-publish when ready to push to ADO.'",
          "11. On feedback, revise and call qa_draft_save again (increment version).",
          "12. NEVER call qa_publish_push from this prompt — that is only via qa-publish.",
          "",
          OPTION_SELECTION_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("qa-publish", {
    title: "Publish Test Cases to ADO",
    description: "Push a reviewed draft to ADO — creates test cases after explicit confirmation",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to create test cases in ADO from a reviewed draft.",
          "",
          "GOLDEN RULE: Never create test cases in ADO without human review and explicit confirmation.",
          "",
          "Please:",
          "1. Ask for plan ID and US ID if not in context.",
          "2. Check: Does a draft exist? Call qa_drafts_list or qa_draft_read(userStoryId) with workspaceRoot or draftsPath (same location user will save to).",
          "3. If NO draft: Fetch US via ado_story. Apply BOTH skills: qa-test-assets for folder structure and qa-test-drafting for content quality (analyze US + Solution Design, coverage matrix, process flow, Test Coverage Insights). Derive business-specific terms from source material. Create all three files: (a) call qa_draft_save for main test cases (auto-creates tc-drafts/US_<ID>/ folder), (b) call qa_draft_doc_save with docType='solution_summary' for solution design summary, (c) call qa_draft_doc_save with docType='qa_cheat_sheet' for QA cheat sheet. ALWAYS pass workspaceRoot or draftsPath. Tell me: 'I've created draft files. Please review at the paths shown. When ready, run this command again and confirm.' Do NOT call qa_publish_push. When consuming `ado_story`, apply the same rules as `qa-draft` step 2d–2e: scan `namedFields`, `allFields`, and `fetchedConfluencePages` for context; surface `unfetchedLinks` to the user before drafting; reference `embeddedImages` via `originalUrl`.",
          "4. If draft exists but I have NOT confirmed: Show draft summary via qa_draft_read. Ask: 'Have you reviewed the draft? Reply **YES** to push N test cases to ADO, **no** to cancel, or tell me what you'd like instead.' Do NOT push until I reply with an affirmative token per the consent rule in AGENTS.md (sarcasm, frustration, and questions back are not consent — re-ask).",
          "5. If I reply with an affirmative token (YES / approved / confirmed / push / go ahead): Ask one more time for safety — 'Final check: reply **YES** to push to ADO, or **no** to cancel.' Then on affirmative, call qa_publish_push with the same workspaceRoot or draftsPath used for the draft. If the draft is already APPROVED and I revised it, pass repush: true to update existing test cases (formatting will be re-applied).",
          "6. If qa_publish_push returns 'US {id} — existing test cases detected' with A/B/C options: show the message verbatim (do NOT list the existing TCs yourself; counts are deliberate). Apply the option selection contract below — the user must reply with A, B, or C explicitly. 'okay', 'sure', 'yes' do NOT pick an option. On A, call qa_publish_push again with insertAnyway: true. On B, call qa_tests and then qa_tc_read for each linked ID to show me titles/steps, then ask me again. On C, stop. Never set insertAnyway: true without an explicit 'A' reply.",
          "7. If I provide feedback or edits: Update draft via qa_draft_save, then ask for confirmation again.",
          "8. NEVER call qa_publish_push without explicit user confirmation (YES, approved, push, etc.). Apply the consent rule from AGENTS.md — frustration, sarcasm, rhetorical questions, and self-directed replies are NOT consent; on ambiguous replies, re-ask with yes/no options visible, do not proceed. NEVER pass insertAnyway=true without showing me the A/B/C prompt first and receiving an explicit 'A' reply.",
          "9. When showing ADO work item IDs in chat (push summaries, linked TC lists, test case details, etc.), format them as markdown links using the webUrl field from the tool response, e.g. `[ADO #1234](https://dev.azure.com/.../_workitems/edit/1234)`. qa_draft_read also appends an 'ADO Links' section when the draft has IDs — surface those links in tables/summaries for the user. Never show bare `ADO #1234` when a URL is available.",
          "",
          CONFIRM_BEFORE_ACT_CONTRACT,
          "",
          OPTION_SELECTION_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("ado-suite-tests", {
    title: "List Test Cases in Suite",
    description: "List test cases within a specific test suite",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to list test cases in a test suite. Ask me for the plan ID and suite ID, then use the ado_suite_tests tool. Show results in a table with ID and name.",
          "",
          INTERACTIVE_READ_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("qa-tc-read", {
    title: "Read Test Case",
    description: "Read a test case — title, steps, prerequisites, priority, and state",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to view a test case. Ask me for the work item ID, then use the qa_tc_read tool. Show the title, description, steps, priority, state, area path, and iteration path.",
          "",
          INTERACTIVE_READ_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("qa-tc-update", {
    title: "Update Test Case",
    description: "Update a test case — title, steps, prerequisites, priority, or assignment",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to update a test case.",
          "",
          "Please:",
          "1. Ask me for the work item ID.",
          "2. Fetch it using the qa_tc_read tool to show the current state.",
          "3. Ask me what I want to change. Options: title, description/prerequisites, steps, priority, state, assignedTo, areaPath, iterationPath.",
          "4. Show what will change and ask: 'Reply **YES** to update, **no** to cancel, or tell me what you'd like instead.'",
          "5. On affirmative, use the qa_tc_update tool with only the fields to update (partial) or all fields (full).",
          "",
          CONFIRM_BEFORE_ACT_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("ado-fields", {
    title: "List Work Item Fields",
    description: "List all ADO field definitions — reference names, types, and read-only status",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "List all work item field definitions using the ado_fields tool. Show reference names (e.g. Custom.PrerequisiteforTest, System.Title), types, and readOnly status. Use to verify field names before updating work items.",
          "",
          INTERACTIVE_READ_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("qa-tc-delete", {
    title: "Delete Test Case(s)",
    description: "Delete one or more test cases by ID — moves to Recycle Bin (restorable for 30 days)",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to delete test case(s).",
          "",
          "**⚠️ IMPORTANT — this is a destructive action.** Read the rules below carefully.",
          "",
          "Please:",
          "1. Ask me for the work item ID(s). Accept a single ID (e.g. `12345`) or multiple (comma-separated or space-separated, e.g. `12345, 67890` or `12345 67890 11111`).",
          "",
          "2. **Scope warning.** Before confirming, remind me that this tool ONLY deletes **Test Cases**. If any ID points to a User Story, Bug, Task, or other work item type, the server will refuse to delete it (you will see a 'Refused to delete' error). That is by design — preventing accidental deletion of non-test-case work items.",
          "",
          "3. Confirm based on mode:",
          "   **Default mode (soft delete — Recycle Bin):**",
          "   - Single ID: 'Delete test case {id}?\\n\\n• Moves to Recycle Bin (restorable within 30 days via ADO UI → Work Items → Recycle Bin).\\n• The test case is unlinked from any suites, but the suite itself is unchanged.\\n\\nReply **YES** to delete, **no** to cancel.'",
          "   - Multiple IDs: 'Delete these N test cases? {list}\\n\\n• They will be moved to Recycle Bin (restorable within 30 days via ADO UI).\\n• Each test case is unlinked from any suites it belongs to.\\n\\nReply **YES** to delete, **no** to cancel.'",
          "",
          "   **Permanent-delete mode (`destroy=true`) — only if the user explicitly requested it:**",
          "   - Show this warning VERBATIM and require a second confirmation:",
          "",
          "     ```",
          "     🔴 **PERMANENT DELETE — CANNOT BE RECOVERED**",
          "",
          "     You asked for `destroy=true`. This will permanently delete N test case(s):",
          "     {list with IDs and titles if known}",
          "",
          "     ⚠️  Unlike the default soft delete, there is **NO Recycle Bin** for this action.",
          "     ⚠️  Once destroyed, the test case(s) are GONE. Not restorable by anyone — not you,",
          "         not an admin, not Microsoft support.",
          "     ⚠️  Any test run history, linked requirements, and execution results are also lost.",
          "",
          "     If you are sure, reply exactly **DESTROY** (uppercase) to proceed.",
          "     Any other reply (including a plain 'yes') cancels the permanent delete.",
          "     ```",
          "",
          "   Apply the consent rule from AGENTS.md — do not proceed on ambiguous replies. For permanent delete, only the exact string `DESTROY` (case-sensitive) counts as confirmation.",
          "",
          "4. On affirmative, call the `qa_tc_delete` tool once per ID (sequentially). Pass `destroy: true` only if the user confirmed with `DESTROY`.",
          "",
          "5. Report results per ID:",
          "   - If the tool returns 'Refused to delete' (wrong work-item type), surface that error to the user immediately — do NOT continue with the remaining IDs silently. Ask whether to skip that ID and continue with the rest, or stop.",
          "   - If the tool returns an auth/permission error (invalid PAT, missing scope), surface the error verbatim — it includes the actionable fix (e.g. 'run /vortex-ado/ado-connect to update credentials' or 'add Test Management (Read & Write) scope to your PAT'). Stop processing further IDs.",
          "   - On success, use a compact table for bulk: `| ID | Status | Notes |`.",
          "",
          CONFIRM_BEFORE_ACT_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("qa-clone", {
    title: "Clone Test Cases Between User Stories",
    description: "Clone and adapt test cases from one User Story to another",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to clone and enhance test cases from one User Story to another.",
          "",
          "**Flow:**",
          "1. Ask for source User Story ID and target User Story ID.",
          "2. Call qa_tests(sourceUserStoryId) to get linked TC IDs.",
          "3. Call qa_tc_read for each TC ID to read title, prerequisites (System.Description or Custom.PrerequisiteforTest), and steps (Microsoft.VSTS.TCM.Steps XML).",
          "4. Call ado_story(targetUserStoryId) to get target US context and Solution Design. When consuming `ado_story`, apply the same rules as `qa-draft` step 2d–2e: scan `namedFields`, `allFields`, and `fetchedConfluencePages` for context; surface `unfetchedLinks` to the user before proceeding; reference `embeddedImages` via `originalUrl`.",
          "5. For each source TC: classify as Clone As-Is | Minor Update | Enhanced. Apply target US + Solution Design context. Update prerequisites and steps where needed.",
          "6. Build a markdown preview with: source/target US summary, each TC with classification, transformed title, prerequisites, and steps.",
          "7. Call qa_clone_preview_save with the markdown. Pass workspaceRoot or draftsPath.",
          "8. Tell me: 'Review the preview at the path shown. Respond APPROVED to create in ADO, MODIFY to revise, or CANCEL to abort.'",
          "9. On APPROVED:",
          "   a. Call qa_suite_setup(targetUserStoryId) to ensure suite (returns planId).",
          "   b. Call qa_draft_save with transformed TCs (target US context, planId from step a, version 1). Pass workspaceRoot or draftsPath.",
          "   c. Call qa_publish_push with same workspaceRoot/draftsPath.",
          "10. On MODIFY: Revise the preview and qa_clone_preview_save again, then ask for APPROVED/MODIFY/CANCEL.",
          "11. On CANCEL: Confirm abort.",
          "",
          "**Rules:**",
          "- Use conventions from conventions.config.json for prerequisites and title format.",
          "- Apply Solution Design usage rules (use for business process, new fields; ignore code snippets).",
          "- Never create in ADO without explicit APPROVED.",
          "",
          CONFIRM_BEFORE_ACT_CONTRACT,
          "",
          OPTION_SELECTION_CONTRACT,
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("confluence-read", {
    title: "Read Confluence Page",
    description: "Read a Confluence page by ID — useful for Solution Design reference",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to read a Confluence page for reference. Ask me for the page ID, then use the confluence_read tool. Display the page title and content.",
          "",
          INTERACTIVE_READ_CONTRACT,
        ].join("\n"),
      },
    }],
  }));
}
