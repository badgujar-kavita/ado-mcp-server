# ADO TestForge MCP — User Setup Guide

**For organization\-wide use.** This guide helps you set up ADO TestForge MCP in Cursor IDE on your own—no in\-person guidance required. You can complete setup in about 5–10 minutes.

---

## At a Glance

| What | Details |
|------|---------|
| **What it does** | Lets you draft, review, and push test cases to Azure DevOps directly from Cursor's AI chat |
| **Time to set up** | ~5–10 minutes |
| **Where credentials go** | Your computer only (`~/.ado-testforge-mcp/`) — never shared or synced |
| **Works in** | Any project folder after setup (globally registered) |

---

## Before You Begin

Check that you have:

* [ ] **Node.js v18 or higher** — Run `node -v` in a terminal. If missing, install from [nodejs.org](https://nodejs.org) (LTS).
* [ ] **Cursor IDE** — Latest version installed.
* [ ] **Access to Azure DevOps** — You can log in to your ADO organization.

---

## Quick Start (4 Steps)

1. **Run the installer** — Open a terminal and run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/badgujar-kavita/ado-mcp-server/main/install.sh | bash
   ```
2. **Create an ADO Personal Access Token (PAT)** — See [Step 1](#step-1-create-your-ado-personal-access-token) below.
3. **Configure credentials** — Edit `~/.ado-testforge-mcp/credentials.json` with your PAT, org, and project.
4. **Restart Cursor** — Close and reopen Cursor IDE (or go to **Settings → MCP** → refresh **ado\-testforge**).

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

### Step 2: Configure Your Credentials

**Option A: Use the Configuration UI (Recommended)**

After restarting Cursor, run this in the AI chat:

```
/ado-testforge/ado-connect
```

This opens a web interface where you can enter credentials and **test connections before saving**.

**Option B: Edit Manually**

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

> **Important:** Never paste your PAT in Cursor's chat. Your credentials stay on your machine and are never shared.

**Optional fields** (leave empty if not used):

* `confluence_base_url`, `confluence_email`, `confluence_api_token` — for Solution Design enrichment from Confluence. See [Confluence Setup (Optional)](#confluence-setup-optional) below.

---

### Step 3: Restart Cursor

1. Go to **Cursor Settings → MCP**.
2. Find **ado-testforge** in the list.
3. Click the **refresh/restart** button next to it.
4. Wait for the green status indicator.

---

### Step 4: Verify Setup

In Cursor's AI chat, type `/ado-testforge/ado-check` and run it.

- On the **first successful run** for the current version, you will see a full welcome message plus setup status.
- On **later runs**, you will see a brief `ADO TestForge MCP v1.1.0 | Status: ✓ Ready` header plus component status.
- After a future deploy, `ado-check` will show a one-time **What's New** summary.

If you see **READY**, setup is complete.

---

## Advanced Configuration (Optional)

The installer also creates `~/.ado-testforge-mcp/conventions.config.json` with default settings that control test-case naming, prerequisites, Solution Design usage, and (newer) how much work-item context `ado_story` returns to the AI. Most teams don't need to touch it.

If you do want to customize (e.g. enable image vision so the AI can see screenshots in ADO rich-text fields, or register extra custom fields as primary context), see [`setup-guide.md` → Step 2c](setup-guide.md#step-2c-tune-context-richness-optional) for the full options.

> **⚠️ Important — your edits to `conventions.config.json` are overwritten when you re-install.**
>
> Only `credentials.json` is preserved by the installer. If you customize `conventions.config.json`, keep a copy of your edits somewhere safe and re-apply them after running the installer to upgrade. (A future installer improvement may preserve this file too.)

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
| `/ado-testforge/ado-check` | Verify ADO credentials, Confluence config, and server health |
| `/ado-testforge/ado-story` | Fetch a User Story — fields, Confluence pages, images, and links |
| `/ado-testforge/qa-draft` | Draft test cases as reviewable markdown — never pushes to ADO |
| `/ado-testforge/qa-publish` | Push a reviewed draft to ADO — creates test cases after explicit confirmation |
| `/ado-testforge/ado-plans` | List all test plans in the ADO project |
| `/ado-testforge/qa-tc-update` | Update a test case — title, steps, prerequisites, priority, or assignment |

You can also use natural language, e.g., *"Fetch user story 12345 from ADO"* or *"Draft test cases for user story 12345"*.

---

## Troubleshooting

### "ado\-testforge" shows a red dot (server won't start)

**Possible causes:**

* Node.js is not installed or not in your PATH. Run `node -v` in a terminal to verify.
* The installation may be corrupted. Re\-run the installer:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/badgujar-kavita/ado-mcp-server/main/install.sh | bash
  ```

---

### ADO TestForge doesn't appear in Cursor

**Fix:**

* **Restart Cursor** after installation
* Check **Cursor Settings → MCP** — ado\-testforge should be listed
* If missing, re\-run the installation command above

---

### "No valid credentials found"

**Fix:**

1. Open `~/.ado-testforge-mcp/credentials.json`.
2. Verify you replaced all placeholder values—`ado_pat`, `ado_org`, and `ado_project` must not be empty.
3. Run `/ado-testforge/ado-check` to see which field is missing.

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

* **Credentials are local.** They are stored at `~/.ado-testforge-mcp/credentials.json` on your machine—never shared or synced.
* **Each user has their own.** Everyone creates their own PAT and configures their own credentials.
* **Never share your PAT.** Don't paste it in chat, email, or shared documents.
* **Re\-installing preserves credentials.** Your existing credentials are not overwritten when you update.

---

## Need Help?

* **Setup issues:** Re\-run the installation command and then `/ado-testforge/ado-check` to diagnose.
* **Detailed technical guide:** See the full [Setup Guide](setup-guide.md).
* **Team support:** Reach out to your QA lead or project administrator.

---

## Updating

To update to the latest version:

```bash
curl -fsSL https://raw.githubusercontent.com/badgujar-kavita/ado-mcp-server/main/install.sh | bash
```

Your credentials will be preserved.
