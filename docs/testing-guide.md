# ADO TestForge MCP -- Step-by-Step Testing Guide

**Documentation index:** [docs/README.md](README.md) | **Changelog:** [docs/changelog.md](changelog.md)

This guide walks you through setting up, running, and testing the MCP server end-to-end.

---

## Table of Contents

1. [For New Team Members (Quick Start)](#1-for-new-team-members-quick-start)
2. [Prerequisites](#2-prerequisites)
3. [First-Time Setup via Slash Command](#3-first-time-setup-via-slash-command)
4. [Using Slash Commands](#4-using-slash-commands)
5. [Testing Tools -- Step by Step](#5-testing-tools--step-by-step)
   - [Step 1: List Test Plans](#step-1-list-test-plans)
   - [Step 2: Get Test Plan Details](#step-2-get-test-plan-details)
   - [Step 3: Fetch a User Story](#step-3-fetch-a-user-story)
   - [Step 4: Ensure Suite Hierarchy](#step-4-ensure-suite-hierarchy)
   - [Step 5: Create a Test Case](#step-5-create-a-test-case)
   - [Step 6: Verify in ADO](#step-6-verify-in-ado)
   - [Step 7: List Test Cases in Suite](#step-7-list-test-cases-in-suite)
   - [Step 8: Update a Test Case](#step-8-update-a-test-case)
   - [Step 9: Confluence (Optional)](#step-9-confluence-optional)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. For New Team Members (Quick Start)

The MCP server is self-installing. If you received the `ADO TestForge MCP` folder (via Google Drive or otherwise), here's all you need:

**Prerequisites:** Node.js v18+ installed (`node -v` to check)

**Steps:**

1. Open the `ADO TestForge MCP` folder in **Cursor IDE**
2. Go to **Cursor Settings > MCP** -- you should see `ado-testforge` listed
3. In Cursor's AI chat, type `/ado-testforge/install` and run the command
4. The installer checks prerequisites and creates a credentials template file
5. Open the credentials file shown in the chat response (`~/.ado-testforge-mcp/credentials.json`)
6. Fill in your **ADO PAT**, **organization name**, and **project name** -- save the file
7. Restart the `ado-testforge` MCP server in **Cursor Settings > MCP**
8. Done -- all tools and slash commands are now available under `ado-testforge`

Your credentials are stored locally at `~/.ado-testforge-mcp/credentials.json` and are **never shared** with the team folder.

---

## 2. Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | v18+ (run `node -v` to check) |
| **npm** | v9+ (comes with Node.js) |
| **Cursor IDE** | Latest version |
| **ADO PAT** | Personal Access Token with these scopes: **Work Items (Read & Write)**, **Test Management (Read & Write)** |
| **ADO Access** | Access to the target ADO organization and project |

### How to Create a PAT

1. Go to `https://dev.azure.com/{your-org}/_usersSettings/tokens`
2. Click **+ New Token**
3. Set a name (e.g., `ADO TestForge MCP`)
4. Set expiration (recommend 90 days)
5. Under **Scopes**, select **Custom defined** and enable:
   - **Work Items** -- Read & Write
   - **Test Management** -- Read & Write
6. Click **Create** and **copy the token immediately** (you won't see it again)

---

## 3. First-Time Setup via Slash Command

The MCP server uses a bootstrap system that handles installation automatically.

### How It Works

When Cursor opens the `ADO TestForge MCP` folder, it reads `.cursor/mcp.json` and starts the `ado-testforge` MCP server.

- **Not ready (first time):** Shows `/ado-testforge/install` command with prerequisite checks (Google Drive, Node.js, folder structure). Registers the server globally after install.
- **Ready:** Shows full ADO tools (`/ado-testforge/get_user_story`, `/ado-testforge/draft_test_cases`, etc.)

### Running Setup

1. Type `/ado-testforge/install` in Cursor's AI chat
2. The installer will:
   - Check prerequisites (Google Drive app, Node.js v18+, folder structure)
   - Create `~/.ado-testforge-mcp/credentials.json` with a template
   - Register `ado-testforge` globally in `~/.cursor/mcp.json`
3. Open the credentials file and fill in:
   - `ado_pat`: Your Azure DevOps Personal Access Token
   - `ado_org`: Organization name (from `https://dev.azure.com/{org}`)
   - `ado_project`: Project name
   - Confluence fields are optional
4. Save the file and restart the `ado-testforge` MCP server in Cursor Settings > MCP

### Credential Storage

Credentials are stored per-user at `~/.ado-testforge-mcp/credentials.json` (your home directory). They are **never stored in the shared project folder** and never appear in chat. This ensures PATs stay private even when the project is shared via Google Drive.

### Checking Status

Use `/ado-testforge/check_status` to verify your setup is complete.

- **First successful run for a version:** shows the full welcome message and quick-start CTA
- **Later runs on the same version:** show a brief `ADO TestForge MCP vX.Y.Z | Status: ✓ Ready` header
- **After an update:** shows a one-time "What's New" summary pulled from the changelog
- **If Confluence is not configured:** the status remains fully healthy; no warnings are shown for the optional integration

---

## 4. Using Slash Commands

The `ado-testforge` MCP server registers **slash commands** (MCP prompts) that provide a quick way to invoke tools. Type `/` in Cursor's chat to see all available commands.

### Available Commands

**Before setup (installer mode):**

| Command | Description |
|---|---|
| `install` | Check prerequisites, create credentials template, register globally |
| `check_setup_status` | Check what is needed to complete setup |

**After setup (full server):

| Command | Description |
|---|---|
| `check_status` | Verify setup status |
| `list_test_plans` | List all test plans in the project |
| `get_user_story` | Fetch a User Story with full context |
| `get_test_plan` | Get test plan details |
| `list_test_suites` | List all suites in a test plan |
| `get_test_suite` | Get test suite details |
| `create_test_suite` | Create suite structure — User Story ID only |
| `update_test_suite` | Ensure or update suite structure — User Story ID only |
| `ensure_suite_hierarchy_for_us` | Same — User Story ID only, derives plan and sprint from US |
| `delete_test_suite` | Delete a test suite (test cases remain) |
| `ensure_suite_hierarchy` | Build sprint > parent > US suite tree |
| `draft_test_cases` | Generate a test case draft for review (never creates in ADO). Only asks for User Story ID - Test Plan ID is auto-derived during push. Applies a generic QA architect skill: analyze US + Solution Design, derive project-specific terminology from the source material, then build the coverage matrix, process flow, and checklist. |
| `create_test_cases` | Push reviewed test cases to ADO (requires prior draft + confirmation) |
| `list_test_cases` | List test cases in a suite |
| `get_test_case` | Get test case details |
| `update_test_case` | Update one or more fields (partial or full) |
| `list_work_item_fields` | List all work item field definitions |
| `delete_test_case` | Delete a test case (Recycle Bin by default) |
| `delete_test_cases` | Delete multiple test cases by ID (Recycle Bin by default) |
| `get_confluence_page` | Read a Confluence page for reference |

### How to Use

1. In Cursor's AI chat (Agent mode), type `/ado-testforge`
2. A dropdown list appears showing all available commands
3. Select the command -- it fires immediately
4. The AI asks for any required inputs (work item IDs, plan IDs, etc.) in the chat
5. Provide the values and the AI calls the appropriate tool

### Examples

**Quick lookup:**
- Select `ado-testforge / list_test_plans` -- results appear immediately

**Fetch a User Story:**
- Select `ado-testforge / get_user_story`
- AI asks for the work item ID -- type it in chat (e.g., `1273966`)

**Create test cases interactively:**
- Select `ado-testforge / create_test_case`
- AI asks for plan ID and US ID, fetches context, suggests test cases, asks for confirmation

### Slash Commands vs Natural Language

Both approaches work. Use whichever is more convenient:

| Approach | When to Use |
|---|---|
| **Slash commands** (`ado-testforge / *`) | Quick, structured lookups; sharing with teammates who want a guided experience |
| **Natural language** | Complex requests, combining multiple steps, or when you want full control over the prompt |

---

## 5. Testing Tools -- Step by Step

Use these prompts in Cursor's AI chat (Agent mode) to test each tool. Replace placeholder IDs with your actual ADO values.

### Step 1: List Test Plans

**Purpose:** Verify ADO connection and find your test plan ID.

**Prompt to use in Cursor chat:**
```
List all test plans in the project using the ado-test-manager MCP
```

**Expected result:** A JSON array of test plans with their `id`, `name`, `areaPath`, `state`, and `rootSuiteId`.

**What to note down:**
- `id` of your test plan (e.g., `GPT_D-HUB`)
- `rootSuiteId` -- you'll need this later

---

### Step 2: Get Test Plan Details

**Purpose:** Verify the test plan area path (used as default for test cases).

**Prompt:**
```
Get details of test plan ID {YOUR_PLAN_ID}
```

**Expected result:** Full test plan JSON including `areaPath`, `rootSuite`, `iteration`, etc.

**Verify:** The `areaPath` should match your expected path (e.g., `TPM Product Ecosystem\Salesforce_TPM_Global Product\Salesforce_TPM_DHub_SF`).

---

### Step 3: Fetch a User Story

**Purpose:** Test the `get_user_story` tool and see what context is available, including Solution Design content from Confluence.

**Prompt:**
```
Fetch user story {YOUR_US_ID} from ADO
```

**Expected result:** JSON with:
- `id`, `title`, `description`, `acceptanceCriteria`
- `areaPath`, `iterationPath`, `state`
- `parentId`, `parentTitle` (EPIC/Parent US info)
- `relations` array
- `solutionDesignUrl` -- Confluence page URL from the Solution Notes / Technical Solution field (or `null`)
- `solutionDesignContent` -- Full page content fetched from Confluence (or `null`)

**Verify:**
- Description and acceptance criteria are present
- `parentId` is populated if the US is linked to an EPIC
- `iterationPath` contains the correct sprint (this will be inherited by test cases)
- If the US has a Confluence link in Solution Notes and Confluence is reachable, `solutionDesignUrl` shows the URL and `solutionDesignContent` shows the page content
- If Confluence is not configured, the field is empty, or the Confluence fetch fails, `solutionDesignContent` stays `null` and the rest of the ADO response remains usable

---

### Step 4: Ensure Suite Hierarchy

**Purpose:** Build the folder structure under the test plan for a User Story.

**Prompt:**
```
Ensure the test suite hierarchy for plan ID {YOUR_PLAN_ID}, sprint number {SPRINT_NUM}, user story {YOUR_US_ID}
```

For example, if your plan ID is 12345, sprint is 25, and US ID is 67890:
```
Ensure the test suite hierarchy for plan ID 12345, sprint number 25, user story 67890
```

**Expected result:** JSON with:
```json
{
  "leafSuiteId": 99999,
  "leafSuiteName": "67890 | US Title Here",
  "created": ["SFTPM_25", "12345 | Epic Title", "67890 | US Title Here"],
  "existing": []
}
```

**Verify in ADO:**
1. Go to **Test Plans** > Your test plan
2. Expand the suite tree
3. You should see the hierarchy:
   ```
   Root Suite
   └── SFTPM_25              (static suite -- sprint folder)
       └── {ParentID} | {ParentTitle}   (static suite -- EPIC/parent folder)
           └── {USID} | {USTitle}       (query-based suite -- auto-links TCs)
   ```

**Run it again** with the same inputs -- the response should show all suites in `existing` instead of `created`.

---

### Step 5: Create a Test Case

**Purpose:** Create a test case with the full naming convention, prerequisites, and steps.

**Prompt:**
```
Create a test case for plan {YOUR_PLAN_ID}, user story {YOUR_US_ID} with these details:
- Feature tags: ["Promotion Management", "Create Promotion"]
- Summary: Verify promotion creation with all required fields
- Steps:
  1. Action: Navigate to Promotions tab | Expected: Promotions list page is displayed
  2. Action: Click New Promotion button | Expected: New Promotion form opens
  3. Action: Fill all required fields and click Save | Expected: Promotion is created successfully with status Draft
```

**Expected result:** JSON with:
```json
{
  "id": 123456,
  "title": "TC_67890_01 -> Promotion Management -> Create Promotion -> Verify promotion creation with all required fields",
  "url": "https://dev.azure.com/...",
  "state": "Design",
  "priority": 2
}
```

**Verify in ADO:**
1. Open the test case by ID or URL
2. Check the **Title** follows the `TC_{USID}_{##} -> {tags} -> {summary}` format
3. Check the **Description** has the prerequisites section with default personas and preconditions
4. Check the **Steps** tab has your 3 steps with actions and expected results
5. Check **Area Path** matches the test plan's area path
6. Check **Iteration Path** matches the User Story's iteration
7. Check **Links** tab shows a "Tests" link to your User Story
8. Go back to the test suite tree -- the test case should **automatically appear** in the query-based US suite

---

### Step 6: Verify in ADO

After creating the test case, perform these manual checks in ADO:

| Check | Where | Expected |
|---|---|---|
| Test case exists | Work Items > Search by ID | Work item found |
| Title format | Work item title | `TC_{USID}_{##} -> ...` |
| Prerequisites | Description field | Persona + Pre-requisite sections with defaults |
| Steps | Steps tab | Action / Expected Result pairs |
| Area Path | Classification | Matches test plan area path |
| Iteration | Classification | Matches US iteration |
| Link to US | Links tab | "Tests" relationship to the US |
| Auto-linked to suite | Test Plans > Suite tree | TC appears in the query-based US suite |

---

### Step 7: List Test Cases in Suite

**Purpose:** Verify test cases are visible in the query-based suite.

**Prompt:**
```
List test cases in plan {YOUR_PLAN_ID}, suite {LEAF_SUITE_ID}
```

Use the `leafSuiteId` from Step 4.

**Expected result:** An array containing your created test case(s).

---

### Step 8: Update a Test Case

**Purpose:** Test modifying an existing test case.

**Supported fields:** title, description (raw HTML), prerequisites (structured), steps, priority, state, assignedTo, areaPath, iterationPath. See [ado-test-case-update-guide.md](ado-test-case-update-guide.md) for prerequisite structure and [changelog.md](changelog.md) for details.

**Prompt:**
```
Update test case {TC_WORK_ITEM_ID}: change priority to 1 and add a new step:
- Action: Verify audit log entry | Expected: Promotion creation is logged
```

**Expected result:** JSON with the updated work item `id` and `rev` (revision number).

**Verify:** Open the test case in ADO and confirm the priority changed and the new step was added.

---

### Step 9: Confluence Integration

**Purpose:** Test both the standalone Confluence page reader and the automatic Solution Design enrichment on User Stories.

**Pre-requisite:** Configure the Confluence credentials in `~/.ado-testforge-mcp/credentials.json`:
```json
{
  "confluence_base_url": "https://yoursite.atlassian.net/wiki",
  "confluence_email": "your.email@company.com",
  "confluence_api_token": "your-confluence-api-token"
}
```

Restart the MCP server after saving these.

> **Required permissions:** Your Atlassian account needs "Can view" on the Confluence space(s) containing Solution Design pages. See [setup-guide.md](setup-guide.md#step-4b-configure-confluence-optional) for full details.

#### 9a: Standalone page fetch

**Prompt:**
```
Fetch Confluence page {PAGE_ID}
```

> **Finding the page ID:** Open the Confluence page in your browser. The URL contains the page ID, e.g., `https://yoursite.atlassian.net/wiki/spaces/SPACE/pages/123456789/Page+Title` -- the `123456789` is the page ID.

**Expected result:** The page title and body content in plain text.

#### 9b: Automatic Solution Design enrichment

**Prompt:**
```
Fetch user story {US_ID_WITH_CONFLUENCE_LINK} from ADO
```

Use a User Story that has a Confluence link in the **Solution Notes** field (ADO field: "Technical Solution").

**Expected result:** The JSON response includes:
- `solutionDesignUrl`: The Confluence URL from the Technical Solution field
- `solutionDesignContent`: The full page content (title + body) fetched from Confluence

**Verify:**
- The content matches what you see when opening the Confluence page in a browser
- If the Technical Solution field is empty, both values are `null`
- If Confluence credentials are missing or the fetch fails, `solutionDesignContent` is `null` even when a URL is present

#### 9c: Test case creation with Solution Design context

**Prompt:**
```
Create test cases for plan {PLAN_ID}, user story {US_ID_WITH_CONFLUENCE_LINK}
```

**Expected behavior:** The AI fetches the User Story (which now includes Solution Design content) and uses it as additional context alongside the description and acceptance criteria to suggest more thorough, design-aware test cases.

---

## 6. Troubleshooting

### Server won't start / Red dot in Cursor MCP settings

| Symptom | Fix |
|---|---|
| `Missing required environment variables` | Check `~/.ado-testforge-mcp/credentials.json` has `ado_pat`, `ado_org`, `ado_project` set correctly |
| `Cannot find module` | Run `npm install` again |
| `SyntaxError` or TypeScript errors | Run `npx tsc --noEmit` to see compilation errors |
| Red dot persists | Check Cursor MCP logs: **Cursor Settings > MCP > Click the server name > View logs** |

### ADO API errors

| Error | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | PAT is invalid or expired | Regenerate the PAT in ADO |
| `403 Forbidden` | PAT lacks required scopes | Recreate with **Work Items (R&W)** and **Test Management (R&W)** |
| `404 Not Found` | Wrong org, project, or work item ID | Double-check `ADO_ORG` and `ADO_PROJECT` in `.env` |
| `VS800075: The project does not exist` | Project name mismatch | Use the exact project name from the ADO URL |

### Test case not appearing in query-based suite

- The suite's WIQL query looks for test cases whose title contains `TC_{USID}_`
- Verify the test case title starts with the correct prefix
- Check the test case's **Area Path** matches the query filter
- Open the suite in ADO > Right-click > **Run Query** to debug

### Common issues

| Issue | Fix |
|---|---|
| `conventions.config.json` validation error | Check JSON syntax; compare with the schema in `src/config.ts` |
| Test case number always starts at 1 | The auto-increment queries existing TCs by title pattern; if no matches found, starts at 1 |
| Prerequisites are empty | Persona always uses all three from config; pre-conditions must be generated per user story (never from config). Check `conventions.config.json` > `prerequisiteDefaults.personas` |

---

## Quick Reference: All MCP Tools

| Tool | Description | Key Inputs |
|---|---|---|
| `list_test_plans` | List all test plans | *(none)* |
| `get_test_plan` | Get test plan details | `planId` |
| `create_test_plan` | Create a new test plan (future use) | `name` |
| `get_user_story` | Fetch US with context + Solution Design from Confluence | `workItemId` |
| `list_test_cases_linked_to_user_story` | Get TC IDs linked to a US via Tests/Tested By | `userStoryId` |
| `list_work_item_fields` | List work item field definitions (reference names, types) | `expand` (optional) |
| `ensure_suite_hierarchy` | Build sprint > parent > US suite tree | `planId`, `sprintNumber`, `userStoryId` |
| `find_or_create_test_suite` | Find or create a single suite | `planId`, `parentSuiteId`, `suiteName` |
| `create_test_suite` | Create a suite (find-or-create) | `planId`, `parentSuiteId`, `suiteName`, `suiteType`, `queryString` |
| `update_test_suite` | Update suite (name, parent, query) | `planId`, `suiteId`, `name`, `parentSuiteId`, `queryString` |
| `delete_test_suite` | Delete a suite | `planId`, `suiteId` |
| `list_test_suites` | List all suites in a plan | `planId` |
| `get_test_suite` | Get suite details | `planId`, `suiteId` |
| `save_tc_draft` | Save test case draft to markdown only | `userStoryId`, `testCases`, `planId` (optional - auto-derived during push), `functionalityProcessFlow` (optional), `testCoverageInsights` (optional), etc. |
| `save_tc_clone_preview` | Save clone-and-enhance preview | `sourceUserStoryId`, `targetUserStoryId`, `markdown` |
| `list_tc_drafts` | List saved drafts (from .md files) | *(none)* |
| `get_tc_draft` | Get draft by user story ID | `userStoryId` |
| `push_tc_draft_to_ado` | Push approved draft to ADO (auto-derives planId from US AreaPath if not in draft, creates suite hierarchy, creates TCs) | `userStoryId` |
| `list_test_cases` | List TCs in a suite | `planId`, `suiteId` |
| `get_test_case` | Get TC work item details | `workItemId` |
| `update_test_case` | Update one or more TC fields (partial or full) | `workItemId`, *(optional: title, description, prerequisites, steps, priority, state, assignedTo, areaPath, iterationPath)* |
| `delete_test_case` | Delete a test case (Recycle Bin by default) | `workItemId`, `destroy` (optional) |
| `delete_test_cases` | (Command only — calls delete_test_case per ID) | N/A — use slash command |
| `add_test_cases_to_suite` | Add TCs to static suite | `planId`, `suiteId`, `testCaseIds` |
| `get_confluence_page` | Read Confluence page content | `pageId` |

---

## Recommended Testing Order

```
1. npm install                    -- Setup
2. Configure .env                 -- Credentials
3. npx tsc --noEmit               -- Verify build
4. Start MCP in Cursor            -- Activate server
5. list_test_plans                -- Verify connection
6. get_test_plan                  -- Get plan ID + area path
7. get_user_story                 -- Verify US context
8. ensure_suite_hierarchy         -- Build folder structure
9. create_test_case               -- Create first TC
10. Verify in ADO                 -- Manual check
11. list_test_cases               -- Verify via API
12. update_test_case              -- Test updates
13. get_confluence_page           -- Optional
```
