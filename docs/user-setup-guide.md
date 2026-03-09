# ADO TestForge MCP — User Setup Guide

**For organization-wide use.** This guide helps you set up ADO TestForge MCP in Cursor IDE on your own—no in-person guidance required. You can complete setup in about 10–15 minutes.

---

## At a Glance

| What | Details |
|------|---------|
| **What it does** | Lets you draft, review, and push test cases to Azure DevOps directly from Cursor's AI chat |
| **Time to set up** | ~10–15 minutes |
| **Where credentials go** | Your computer only (`~/.ado-testforge-mcp/`) — never shared or synced |
| **Works in** | Any project folder after setup (globally registered) |

---

## Before You Begin

Check that you have:

- [ ] **Node.js v18 or higher** — Run `node -v` in a terminal. If missing, install from [nodejs.org](https://nodejs.org) (LTS).
- [ ] **Cursor IDE** — Latest version installed.
- [ ] **Access to Azure DevOps** — You can log in to your ADO organization.
- [ ] **The ADO TestForge MCP folder** — From your team's shared location (e.g., Google Drive: Center of Excellence (CoE) / MCP Servers).

---

## Quick Start (5 Steps)

1. **Add the folder** — In Cursor: **File → Add Folder to Workspace** → select the `ADO TestForge MCP` folder.
2. **Run the installer** — Open AI chat (Cmd+L / Ctrl+L), type `/ado-testforge/install`, and run it.
3. **Create an ADO Personal Access Token (PAT)** — See [Step 1](#step-1-create-your-ado-personal-access-token) below.
4. **Configure credentials** — Edit `~/.ado-testforge-mcp/credentials.json` with your PAT, org, and project.
5. **Restart MCP** — In Cursor: **Settings → MCP** → refresh/restart **ado-testforge**.

---

## Step-by-Step Setup

### Step 1: Create Your ADO Personal Access Token (PAT)

You need a PAT because the MCP server connects to Azure DevOps on your behalf.

1. Open your browser and go to:
   ```
   https://dev.azure.com/{your-org}/_usersSettings/tokens
   ```
   Replace `{your-org}` with your ADO organization name (e.g., from `https://dev.azure.com/YourOrg`).

2. Click **+ New Token**.

3. Configure the token:
   - **Name**: e.g., `ADO TestForge MCP` (any name you prefer)
   - **Expiration**: 90 days recommended
   - **Scopes**: Select **Custom defined**, then enable:
     - **Work Items** — Read & Write
     - **Test Management** — Read & Write

4. Click **Create**.

5. **Copy the token immediately** — you won't be able to see it again. Store it securely (e.g., password manager).

---

### Step 2: Add the ADO TestForge MCP Folder to Cursor

1. Locate the `ADO TestForge MCP` folder (from your team's shared drive or distribution).
2. Open **Cursor IDE**.
3. Go to **File → Add Folder to Workspace** (or **Open Folder** if starting fresh).
4. Select the `ADO TestForge MCP` folder.

The MCP server becomes available as soon as the folder is in your workspace. You can verify in **Cursor Settings → MCP** — **ado-testforge** should appear in the list.

---

### Step 3: Run the Installer

1. Open Cursor's **AI chat** (Cmd+L on Mac, Ctrl+L on Windows).
2. Type `/ado-testforge/install` and run the command.

The installer will:

- Check prerequisites (Node.js, folder structure)
- Create a credentials template at `~/.ado-testforge-mcp/credentials.json`
- Register ADO TestForge MCP globally so it works in any project folder

Wait for the completion message in the chat.

---

### Step 4: Configure Your Credentials

1. Open the credentials file:

   **Mac:**
   ```bash
   open ~/.ado-testforge-mcp/credentials.json
   ```

   **Windows (PowerShell):**
   ```powershell
   notepad "$env:USERPROFILE\.ado-testforge-mcp\credentials.json"
   ```

2. Replace the placeholder values:

   | Field | What to Enter | Example |
   |-------|---------------|---------|
   | `ado_pat` | The PAT you created in Step 1 | `ghp4x7abc123...` |
   | `ado_org` | Your ADO organization name | `YourOrgName` |
   | `ado_project` | Your ADO project name | `Your Project Name` |

3. **Save the file.**

> **Important:** Never paste your PAT in Cursor's chat. Edit the file directly. Your credentials stay on your machine and are never shared.

**Optional fields** (leave empty if not used):

- `confluence_base_url`, `confluence_email`, `confluence_api_token` — for Solution Design enrichment from Confluence. See [Confluence Setup (Optional)](#confluence-setup-optional) below.
- `tc_drafts_path` — custom folder for test case drafts. Default: `~/.ado-testforge-mcp/tc-drafts`.

---

### Step 5: Restart the MCP Server

1. Go to **Cursor Settings → MCP**.
2. Find **ado-testforge** in the list.
3. Click the **refresh/restart** button next to it.
4. Wait for the green status indicator.

---

### Step 6: Verify Setup

In Cursor's AI chat, type `/ado-testforge/check_status` and run it. You should see:

```
Credentials file: EXISTS
ADO PAT: Configured
ADO Org: YourOrgName
ADO Project: YourProjectName
Status: READY -- all tools and commands are available.
```

If you see **READY**, setup is complete.

---

## Confluence Setup (Optional)

If your User Stories link to Solution Design documents in Confluence, you can configure the MCP to fetch that content automatically. This gives the AI richer context when drafting test cases.

1. Create an Atlassian API token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Add these fields to `~/.ado-testforge-mcp/credentials.json`:

   | Field | What to Enter |
   |-------|---------------|
   | `confluence_base_url` | Your Confluence base URL (e.g., `https://your-org.atlassian.net/wiki`) |
   | `confluence_email` | Your Atlassian account email |
   | `confluence_api_token` | The API token you created |

3. Restart the MCP server (Settings → MCP → refresh ado-testforge).

If Confluence is not configured, the MCP works normally—Solution Design content will simply be unavailable.

---

## What You Can Do After Setup

Type `/ado-testforge` in the AI chat to see all commands. Common ones:

| Command | Purpose |
|---------|---------|
| `/ado-testforge/check_status` | Verify setup |
| `/ado-testforge/get_user_story` | Fetch a User Story with acceptance criteria |
| `/ado-testforge/draft_test_cases` | Generate a test case draft for review |
| `/ado-testforge/create_test_cases` | Push reviewed draft to ADO |
| `/ado-testforge/list_test_plans` | List test plans in your project |
| `/ado-testforge/update_test_case` | Update an existing test case |

You can also use natural language, e.g., *"Fetch user story 12345 from ADO"* or *"Draft test cases for user story 12345"*.

---

## Troubleshooting

### I don't see `/ado-testforge/install` in the chat

**Fix:** Add the ADO TestForge MCP folder to your workspace first: **File → Add Folder to Workspace** and select the folder. The install command is only available when that folder is in your workspace.

---

### "ado-testforge" shows a red dot (server won't start)

**Possible causes:**

- Node.js is not installed or not in your PATH. Run `node -v` in a terminal to verify.
- The folder structure is invalid. Ensure you're using the correct shared folder (e.g., CoE / MCP Servers).

---

### ADO TestForge doesn't appear when I open a different project

**Fix:** Run `/ado-testforge/install` again (with the ADO TestForge MCP folder in your workspace). The installer registers it globally. If you've already run it, try restarting Cursor to reload the MCP config.

---

### "No valid credentials found"

**Fix:**

1. Open `~/.ado-testforge-mcp/credentials.json`.
2. Verify you replaced all placeholder values—`ado_pat`, `ado_org`, and `ado_project` must not be empty.
3. Run `/ado-testforge/check_status` to see which field is missing.

---

### PAT authentication errors (401)

**Fix:**

- Your PAT may have expired. Create a new one in ADO.
- Verify the PAT has **Work Items (Read & Write)** and **Test Management (Read & Write)**.
- Ensure `ado_org` is just the organization name (e.g., `YourOrg`), not the full URL.

---

### Tools return "Resource not found" (404)

**Fix:**

- Check that `ado_project` matches your ADO project name exactly (case-sensitive, including spaces).
- Verify you have access to the project in ADO.

---

## Security & Privacy

- **Credentials are local.** They are stored at `~/.ado-testforge-mcp/credentials.json` on your machine—never in the shared folder or Google Drive.
- **Each user has their own.** Everyone creates their own PAT and configures their own credentials.
- **Never share your PAT.** Don't paste it in chat, email, or shared documents.

---

## Where to Get the ADO TestForge MCP Folder

The folder is typically shared via:

- **Google Drive:** Center of Excellence (CoE) / MCP Servers
- **Team share:** Ask your QA lead or CoE contact for the location

If you don't have access, contact your team administrator.

---

## Need Help?

- **Setup issues:** Re-run `/ado-testforge/install` and `/ado-testforge/check_status` to diagnose.
- **Detailed technical guide:** See the full [Setup Guide](setup-guide.md) in the project docs.
- **Team support:** Reach out to your QA lead or Center of Excellence contact.

---

## Publishing to Confluence (For Administrators)

To make this guide available organization-wide in Confluence:

1. **Create a new Confluence page** in your team or CoE space.
2. **Copy this document** — the full content is in `docs/user-setup-guide.md` in the ADO TestForge MCP folder.
3. **Paste into Confluence** — Confluence supports markdown; paste as-is or use **Insert → Markup** if needed.
4. **Add a table of contents** — Confluence can auto-generate one from headings.
5. **Optional:** Add an **Info** or **Note** panel at the top with the MCP folder location (e.g., Google Drive path).
6. **Link from your main CoE/QA space** so users can find it easily.

**Suggested page title:** *ADO TestForge MCP — User Setup Guide*
