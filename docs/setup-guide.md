# ADO TestForge MCP -- Setup Guide

**Documentation index:** [docs/README.md](README.md) | **Changelog:** [docs/changelog.md](changelog.md)

Welcome to the ADO TestForge MCP server. This guide walks you through the complete setup process so you can start using ADO tools directly from Cursor's AI chat.

---

## Quick Start: Add Folder and Run Install

1. **Add the ADO TestForge MCP folder to your workspace**  
   - Open Cursor → **File > Add Folder to Workspace** (or **Open Folder** if starting fresh)  
   - Select the `ADO TestForge MCP` folder (e.g., from Google Drive or your team share)

2. **Run the installer**  
   - Open Cursor's **AI chat** (Cmd+L / Ctrl+L)  
   - Type `/setup-ado-testforge` and select **install**

3. **Follow the prompts**  
   The installer will:
   - Check prerequisites (Node.js v18+)
   - Install npm dependencies
   - Create a credentials template at `~/.ado-testforge-mcp/credentials.json`
   - **Register ADO TestForge MCP globally** so it works in any project folder

4. **Configure credentials**  
   - Open `~/.ado-testforge-mcp/credentials.json` and fill in your ADO PAT, org, and project (see [Step 4](#step-4-configure-your-credentials))

5. **Restart Cursor** (or reload MCP in Settings > MCP)

After setup, ADO TestForge MCP is available in **all workspaces** — you don't need to have the ADO TestForge MCP folder open.

---

## Prerequisites

The installer checks these automatically. Before you begin:

| Requirement | How to Check |
|---|---|
| **Node.js v18+** | Run `node -v` in your terminal |
| **Cursor IDE** | Latest version installed |
| **ADO Access** | You can access your Azure DevOps organization |
| **ADO PAT** | A Personal Access Token (instructions below) |

If you don't have Node.js installed, download it from [https://nodejs.org](https://nodejs.org) (LTS version recommended).

---

## Step 1: Create an Azure DevOps Personal Access Token (PAT)

You need a PAT because our organization uses OKTA SSO.

1. Open your browser and go to:

```
https://dev.azure.com/{your-org}/_usersSettings/tokens
```

Replace `{your-org}` with your ADO organization name (e.g., `MarsDevTeam`).

2. Click **+ New Token**
3. Configure the token:
   - **Name**: `MARS MCP Server` (or any name you prefer)
   - **Expiration**: 90 days recommended
   - **Scopes**: Select **Custom defined**, then enable the scopes listed below
4. Click **Create**
5. **Copy the token immediately** -- you won't be able to see it again

Keep the token somewhere safe (e.g., a password manager). You'll need it in Step 3.

### ADO PAT -- Required Scopes

The MCP server reads and writes work items (User Stories, Test Cases) and manages test plans/suites. The PAT needs exactly these scopes:

| Scope (UI Label) | API Scope | Why |
|---|---|---|
| **Work Items** -- Read & Write | `vso.work_write` | Fetch User Stories, create/update Test Cases, query work items via WIQL |
| **Test Management** -- Read & Write | `vso.test_write` | Create/list/manage Test Plans, Test Suites, and link Test Cases to suites |

**What the MCP server does with these permissions:**

- **Read**: Fetch User Story fields (title, description, acceptance criteria, Technical Solution / Solution Notes, relations, parent links)
- **Write**: Create Test Case work items with `TC_USID_##` naming, link them to User Stories via "Tests / Tested By" relation, update test case fields and steps
- **Test Management**: List/get/create test plans and test suites, manage the sprint > parent > US suite hierarchy, add test cases to suites

**What it does NOT need:**

| Scope | Not Needed Because |
|---|---|
| Code (Read/Write) | No source code access |
| Build / Release | No CI/CD interaction |
| Packaging | No artifact management |
| Identity / Membership | No user management |
| Graph / Analytics | No reporting queries |

### ADO -- Future: Service Principal / OAuth 2.0

If you later move to an Azure AD app registration (OAuth 2.0) instead of a personal PAT, the equivalent Microsoft Graph / ADO OAuth scopes are:

| OAuth Scope | Equivalent PAT Scope |
|---|---|
| `499b84ac-1321-427f-aa17-267ca6975798/.default` (ADO resource) | Full ADO access (scoped per app registration) |
| `vso.work_write` | Work Items -- Read & Write |
| `vso.test_write` | Test Management -- Read & Write |

This is only relevant for production/shared deployments. For individual use, PATs are simpler and recommended.

---

## Step 2: Add the Folder to Your Workspace

1. Locate the `ADO TestForge MCP` folder (shared via Google Drive or provided by your team)
2. Open **Cursor IDE**
3. Go to **File > Add Folder to Workspace** (or **Open Folder** if starting a new session)
4. Select the `ADO TestForge MCP` folder

As soon as the folder is in your workspace, the **setup-ado-testforge** command becomes available. You can verify in **Cursor Settings > MCP** — you should see **setup-ado-testforge** (and possibly **ado-testforge**) listed.

---

## Step 3: Run the Installer

1. Open Cursor's **AI chat** (Cmd+L on Mac, Ctrl+L on Windows)
2. Type `/setup-ado-testforge` and select **install** from the dropdown

The installer will automatically:
- **Check prerequisites** (Node.js v18+)
- Run `npm install` to download all required dependencies
- Create a credentials template file at `~/.ado-testforge-mcp/credentials.json`
- **Register ADO TestForge MCP globally** in `~/.cursor/mcp.json` so it works in any project folder

You'll see progress messages in the chat. Wait for it to complete.

---

## Step 4: Configure Your Credentials

The installer created a template file. Now you need to fill in your actual values.

1. Open the credentials file in your editor:

**Mac:**

```bash
open ~/.ado-testforge-mcp/credentials.json
```

**Windows (PowerShell):**

```powershell
notepad "$env:USERPROFILE\.ado-testforge-mcp\credentials.json"
```

2. The file looks like this:

```json
{
  "ado_pat": "your-personal-access-token",
  "ado_org": "your-organization-name",
  "ado_project": "your-project-name",
  "confluence_base_url": "",
  "confluence_email": "",
  "confluence_api_token": "",
  "tc_drafts_path": ""
}
```

3. Replace the placeholder values:

| Field | What to Enter | Example |
|---|---|---|
| `ado_pat` | The PAT you created in Step 1 | `ghp4x7abc123...` |
| `ado_org` | Your ADO organization name (from `https://dev.azure.com/{org}`) | `MarsDevTeam` |
| `ado_project` | Your ADO project name | `TPM Product Ecosystem` |

The Confluence fields are **optional** -- leave them empty if you don't use Confluence. See [Step 4b](#step-4b-configure-confluence-optional) for Confluence setup.

**TC Drafts path** (`tc_drafts_path`): Test case drafts are saved to a user-local folder, never in the shared workspace. Default: `~/.ado-testforge-mcp/tc-drafts`. To use a different folder (e.g. your local project), set the absolute path: `"/Users/you/projects/my-tcs/tc-drafts"`.

4. **Save the file**

**Important:** Never paste your PAT in Cursor's chat. Always edit the file directly in your editor. Your credentials are stored locally and are never shared with the team folder.

---

## Step 4b: Configure Confluence (Optional)

If your User Stories have Solution Design documents linked in the **Solution Notes** field (ADO field name: "Technical Solution"), you can configure Confluence so the MCP server automatically fetches that content when you run `get_user_story`. This gives the AI richer context for test case generation.

### Path 1: Confluence Cloud API Token (Current Setup)

This is the approach the MCP server uses today. It's the simplest option for individual use.

#### How to Create the Token

1. Go to [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Give it a label (e.g., `MARS MCP Server`)
4. Click **Create** and **copy the token immediately**

#### Required Permissions

API tokens have **no granular scopes** -- they inherit all permissions of the Atlassian user account that creates them. Your account needs:

| Permission | Where to Check | Why |
|---|---|---|
| **Can view** on the Confluence Space(s) containing Solution Design pages | Confluence > Space Settings > Permissions | The MCP server reads page content via `GET /rest/api/content/{pageId}` |

**What the MCP server does with Confluence access:**

- **Reads** page content (title + body) for Solution Design documents
- Strips HTML to plain text for AI consumption

**What it does NOT do:**

- Never writes, creates, or modifies Confluence pages
- Never reads comments, attachments, or space settings
- Never accesses user profile data

That's it -- **read-only access to page content only**.

#### Fill in the Credentials

Open `~/.ado-testforge-mcp/credentials.json` and fill in the three Confluence fields:

| Field | What to Enter | Example |
|---|---|---|
| `confluence_base_url` | Your Confluence Cloud base URL (with `/wiki`) | `https://your-org.atlassian.net/wiki` |
| `confluence_email` | The email address of your Atlassian account | `kavita.badgujar@company.com` |
| `confluence_api_token` | The API token you created above | `ATATT3x...` |

### Path 2: If You Move to OAuth 2.0 (3LO) Scopes

If your team later migrates to an Atlassian OAuth 2.0 (3-legged) app for shared/production use, you'll configure granular scopes instead of relying on user-level permissions. This requires registering an app at [developer.atlassian.com](https://developer.atlassian.com/console/myapps/).

#### Classic Scopes (current Atlassian model)

| Scope | Purpose | Required? |
|---|---|---|
| `read:confluence-content.all` | Read all page content (title + body) | **Yes** -- primary scope needed |
| `read:confluence-content.summary` | Read content summaries and metadata | Optional -- useful for page discovery |
| `read:confluence-space.summary` | Read space info | Optional -- useful for listing spaces |

#### Granular Scopes (newer Atlassian model)

| Scope | Purpose | Required? |
|---|---|---|
| `read:page:confluence` | Read page content | **Yes** -- minimum required scope |
| `read:content:confluence` | Read content including attachments | Optional |
| `read:content-details:confluence` | Read content body and metadata | Optional |
| `read:space:confluence` | Read space info | Optional |

**Minimum for this MCP server:** `read:page:confluence` (granular) or `read:confluence-content.all` (classic).

**Note:** OAuth 2.0 integration would require code changes to the authentication flow in `src/confluence-client.ts` (switching from Basic Auth to OAuth bearer tokens). The current API token approach is recommended for individual use.

### How the Confluence Integration Works

When you fetch a User Story with `get_user_story`, the tool:

1. Reads the **Technical Solution** field from the ADO work item
2. Extracts the Confluence page URL from the field value
3. Parses the page ID from the URL (supports `/pages/{pageId}/...` and `?pageId=...` formats)
4. Fetches the page content from Confluence
5. Returns it as `solutionDesignContent` alongside the other User Story fields

If Confluence is not configured or the field is empty, `solutionDesignUrl` and `solutionDesignContent` will be `null` -- all other functionality works normally.

---

## Step 5: Restart the MCP Server

1. Go to **Cursor Settings > MCP**
2. Find **ado-testforge** in the list
3. Click the **refresh/restart** button next to it
4. Wait for the green dot to appear

---

## Step 6: Verify Everything Works

In Cursor's AI chat, type `/ado-testforge` and select **check_status**. You should see:

```
Credentials file: EXISTS
ADO PAT: Configured
ADO Org: YourOrgName
ADO Project: YourProjectName
Confluence: Not configured (optional)

Status: READY -- all tools and commands are available.
```

If you see **READY**, setup is complete.

### Post-Setup: Verify Tools & Commands

After deployment, verify:

- **21 tools** total (including `list_work_item_fields`, `delete_test_case`)
- **Commands:** `/ado-testforge/delete_test_cases` (batch delete), `/ado-testforge/update_test_case`, `/ado-testforge/list_work_item_fields`
- **Title limit:** Test case titles ≤ 256 characters (ADO constraint)

---

## You're All Set

You can now use any of the available commands. Type `/ado-testforge` in the chat to see the full list:

| Command | What It Does |
|---|---|
| `/ado-testforge/check_status` | Verify your setup |
| `/ado-testforge/list_test_plans` | List all test plans in your project |
| `/ado-testforge/get_user_story` | Fetch a User Story with full context |
| `/ado-testforge/get_test_plan` | Get test plan details |
| `/ado-testforge/list_test_suites` | List all suites in a test plan |
| `/ado-testforge/get_test_suite` | Get test suite details |
| `/ado-testforge/create_test_suite` | Create test suite structure — asks only User Story ID (derives plan and sprint from US) |
| `/ado-testforge/update_test_suite` | Ensure or update test suite structure — asks only User Story ID |
| `/ado-testforge/ensure_suite_hierarchy_for_us` | Same as create — ensures folder structure from User Story ID only |
| `/ado-testforge/delete_test_suite` | Delete a test suite (test cases remain, only suite association removed) |
| `/ado-testforge/ensure_suite_hierarchy` | Build the test suite folder structure |
| `/ado-testforge/draft_test_cases` | Generate a test case draft for review (never creates in ADO) |
| `/ado-testforge/create_test_cases` | Push reviewed test cases to ADO (requires prior draft + confirmation) |
| `/ado-testforge/list_test_cases` | List test cases in a suite |
| `/ado-testforge/get_test_case` | View a test case by ID |
| `/ado-testforge/update_test_case` | Update one or more fields of an existing test case (partial or full) |
| `/ado-testforge/list_work_item_fields` | List all work item field definitions (reference names, types) |
| `/ado-testforge/delete_test_case` | Delete a test case (Recycle Bin by default) |
| `/ado-testforge/delete_test_cases` | Delete multiple test cases by ID (Recycle Bin by default) |
| `/ado-testforge/get_confluence_page` | Read a Confluence page for reference |
| `/ado-testforge/clone_and_enhance_test_cases` | Clone TCs from source US to target US — analyzes target + Solution Design, classifies impact, preview → APPROVED creates in ADO |

You can also use natural language instead of commands. For example, type "Fetch user story 1273966 from ADO" and the AI will call the right tool.

---

## Rules for tc-drafts (Formatting & Style)

If you use a **separate workspace** for test case drafts (e.g. a local repo with `tc-drafts/`), copy the rule file so formatting applies:

- **Source:** `Cursor-ADO-TC-Automation/.cursor/rules/test-case-draft-formatting.mdc`
- **Destination:** `YourWorkspace/.cursor/rules/test-case-draft-formatting.mdc`

Or add the MCP project folder to your workspace (multi-root) so the rules apply when editing drafts.

See [docs/test-case-writing-style-reference.md](docs/test-case-writing-style-reference.md) for test case styling (title format, "should" form, pre-requisites).

### TC Draft Storage (No Hardcoded Path)

**You choose where drafts are stored.** No default path is hardcoded.

| Method | When to Use |
|--------|-------------|
| **workspaceRoot** | Open a folder in your workspace. The AI passes `workspaceRoot`; drafts go to `workspaceRoot/tc-drafts/` (created if missing). |
| **draftsPath** | When you say "save to X" or "create under folder Y", the AI passes `draftsPath` with your chosen location. |
| **tc_drafts_path** | Set in `~/.ado-testforge-mcp/credentials.json` for a fixed path. Optional. |
| **TC_DRAFTS_PATH** | Environment variable. Optional. |

**Behavior:** If you open a fresh folder and ask to draft TCs, the command creates `tc-drafts/` under that folder and saves there. If you add a folder to workspace and ask to create TCs under it, drafts go to that folder (or its `tc-drafts/` subfolder).

**Deferred JSON:** Only markdown is saved until you push. When you confirm push to ADO, the tool parses the markdown and generates JSON with correct mappings. This avoids JSON drift during multiple revisions.

---

## Troubleshooting

### I don't see `/setup-ado-testforge` in the chat

Add the ADO TestForge MCP folder to your workspace first: **File > Add Folder to Workspace** and select the folder. The install command is available only when that folder is part of your workspace.

### "ado-testforge" shows a red dot

The main server can't start because setup isn't complete. Run `/setup-ado-testforge/install` first, then configure your credentials (Steps 3-5 above).

### "setup-ado-testforge" shows a red dot

Node.js may not be installed or not in your PATH. Run `node -v` in a terminal to verify. If it's not found, install Node.js from [https://nodejs.org](https://nodejs.org).

### ADO TestForge MCP doesn't appear when I open a different project folder

Run `/setup-ado-testforge/install` again (with the ADO TestForge MCP folder in your workspace) — it registers ado-testforge globally. If you've already run it, restart Cursor to reload the global MCP config.

### npm install fails

- Check your internet connection
- Make sure you're not behind a corporate proxy that blocks npm
- Try running `npm install` manually in a terminal from the `ADO TestForge MCP` folder

### "No valid credentials found" after restart

- Open `~/.ado-testforge-mcp/credentials.json` and verify you replaced all placeholder values
- Make sure the `ado_pat`, `ado_org`, and `ado_project` fields are not empty
- Run `/ado-testforge/check_status` to see which field is missing

### PAT authentication errors (401)

- Your PAT may have expired -- create a new one in ADO
- Verify the PAT has the correct scopes (Work Items + Test Management)
- Make sure `ado_org` is just the organization name (e.g., `MarsDevTeam`), not the full URL

### Confluence 401 Unauthorized

When `get_user_story` or `get_confluence_page` returns "401 Unauthorized" when fetching Solution Design:

1. **Base URL** — Must be `https://yoursite.atlassian.net/wiki` (no `/spaces/...` or page path).  
   Example for Mars: `https://marsaoh.atlassian.net/wiki`

2. **Email** — Must match your Atlassian account exactly (e.g., `kavita.badgujar@salesforce.com`)

3. **API token** — Create a new token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Tokens can expire.

4. **Space permissions** — Your account must have **Can view** on the Confluence space (e.g., GCTP). Check Space Settings > Permissions.

5. **Credentials location** — Add to `~/.ado-testforge-mcp/credentials.json`:
   ```json
   "confluence_base_url": "https://marsaoh.atlassian.net/wiki",
   "confluence_email": "your.email@company.com",
   "confluence_api_token": "ATATT3x..."
   ```
   Or use env vars: `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`.

6. **Restart** — After changing credentials, restart the MCP server (Cursor Settings > MCP > refresh ado-testforge).

### Tools return "Resource not found" (404)

- Double-check that `ado_project` matches your ADO project name exactly (case-sensitive, spaces included)
- Verify you have access to the project in ADO

---

## How Global Registration Works

The installer adds **ado-testforge** (the main server) to your **global** Cursor config (`~/.cursor/mcp.json`) with absolute paths. The **setup-ado-testforge** installer stays project-scoped — it's only available when the ADO TestForge MCP folder is in your workspace. That means:

- **ado-testforge** is available in **any project folder** you open — use `/ado-testforge` for all ADO commands
- **setup-ado-testforge** is only for installation — add the ADO TestForge MCP folder to workspace if you need to re-run setup
- If you move the ADO TestForge MCP folder, add it to workspace and run `/setup-ado-testforge/install` again to update the paths

---

## Credential Security

Your credentials are stored at `~/.ado-testforge-mcp/credentials.json` in your **home directory** -- not in the shared project folder. This means:

- Your PAT is never synced to Google Drive
- Your PAT never appears in Cursor's chat history
- Each team member has their own separate credentials
- Deleting or re-sharing the project folder does not affect your credentials

To update your credentials at any time, edit the file directly or run `/setup-ado-testforge/install` again.
