import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerAllPrompts(server: McpServer) {
  server.registerPrompt("check_status", {
    title: "Check Setup Status",
    description: "Check if the ADO TestForge MCP server is fully configured",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "Check if the ADO TestForge MCP server is fully configured using the check_setup_status tool. Show the status of each component.",
      },
    }],
  }));

  server.registerPrompt("list_test_plans", {
    title: "List Test Plans",
    description: "List all test plans in the ADO project",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "List all test plans in the project using the list_test_plans tool. Show results in a table with ID, name, area path, state, and root suite ID.",
      },
    }],
  }));

  server.registerPrompt("get_user_story", {
    title: "Get User Story",
    description: "Fetch a User Story from ADO with description, acceptance criteria, Solution Design, and parent info",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "I want to fetch a User Story from ADO. Ask me for the work item ID, then use the get_user_story tool. Show the title, description, acceptance criteria, area path, iteration path, state, parent info, and Solution Design content (if available from the Technical Solution field) in a structured summary.",
      },
    }],
  }));

  server.registerPrompt("get_test_plan", {
    title: "Get Test Plan",
    description: "Get details of a specific test plan by ID",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "I want to get details of a test plan. Ask me for the plan ID, then use the get_test_plan tool. Show the name, area path, iteration, owner, state, and root suite ID.",
      },
    }],
  }));

  server.registerPrompt("list_test_suites", {
    title: "List Test Suites",
    description: "List all test suites in a test plan",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "I want to list all test suites in a test plan. Ask me for the plan ID, then use the list_test_suites tool. Show results in a table with ID, name, suite type, parent suite ID, and hasChildren.",
      },
    }],
  }));

  server.registerPrompt("get_test_suite", {
    title: "Get Test Suite",
    description: "Get details of a specific test suite",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "I want to get details of a test suite. Ask me for the plan ID and suite ID, then use the get_test_suite tool.",
      },
    }],
  }));

  server.registerPrompt("ensure_suite_hierarchy", {
    title: "Ensure Suite Hierarchy",
    description: "Build the full suite folder hierarchy (sprint > parent-us > us-query) for a User Story",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "I want to set up the test suite folder hierarchy for a User Story. Ask me for the test plan ID, sprint number, and user story ID. Then use the ensure_suite_hierarchy tool and show which suites were created vs already existing.",
      },
    }],
  }));

  server.registerPrompt("ensure_suite_hierarchy_for_us", {
    title: "Ensure Suite Hierarchy (User Story ID Only)",
    description: "Build or fix suite folder structure. Asks only User Story ID — derives plan and sprint from US.",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "I want to ensure the test suite folder structure for a User Story. Ask only for the User Story ID. Use ensure_suite_hierarchy_for_us — it derives plan and sprint from the US AreaPath and Iteration, creates folders if missing, and updates naming if wrong format.",
      },
    }],
  }));

  server.registerPrompt("create_test_suite", {
    title: "Create Test Suite",
    description: "Create test suite folder structure for a User Story. Asks only User Story ID.",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to create a test suite for a User Story.",
          "",
          "Ask only for the User Story ID. Then use ensure_suite_hierarchy_for_us — it derives plan and sprint from the US AreaPath and Iteration, checks if folders exist, creates if missing, and updates naming if existing suites have wrong format.",
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("update_test_suite", {
    title: "Update Test Suite",
    description: "Ensure test suite structure for a User Story (checks/creates/updates naming) or update a specific suite",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to update a test suite.",
          "",
          "**Preferred:** If this is for a User Story, ask only for the User Story ID. Use ensure_suite_hierarchy_for_us — it checks if folders exist, creates if missing, and updates naming if wrong format.",
          "",
          "**Alternative:** If updating a specific suite by ID, ask for plan ID and suite ID, show current state with get_test_suite, then use update_test_suite with the fields to change.",
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("delete_test_suite", {
    title: "Delete Test Suite",
    description: "Delete a test suite (test cases are not deleted, only the suite association)",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "I want to delete a test suite. Ask me for the plan ID and suite ID, confirm the action, then use the delete_test_suite tool. Note: Test cases in the suite are not deleted—only their association with the suite is removed.",
      },
    }],
  }));

  server.registerPrompt("draft_test_cases", {
    title: "Draft Test Cases",
    description: "Generate a test case draft (markdown) for review. Never creates in ADO.",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to draft test cases for a User Story.",
          "",
          "Apply the QA architect methodology from .cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md: analyze US + Solution Design, validate coverage matrix, add Functionality Process Flow and Coverage Validation Checklist at the start of the draft, then generate test cases.",
          "",
          "Please:",
          "1. Ask me for the user story ID only (Test Plan ID will be auto-derived from US AreaPath during push).",
          "2. Fetch the user story using the get_user_story tool (includes Solution Design if linked).",
          "3. Check for solutionDesignContent (from the Solution Notes / Technical Solution field).",
          "   When Solution Design is present, apply the usage rules from conventions.config.json solutionDesign section:",
          "   - USE: Business process, functionality context, new fields (Object.Field__c), new configurations, pre-requisite conditions (technical format), admin validation TCs.",
          "   - IGNORE: Code snippets, Apex/JavaScript/LWC, implementation details, deployment steps. Do not use coding parts in test cases.",
          "   - Extract new fields and config from SD; add them to pre-requisites in technical format (Object.Field = Value).",
          "   - For each new field or config introduced, create a System Administrator validation test case: verify the field/setting is accessible and present in the system.",
          "4. Prerequisites rules:",
          "   - PERSONA: Always all three defaults (System Administrator, ADMIN User, KAM). Do NOT override or select subset — every TC gets all three as-is.",
          "   - PRE-REQUISITE: Always unique per user story. Generate from US + Solution Design. Prefer Object.Field = Value; use narrative when describing scenario setup (e.g. 'Tactic Template without X config OR Tactic for which no mapping exists'). Use [Config should be setup/available] or [Config should be setup] as bracket hints when config is required.",
          "5. Styling rules:",
          "   - Ensure all test case titles are ≤ 256 characters (ADO limit). Shorten featureTags or useCaseSummary if needed.",
          "   - Use \"should\" form for all expected results (e.g., \"you should be able to do so\", \"X should be updated\").",
          "   - Use <br> between numbered items in steps/expected results (e.g., \"Fields to validate:<br>1. X<br>2. Y\").",
          "6. Based on ALL available context (description, acceptance criteria, and Solution Design), propose test cases.",
          "7. Call save_tc_draft to create the markdown. Do NOT pass planId (it will be auto-derived during push). ALWAYS pass workspaceRoot (the open folder path) or draftsPath (when user specifies a location). If user has a folder open, use workspaceRoot so drafts go to <folder>/tc-drafts/ (created if missing). If user says 'save to X' or 'create under folder Y', use draftsPath. No hardcoded path.",
          "8. After saving, present a concise summary with the markdown file link prominently displayed at the top for easy access. Include: file link (clickable), version, test case count, and key highlights (coverage checklist, process flow if present, TC breakdown by category).",
          "9. Remind the user: 'Plan ID will be auto-derived from the User Story when you push. Provide feedback for revisions, or run /ado-testforge/create_test_cases when ready to push to ADO.'",
          "10. On feedback, revise and call save_tc_draft again (increment version).",
          "11. NEVER call push_tc_draft_to_ado from this prompt — that is only via create_test_cases.",
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("create_test_cases", {
    title: "Create Test Cases (Push to ADO)",
    description: "Push reviewed test cases to ADO. Always requires prior draft review and explicit confirmation.",
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
          "2. Check: Does a draft exist? Call list_tc_drafts or get_tc_draft(userStoryId) with workspaceRoot or draftsPath (same location user will save to).",
          "3. If NO draft: Fetch US via get_user_story, apply the QA architect methodology from .cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md (analyze US + Solution Design, coverage matrix, process flow, checklist), propose test cases, then call save_tc_draft. ALWAYS pass workspaceRoot (open folder) or draftsPath (user-specified). Tell me: 'I've created a draft. Please review the draft at the path shown. When ready, run this command again and confirm.' Do NOT call push_tc_draft_to_ado.",
          "4. If draft exists but I have NOT confirmed: Show draft summary via get_tc_draft. Ask: 'Have you reviewed the draft? If yes, type YES to push N test cases to ADO.' Do NOT push until I confirm.",
          "5. If I type YES (or approved, confirmed, push): Ask one more time: 'Type YES to push.' Then call push_tc_draft_to_ado with the same workspaceRoot or draftsPath used for the draft. If the draft is already APPROVED and I revised it, pass repush: true to update existing test cases (formatting will be re-applied).",
          "6. If I provide feedback or edits: Update draft via save_tc_draft, then ask for confirmation again.",
          "7. NEVER call push_tc_draft_to_ado without explicit user confirmation (YES, approved, push, etc.).",
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("list_test_cases", {
    title: "List Test Cases",
    description: "List test cases within a specific test suite",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "I want to list test cases in a test suite. Ask me for the plan ID and suite ID, then use the list_test_cases tool. Show results in a table with ID and name.",
      },
    }],
  }));

  server.registerPrompt("get_test_case", {
    title: "Get Test Case",
    description: "Get a test case work item by ID with all fields",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "I want to view a test case. Ask me for the work item ID, then use the get_test_case tool. Show the title, description, steps, priority, state, area path, and iteration path.",
      },
    }],
  }));

  server.registerPrompt("update_test_case", {
    title: "Update Test Case",
    description: "Update fields or steps of an existing test case",
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
          "2. Fetch it using the get_test_case tool to show the current state.",
          "3. Ask me what I want to change. Options: title, description/prerequisites, steps, priority, state, assignedTo, areaPath, iterationPath.",
          "4. Use the update_test_case tool with only the fields to update (partial) or all fields (full).",
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("list_work_item_fields", {
    title: "List Work Item Fields",
    description: "List all work item field definitions (reference names, types) in the ADO project",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "List all work item field definitions using the list_work_item_fields tool. Show reference names (e.g. Custom.PrerequisiteforTest, System.Title), types, and readOnly status. Use to verify field names before updating work items.",
      },
    }],
  }));

  server.registerPrompt("delete_test_case", {
    title: "Delete Test Case",
    description: "Delete a test case by ID (Recycle Bin by default)",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "I want to delete a test case. Ask me for the work item ID, confirm the action, then use the delete_test_case tool. By default the work item is moved to Recycle Bin (restorable). Warn if destroy=true is requested (permanent delete).",
      },
    }],
  }));

  server.registerPrompt("delete_test_cases", {
    title: "Delete Multiple Test Cases",
    description: "Delete multiple test cases by ID (Recycle Bin by default)",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "I want to delete multiple test cases.",
          "",
          "Please:",
          "1. Ask me for the work item IDs (comma-separated or list).",
          "2. Confirm the list and warn that they will be moved to Recycle Bin (restorable within 30 days).",
          "3. Call delete_test_case for each ID in sequence.",
          "4. Report success/failure for each.",
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("clone_and_enhance_test_cases", {
    title: "Clone and Enhance Test Cases",
    description: "Clone test cases from a source User Story to a target User Story. Analyzes target US + Solution Design, classifies impact, generates preview, creates in ADO only after APPROVED.",
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
          "2. Call list_test_cases_linked_to_user_story(sourceUserStoryId) to get linked TC IDs.",
          "3. Call get_test_case for each TC ID to read title, prerequisites (System.Description or Custom.PrerequisiteforTest), and steps (Microsoft.VSTS.TCM.Steps XML).",
          "4. Call get_user_story(targetUserStoryId) to get target US context and Solution Design.",
          "5. For each source TC: classify as Clone As-Is | Minor Update | Enhanced. Apply target US + Solution Design context. Update prerequisites and steps where needed.",
          "6. Build a markdown preview with: source/target US summary, each TC with classification, transformed title, prerequisites, and steps.",
          "7. Call save_tc_clone_preview with the markdown. Pass workspaceRoot or draftsPath.",
          "8. Tell me: 'Review the preview at the path shown. Respond APPROVED to create in ADO, MODIFY to revise, or CANCEL to abort.'",
          "9. On APPROVED:",
          "   a. Call ensure_suite_hierarchy_for_us(targetUserStoryId) to ensure suite (returns planId).",
          "   b. Call save_tc_draft with transformed TCs (target US context, planId from step a, version 1). Pass workspaceRoot or draftsPath.",
          "   c. Call push_tc_draft_to_ado with same workspaceRoot/draftsPath.",
          "10. On MODIFY: Revise the preview and save_tc_clone_preview again, then ask for APPROVED/MODIFY/CANCEL.",
          "11. On CANCEL: Confirm abort.",
          "",
          "**Rules:**",
          "- Use conventions from conventions.config.json for prerequisites and title format.",
          "- Apply Solution Design usage rules (use for business process, new fields; ignore code snippets).",
          "- Never create in ADO without explicit APPROVED.",
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("get_confluence_page", {
    title: "Get Confluence Page",
    description: "Read a Confluence page by ID for Solution Design reference",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: "I want to read a Confluence page for reference. Ask me for the page ID, then use the get_confluence_page tool. Display the page title and content.",
      },
    }],
  }));
}
