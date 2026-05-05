# VortexADO MCP \-\- Setup Guide

**Documentation index:** [docs/README.md](README.md) | **Changelog:** [docs/changelog.md](changelog.md)

Welcome to the VortexADO MCP server. This guide walks you through the complete setup process so you can start using ADO tools directly from Cursor's AI chat.

---

## Quick Start: One\-Command Installation

**Run this single command in your terminal:**

```bash
curl -fsSL https://raw.githubusercontent.com/badgujar-kavita/ado-mcp-server/main/install.sh | bash
```

The installer will:

* Check prerequisites (Node.js v18+)
* Clone the repository to `~/.vortex-ado`
* Install dependencies and build
* Register VortexADO MCP in Cursor
* Create a credentials template at `~/.vortex-ado/credentials.json`

**After installation:**

1. **Configure credentials** \-\- Edit `~/.vortex-ado/credentials.json` with your ADO PAT, org, and project (see [Step 2](#step-2-configure-your-credentials))
2. **Restart Cursor** (or reload MCP in Settings > MCP)
3. **Verify** \-\- Type `/vortex-ado/ado-check` in AI chat

After setup, VortexADO MCP is available in **all workspaces** automatically.

---

## Prerequisites

Before you begin:

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

Replace `{your-org}` with your ADO organization name (e.g., `YourOrgName`).

2. Click **+ New Token**
3. Configure the token:
   * **Name**: `VortexADO MCP` (or any name you prefer)
   * **Expiration**: 90 days recommended
   * **Scopes**: Select **Custom defined**, then enable the scopes listed below
4. Click **Create**
5. **Copy the token immediately** \-\- you won't be able to see it again

Keep the token somewhere safe (e.g., a password manager). You'll need it in Step 2.

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

## Step 2: Configure Your Credentials

### Option A: Use the Configuration UI (Recommended)

After restarting Cursor, run this command in the AI chat:

```
/vortex-ado/ado-connect
```

This opens a beautiful web interface where you can:

* Enter your Azure DevOps credentials
* Optionally configure Confluence
* **Test connections before saving**
* Save credentials securely

### Option B: Edit Manually

If you prefer to edit the file directly:

1. Open the credentials file:

**Mac:**

```bash
open ~/.vortex-ado/credentials.json
```

**Windows (PowerShell):**

```powershell
notepad "$env:USERPROFILE\.vortex-ado\credentials.json"
```

2. The file looks like this:

```json
{
  "ado_pat": "your-personal-access-token",
  "ado_org": "your-organization-name",
  "ado_project": "your-project-name",
  "confluence_base_url": "",
  "confluence_email": "",
  "confluence_api_token": ""
}
```

3. Replace the placeholder values:

| Field | What to Enter | Example |
|---|---|---|
| `ado_pat` | The PAT you created in Step 1 | `ghp4x7abc123...` |
| `ado_org` | Your ADO organization name (from `https://dev.azure.com/{org}`) | `YourOrgName` |
| `ado_project` | Your ADO project name | `TPM Product Ecosystem` |

The Confluence fields are **optional** \-\- leave them empty if you don't use Confluence. See [Step 2b](#step-2b-configure-confluence-optional) for Confluence setup.

4. **Save the file**

**Important:** Never paste your PAT in Cursor's chat. Your credentials are stored locally and are never shared.

---

## Step 2b: Configure Confluence (Optional)

If your User Stories have Solution Design documents linked in the **Solution Notes** field (ADO field name: "Technical Solution"), you can configure Confluence so the MCP server automatically fetches that content when you run `ado_story`. This gives the AI richer context for test case generation.

### Path 1: Confluence Cloud API Token (Current Setup)

This is the approach the MCP server uses today. It's the simplest option for individual use.

#### How to Create the Token

1. Go to [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Give it a label (e.g., `VortexADO MCP`)
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

Open `~/.vortex-ado/credentials.json` and fill in the three Confluence fields:

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

When you fetch a User Story with `ado_story`, the tool:

1. Reads the **Technical Solution** field from the ADO work item
2. Extracts the Confluence page URL from the field value
3. Parses the page ID from the URL (supports `/pages/{pageId}/...` and `?pageId=...` formats)
4. Fetches the page content from Confluence
5. Returns it as `solutionDesignContent` alongside the other User Story fields

If Confluence is not configured, the field is empty, or the linked page cannot be fetched, `solutionDesignUrl` and `solutionDesignContent` will stay `null` — the core ADO workflow continues normally with no degraded experience.

---

## Step 2c: Tune Context Richness (Optional)

The following knobs in `conventions.config.json` control how much work-item context `ado_story` returns. Both are optional — defaults work for most teams.

> **⚠️ Important — edits to `conventions.config.json` are overwritten by re-install.**
>
> The file lives at `~/.vortex-ado/conventions.config.json`. It IS created automatically on first install (the tarball contains it), and the MCP reads your edits at runtime — so tweaking values locally works as expected. **But** the installer (curl one-liner) overwrites this file on every re-install with the latest repo defaults. Only `credentials.json` is preserved across re-installs today.
>
> If you flip `returnMcpImageParts` or add entries to `additionalContextFields`, either keep a copy of your edits somewhere safe, or plan to re-apply them after running the installer to upgrade. (A future installer improvement may preserve this file too.)

### Enabling embedded image vision (optional)

By default `ado_story` returns work-item context as a single text content part. To let vision-capable MCP clients (Cursor, Claude Desktop) see ADO-attached screenshots and Confluence diagrams directly, flip this flag in `conventions.config.json`:

```json
{
  "images": {
    "returnMcpImageParts": true
  }
}
```

After editing, restart the MCP server. The tool now returns image bytes as additional content parts alongside the text JSON — the client renders them as vision input.

**Confluence token scope:** downloading attachment bytes (not just listing them) requires the `read:attachment.download:confluence` scope on the Atlassian API token. If the scope is missing, images surface as `skipped: "fetch-failed"` in the response — the MCP reports this cleanly so the agent can prompt the user. Fix: use an unscoped/classic token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens), or add the download scope to an existing scoped token.

**Response-size cap:** `images.maxTotalBytesPerResponse` (default 4 MiB) limits total base64 image payload per call so Claude's context window isn't blown by an image-heavy user story. Excess images are reported in the JSON with `skipped: "response-budget"` and their `originalUrl` remains clickable.

### Adding custom fields to the agent's context

The MCP scans the following ADO fields by default on every User Story fetch:

- `System.Title`
- `System.Description`
- `Microsoft.VSTS.Common.AcceptanceCriteria`
- `Custom.TechnicalSolution` (Solution Notes — configurable via `solutionDesign.adoFieldRef`)

If your project uses additional custom fields (Impact Assessment, Reference Documentation, Business Justification, etc.) that contain test-design-relevant content, add them to `additionalContextFields` in `conventions.config.json`:

```json
{
  "additionalContextFields": [
    { "adoFieldRef": "Custom.ImpactAssessment", "label": "Impact Assessment", "fetchLinks": true, "fetchImages": true },
    { "adoFieldRef": "Custom.ReferenceDocumentation", "label": "Reference Documentation", "fetchLinks": true, "fetchImages": true },
    { "adoFieldRef": "Custom.BusinessJustification", "label": "Business Justification", "fetchLinks": false, "fetchImages": false }
  ]
}
```

Each entry adds the field to `namedFields` in the response. `fetchLinks` controls whether Confluence URLs found in the field are auto-fetched (default `true`); `fetchImages` controls whether embedded `<img>` attachments are downloaded (default `true`).

To discover the `adoFieldRef` of a field you see in the ADO UI, use the `ado_fields` tool — it returns both the display name and the reference name.

Every other populated field (standard + custom) is still surfaced in `allFields` as a pass-through map, with system-noise fields filtered out by default. You don't need to register them — the agent scans the map for anything that looks relevant.

---

## Step 3: Restart the MCP Server

1. Go to **Cursor Settings > MCP**
2. Find **vortex-ado** in the list
3. Click the **refresh/restart** button next to it
4. Wait for the green dot to appear

---

## Step 4: Verify Everything Works

In Cursor's AI chat, type `/vortex-ado` and select **ado-check**.

### First Successful Run

On the first successful run for a given version, you should see a full welcome message followed by your setup status:

```
Welcome to VortexADO MCP v1.1.0

Your AI-powered QA co-pilot is ready.

VortexADO MCP connects Cursor IDE directly to Azure DevOps — so you can draft,
review, and push test cases without ever leaving your editor.

Two ways to work — pick what feels natural:
- Slash command: /vortex-ado/qa-draft
- Plain English: "Draft test cases for User Story #12345"

Ready? Start here:
- /vortex-ado/ado-story — Fetch a User Story with full QA context
- /vortex-ado/qa-draft — Generate test cases ready for ADO
- /vortex-ado/ado-check — Verify your setup anytime

Quick start: Try /vortex-ado/ado-story or say "Draft test cases for User Story #12345".

Setup Status
------------
ADO PAT: Configured
ADO Org: YourOrgName
ADO Project: YourProjectName
TC Drafts: /Users/you/.vortex-ado/tc-drafts

Status: READY — all tools and commands are available.
```

### Returning User (Same Version)

After the first run, the status output becomes brief:

```
VortexADO MCP v1.1.0 | Status: ✓ Ready

ADO PAT: Configured
ADO Org: YourOrgName
ADO Project: YourProjectName
TC Drafts: /Users/you/.vortex-ado/tc-drafts
```

### After a New Deploy

If a newer version has been deployed, `ado-check` shows a short "What's New" summary once, then updates your local first-run flag.

If you see **READY**, setup is complete.

### Post-Setup: Verify Tools & Commands

After deployment, verify:

- **20 slash commands** + **26 MCP tools** (including `ado_fields`, `qa_tc_delete`)
- **Commands:** `/vortex-ado/qa-tc-delete` (single or batch), `/vortex-ado/qa-tc-update`, `/vortex-ado/ado-fields`
- **Title limit:** Test case titles ≤ 256 characters (ADO constraint)

---

## You're All Set

You can now use any of the available commands. Type `/vortex-ado` in the chat to see the full list:

| Command | What It Does |
|---|---|
| `/vortex-ado/ado-connect` | Set up ADO and Confluence credentials via a guided web UI |
| `/vortex-ado/ado-check` | Verify ADO credentials, Confluence config, and server health |
| `/vortex-ado/ado-plans` | List all test plans in the ADO project |
| `/vortex-ado/ado-story` | Fetch a User Story — fields, Confluence pages, images, and links |
| `/vortex-ado/qa-tests` | List test cases linked to a User Story (Tests/Tested By) |
| `/vortex-ado/ado-plan` | Read a test plan by ID — area path, state, root suite |
| `/vortex-ado/ado-suites` | List all test suites in a test plan |
| `/vortex-ado/ado-suite` | Read a test suite by ID — type, parent, query string |
| `/vortex-ado/qa-suite-setup` | Create or fix the Sprint → Epic → US suite hierarchy from a User Story ID |
| `/vortex-ado/qa-suite-update` | Update a test suite — rename, move, or change its query |
| `/vortex-ado/qa-suite-delete` | Delete a test suite — test cases stay in ADO, only the suite link is removed |
| `/vortex-ado/qa-draft` | Draft test cases as reviewable markdown — never pushes to ADO |
| `/vortex-ado/qa-publish` | Push a reviewed draft to ADO — creates test cases after explicit confirmation |
| `/vortex-ado/ado-suite-tests` | List test cases within a specific test suite |
| `/vortex-ado/qa-tc-read` | Read a test case — title, steps, prerequisites, priority, and state |
| `/vortex-ado/qa-tc-update` | Update a test case — title, steps, prerequisites, priority, or assignment |
| `/vortex-ado/ado-fields` | List all ADO field definitions — reference names, types, and read-only status |
| `/vortex-ado/qa-tc-delete` | Delete one or more test cases by ID — moves to Recycle Bin (restorable for 30 days) |
| `/vortex-ado/qa-clone` | Clone and adapt test cases from one User Story to another |
| `/vortex-ado/confluence-read` | Read a Confluence page by ID — useful for Solution Design reference |

You can also use natural language instead of commands. For example, type "Fetch user story 1273966 from ADO" and the AI will call the right tool.

---

## Best Practices

### Scalability

- All naming conventions and formatting rules live in `conventions.config.json`, so many future adjustments do not require code changes.
- Most workflows are composed in prompts and skills, which keeps the MCP tools focused and reusable across projects.

### Reliability

- Run `/vortex-ado/ado-check` after setup or deployment to verify the current version and status before starting work.
- Confluence is optional. If it is not configured or a linked page cannot be fetched, the core ADO workflow still works and `solutionDesignContent` stays `null`.
- The welcome flow uses a first-run flag file so users see the full orientation once per version instead of on every status check.

### Maintainability

- `npm run build:dist` rebuilds `dist-package/` from the current source. Distribution to end users happens via the Vercel-hosted tarball (`scripts/build-website.sh` rebuilds `/vortex-ado.tar.gz` on every Vercel deploy); users pick up updates by re-running the one-line install command.
- Version-aware status output makes it easy to confirm which build a user is currently running.

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
| **workspaceRoot** | Open a folder in your workspace. The AI passes `workspaceRoot`; drafts go to `workspaceRoot/tc-drafts/US_<id>/` (folder created automatically). |
| **draftsPath** | When you say "save to X" or "create under folder Y", the AI passes `draftsPath` with your chosen location. |
| **tc_drafts_path** | Set in `~/.vortex-ado/credentials.json` for a fixed path. Optional. |
| **TC_DRAFTS_PATH** | Environment variable. Optional. |

**Folder Structure:** Each User Story gets its own subfolder:

```
tc-drafts/
└── US_1399001/
    ├── US_1399001_test_cases.md              (main draft)
    ├── US_1399001_solution_design_summary.md (business logic reference)
    ├── US_1399001_qa_cheat_sheet.md          (QA execution aid)
    └── US_1399001_test_cases.json            (generated on push)
```

**Behavior:** If you open a fresh folder and ask to draft TCs, the command creates `tc-drafts/US_<id>/` under that folder and saves all three files there. The main test cases file includes relative links to the supporting documents.

**Backward Compatibility:** Legacy flat drafts (`tc-drafts/US_<id>_test_cases.md`) are still readable and pushable.

**Deferred JSON:** Only markdown is saved until you push. When you confirm push to ADO, the tool parses the markdown and generates JSON co-located with the markdown. This avoids JSON drift during multiple revisions.

---

## Troubleshooting

### "ado\-testforge" shows a red dot

The server can't start. Common causes:

* Node.js is not installed or not in your PATH. Run `node -v` to verify.
* The installation may be corrupted. Re\-run the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/badgujar-kavita/ado-mcp-server/main/install.sh | bash
```

### VortexADO MCP doesn't appear in Cursor

* **Restart Cursor** after installation
* Check **Cursor Settings > MCP** \-\- ado\-testforge should be listed
* If missing, re\-run the installation command above

### Installation fails

* Check your internet connection
* Make sure you're not behind a corporate proxy that blocks npm/git
* Ensure Node.js v18+ is installed: `node -v`

### "No valid credentials found" after restart

- Open `~/.vortex-ado/credentials.json` and verify you replaced all placeholder values
- Make sure the `ado_pat`, `ado_org`, and `ado_project` fields are not empty
- Run `/vortex-ado/ado-check` to see which field is missing

### PAT authentication errors (401)

- Your PAT may have expired -- create a new one in ADO
- Verify the PAT has the correct scopes (Work Items + Test Management)
- Make sure `ado_org` is just the organization name (e.g., `YourOrgName`), not the full URL

### Confluence 401 Unauthorized

When `ado_story` or `confluence_read` returns "401 Unauthorized" when fetching Solution Design:

1. **Base URL** — Must be `https://yoursite.atlassian.net/wiki` (no `/spaces/...` or page path).  
   Example: `https://your-org.atlassian.net/wiki`

2. **Email** — Must match your Atlassian account exactly (e.g., `your.email@company.com`)

3. **API token** — Create a new token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Tokens can expire.

4. **Space permissions** — Your account must have **Can view** on the Confluence space (e.g., GCTP). Check Space Settings > Permissions.

5. **Credentials location** — Add to `~/.vortex-ado/credentials.json`:
   ```json
   "confluence_base_url": "https://your-org.atlassian.net/wiki",
   "confluence_email": "your.email@company.com",
   "confluence_api_token": "ATATT3x..."
   ```
   Or use env vars: `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`.

6. **Restart** — After changing credentials, restart the MCP server (Cursor Settings > MCP > refresh vortex-ado).

### Tools return "Resource not found" (404)

- Double-check that `ado_project` matches your ADO project name exactly (case-sensitive, spaces included)
- Verify you have access to the project in ADO

---

## How Global Registration Works

The installer adds **ado\-testforge** to your **global** Cursor config (`~/.cursor/mcp.json`) with absolute paths pointing to `~/.vortex-ado`. That means:

* **ado\-testforge** is available in **any project folder** you open
* Use `/vortex-ado` commands from any workspace
* To update, simply re\-run the curl installation command

---

## Credential Security

Your credentials are stored at `~/.vortex-ado/credentials.json` in your **home directory**. This means:

* Your PAT is stored locally only \-\- never synced or shared
* Your PAT never appears in Cursor's chat history
* Each team member has their own separate credentials
* Re\-installing does not overwrite existing credentials

To update your credentials at any time, edit the file directly.

---

## Updating

To update to the latest version, simply re\-run the installation command:

```bash
curl -fsSL https://raw.githubusercontent.com/badgujar-kavita/ado-mcp-server/main/install.sh | bash
```

The installer will:

* Pull the latest changes
* Rebuild the project
* Preserve your existing credentials

---

## Uninstalling

To completely remove VortexADO MCP:

```bash
curl -fsSL https://raw.githubusercontent.com/badgujar-kavita/ado-mcp-server/main/uninstall.sh | bash
```

This will:

* Remove `~/.vortex-ado` directory
* Remove the MCP registration from Cursor

**Note:** The uninstaller will ask if you want to keep or delete your credentials file.
