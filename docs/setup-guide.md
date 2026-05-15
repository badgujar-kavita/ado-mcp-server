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

**After installation:**

1. **Open your project folder in Cursor** (per-workspace config lives next to the project — supports running multiple ADO projects in parallel windows)
2. **Configure credentials** \-\- Run `/vortex-ado/ado-connect` from inside the workspace; it writes `<workspace>/.vortex-ado/config.json` and stores your PAT in the OS keychain (see [Step 2](#step-2-configure-your-credentials))
3. **Restart Cursor** (or reload MCP in Settings > MCP)
4. **Verify** \-\- Type `/vortex-ado/ado-check` in AI chat

After setup, VortexADO MCP is available in **all workspaces** automatically. Each workspace carries its own config — two Cursor windows on two different ADO projects work in parallel without sharing state.

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

> ✅ **Phase 2 update.** `/vortex-ado/ado-connect` is now a **two-tab wizard** that collects per-project conventions in addition to credentials. Tab 1 saves your ADO + Confluence connection; Tab 2 saves sprint prefix, test plan mappings, personas, field references, and additional context fields. Both tabs save independently to `<workspace>/.vortex-ado/config.json` (PAT/tokens still go to the OS keychain — never to disk). Run the wizard once **per project workspace** — two Cursor windows on two ADO projects stay isolated. See [docs/conventions.md](conventions.md) for the full schema.

### Option A: Use the Configuration UI (Recommended)

Open your project folder in Cursor, then in the AI chat run:

```
/vortex-ado/ado-connect
```

This opens a two-tab web interface.

**Tab 1 — Connection.** Enter your ADO credentials (org, project, full URL, PAT) and optionally Confluence (URL, email, API token). Click **Validate and Save Connection** — the wizard validates the typed PAT against ADO **before** writing anything to disk or keychain, so a bad PAT can't half-save. On success, the wizard auto-navigates to Tab 2.

- ℹ️ **Returning users** can leave the PAT field blank to reuse the keychain entry. The PAT input shows a **"stored in keychain"** pill in this case; the wizard silently re-validates the stored PAT before saving.
- ⚠️ **Org/project change** — if you typed a different `org` or `project` than the prior config, Tab 2 shows a banner asking whether to **Reuse existing conventions** (loads existing personas, sprintPrefix, field refs as pre-fills; plan mappings re-probed against the new project) or **Start fresh**.

**Tab 2 — Conventions.** Disabled until Tab 1 has saved a valid connection. For returning users with a valid stored PAT, Tab 2 unlocks immediately. The wizard probes your ADO project for plans, custom fields, and the iteration tree, then renders a form to set:

- **Sprint folder prefix** (default `Sprint_`; the iteration probe surfaces a recurring pattern as a placeholder).
- **Test plan mappings** — checkbox list of probed plans, each with an auto-suggested AreaPath fragment you can edit.
- **Personas** — add/edit/remove via a modal: **Display label / Profile / Role(s) / Permission Set or Permission Set Group**. Empty by default. Internal JSON keys are auto-derived from the display label, so there's no key field to set.
- **Prerequisite field reference** — dropdown filtered to `Custom.*` fields whose name contains `Prerequisite` or `Pre-requisite`. Defaults to `System.Description`.
- **Solution Design field reference** — dropdown filtered to `Custom.*` fields whose name contains `solution`, `technical`, `design`, or `spec`. Optional.
- **Additional context fields** — add/remove rows; each row picks an HTML / string / plainText custom field plus a display label.
- **Enable image fetching** — checkbox; off by default. When on, `/qa-draft` downloads embedded images from ADO HTML fields and any linked Confluence pages, downscales them, and inlines them in the agent context so the AI can reference screenshots and diagrams while drafting test cases. Leave off if your team doesn't rely on screenshots in user stories.

The Test Case title format is shown read-only on Tab 2 — it's locked to `TC_<userStoryId>_<NN> -> <featureTags> -> <use case>` so the draft → ADO sync parser can round-trip cleanly. Custom prefixes are deferred to a future phase.

Click **Save Conventions** when done. The wizard runs a **diff-based confirmation modal** — if nothing changed vs. what was loaded, the save is silently skipped. If there are changes, you'll see:

> ⚠️ **Update Conventions**
> You're about to update your project conventions. Existing values for any field you changed will be overwritten. Continue?
> [Cancel] [Confirm]

A JSON preview of what's about to be saved is rendered below the prompt. Tab 1 and Tab 2 save independently — a PAT change won't touch your conventions, and a convention edit won't touch the keychain.

🚫 The wizard refuses to write into your home directory or a non-writable cwd — open the actual project folder first.

### Option B: Edit Manually

If you prefer to set up by hand:

1. Create `<workspace>/.vortex-ado/config.json` with at least the `ado` block:

```json
{
  "version": 1,
  "ado": {
    "url": "https://dev.azure.com/YourOrgName",
    "org": "YourOrgName",
    "project": "Your Project Name"
  }
}
```

2. Store the PAT in your OS keychain under service `vortex-ado`, account `ado::YourOrgName::Your Project Name`:

   **Mac:**
   ```bash
   security add-generic-password -s "vortex-ado" -a "ado::YourOrgName::Your Project Name" -w "your-pat-here"
   ```

   **Windows (PowerShell):**
   ```powershell
   cmdkey /generic:"vortex-ado/ado::YourOrgName::Your Project Name" /user:"vortex-ado" /pass:"your-pat-here"
   ```

   **Linux:**
   ```bash
   echo -n "your-pat-here" | secret-tool store --label "vortex-ado" service vortex-ado account "ado::YourOrgName::Your Project Name"
   ```

3. Confluence fields are **optional** \-\- leave them out of `config.json` if you don't use Confluence. See [Step 2b](#step-2b-configure-confluence-optional).

> **Important:** Never paste your PAT in Cursor's chat. The keychain keeps it off disk and out of any backup that captures your home directory.

> **Note on `~/.vortex-ado/credentials.json`.** The MCP no longer creates this file. Earlier installs may have one left over from the pre-wizard era; the MCP will still read it on startup as a one-time fallback so a tester with real values doesn't get hard-broken, but the file is no longer the supported credential location. Re-run `/ado-connect` and you can safely delete the file.

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

The easiest way is to fill in Confluence inside `/vortex-ado/ado-connect` — the wizard saves URL + email to `<workspace>/.vortex-ado/config.json` under `confluence` and the API token to the OS keychain (account `confluence::{org}::{project}`).

If you'd rather configure manually, add a `confluence` block to `<workspace>/.vortex-ado/config.json`:

| `config.json` field | What to Enter | Example |
|---|---|---|
| `confluence.url` | Your Confluence Cloud base URL (with `/wiki`) | `https://your-org.atlassian.net/wiki` |
| `confluence.email` | The email address of your Atlassian account | `kavita.badgujar@company.com` |

Then store the API token in your OS keychain under service `vortex-ado`, account `confluence::{org}::{project}`. See [docs/conventions.md § 7](conventions.md#7-where-credentials-live) for per-platform commands.

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

The following knobs in your **per-workspace** config (`<workspace>/.vortex-ado/config.json`) control how much work-item context `ado_story` returns. Both are optional — framework defaults work for most teams.

> ✅ **Phase 2 update.** Your `<workspace>/.vortex-ado/config.json` is **not** touched by re-installs. The installer only updates the MCP runtime (under `~/.vortex-ado/`); your per-workspace config and your keychain entries are completely separate. `additionalContextFields` and `personas` are now collected via the **Conventions tab** of `/ado-connect` — you only need to hand-edit the JSON for the `images.*` and `context.*` knobs covered in this section. Re-running `/ado-connect` Tab 1 only updates the connection block; Tab 2 only updates the conventions blocks; neither tab touches the fields the other manages. As of Phase 4, the legacy global `~/.vortex-ado/conventions.config.json` is no longer read — `<workspace>/.vortex-ado/config.json` is the only config source. Run `/ado-connect` once per workspace to populate it.

### Enabling embedded image vision (optional)

By default `ado_story` returns work-item context as a single text content part. To let vision-capable MCP clients (Cursor, Claude Desktop) see ADO-attached screenshots and Confluence diagrams directly, flip this flag in `<workspace>/.vortex-ado/config.json`:

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

If your project uses additional custom fields (Impact Assessment, Reference Documentation, Business Justification, etc.) that contain test-design-relevant content, add them to `additionalContextFields` in `<workspace>/.vortex-ado/config.json`:

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
| `/vortex-ado/qa-publish` | Push a reviewed draft to ADO — agent guides you through confirmation at every step |
| `/vortex-ado/ado-suite-tests` | List test cases within a specific test suite |
| `/vortex-ado/qa-tc-read` | Read a test case — title, steps, prerequisites, priority, and state |
| `/vortex-ado/qa-tc-update` | Update a test case, or apply the same fields uniformly to many |
| `/vortex-ado/ado-fields` | List all ADO field definitions — reference names, types, and read-only status |
| `/vortex-ado/qa-tc-delete` | Delete one or more test cases by ID — moves to Recycle Bin (restorable for 30 days) |
| `/vortex-ado/qa-clone` | Clone and adapt test cases from one User Story to another |
| `/vortex-ado/confluence-read` | Read a Confluence page by ID — useful for Solution Design reference |

You can also use natural language instead of commands. For example, type "Fetch user story 1273966 from ADO" and the AI will call the right tool.

---

## Best Practices

### Scalability

- All naming conventions and formatting rules live in `<workspace>/.vortex-ado/config.json` (per-workspace, merged on top of framework defaults), so many future adjustments do not require code changes. See [docs/conventions.md](conventions.md).
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

- Run `/vortex-ado/ado-connect` from inside your workspace folder — this writes `<workspace>/.vortex-ado/config.json` and stores your PAT in the OS keychain.
- If the wizard refuses with "refusing to write into home directory", it means you opened Cursor without a project folder. Open the actual project folder and retry.
- Run `/vortex-ado/ado-check` to see which field is missing.

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

5. **Credentials location** — Easiest fix: re-run `/vortex-ado/ado-connect` and re-enter the Confluence section. The wizard updates `<workspace>/.vortex-ado/config.json` and stores the API token in the OS keychain (account `confluence::{org}::{project}`). Manual layout:
   ```jsonc
   // <workspace>/.vortex-ado/config.json
   "confluence": {
     "enabled": true,
     "url":     "https://your-org.atlassian.net/wiki",
     "email":   "your.email@company.com"
   }
   ```
   Plus the API token in the OS keychain. Or use env vars: `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`.

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

As of Phase 1, your PAT and Confluence API token are stored in the **OS keychain** (macOS Keychain / Windows Credential Manager / Linux libsecret) under service `vortex-ado`. Connection identifiers (org, project, URL) live in `<workspace>/.vortex-ado/config.json`. This means:

* Your PAT is stored in the OS-managed credential store \-\- never on disk, never synced or shared
* Your PAT never appears in Cursor's chat history
* Each team member has their own separate credentials
* Each workspace has its own connection context (two Cursor windows on two ADO projects = two isolated configs)
* Re\-running `/ado-connect` preserves fields you didn't change — Tab 1 only writes the `ado` + `confluence` blocks; Tab 2 only writes `suiteStructure`, `prerequisiteDefaults.personas`, `ado.fieldRefs`, and `additionalContextFields`. Hand-edited fields (`testCaseTitle.prefix`, persona role/PSG labels, framework-default overrides) are never touched by either tab.

To update your credentials at any time, re-run `/vortex-ado/ado-connect` from inside the workspace, or use your OS's credential-manager UI directly. See [docs/conventions.md § 7](conventions.md#7-where-credentials-live) for inspection and deletion commands.

**Note:** The MCP no longer creates `~/.vortex-ado/credentials.json`. If you have one left over from an earlier install, the MCP still reads it as a one-time fallback so a tester with real values doesn't get hard-broken — but the file is no longer the supported credential location. Once you've run `/ado-connect`, you can delete it.

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
