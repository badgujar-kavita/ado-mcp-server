# VortexADO MCP — User Setup Guide

**For organization\-wide use.** This guide helps you set up VortexADO MCP in Cursor IDE on your own—no in\-person guidance required. You can complete setup in about 5–10 minutes.

---

## At a Glance

| What | Details |
|------|---------|
| **What it does** | Lets you draft, review, and push test cases to Azure DevOps directly from Cursor's AI chat |
| **Time to set up** | ~5–10 minutes |
| **Where credentials go** | OS keychain (macOS Keychain / Windows Credential Manager / Linux libsecret) — never written to disk |
| **Where conventions go** | `<workspace>/.vortex-ado/config.json` — one config per project workspace, so two ADO projects in two Cursor windows stay isolated |
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
3. **Open your project folder in Cursor** and run `/vortex-ado/ado-connect` to save credentials per-workspace (PAT goes to your OS keychain; org/project go to `<workspace>/.vortex-ado/config.json`).
4. **Restart Cursor** — Close and reopen Cursor IDE (or go to **Settings → MCP** → refresh **ado\-testforge**).

> Working on more than one ADO project? Just open each one in its own Cursor window and run `/vortex-ado/ado-connect` per workspace. Configs and credentials stay isolated per project.

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
   - **Name**: e.g., `VortexADO MCP` (any name you prefer)
   - **Expiration**: 90 days recommended
   - **Scopes**: Select **Custom defined**, then enable:
     - **Work Items** — Read & Write
     - **Test Management** — Read & Write

4. Click **Create**.

5. **Copy the token immediately** — you won't be able to see it again. Store it securely (e.g., password manager).

---

### Step 2: Configure Your Credentials

> ✅ **Phase 2 update.** The wizard is now **two tabs**: Tab 1 saves your ADO + Confluence connection, Tab 2 saves your project conventions (sprint prefix, test plans, personas, field references). Both tabs save independently. Run the wizard once **per project workspace**.

**Option A: Use the Configuration UI (Recommended)**

1. Open your project folder in Cursor.
2. In the AI chat, run:

   ```
   /vortex-ado/ado-connect
   ```

3. **Tab 1 — Connection.** Enter your ADO credentials and (optionally) Confluence, then click **Validate and Save Connection**. The wizard checks your PAT against ADO before writing anything — no partial saves on a bad token. On success, it auto-navigates to Tab 2.
   - ℹ️ Already have a PAT saved from a previous run? Leave the PAT field blank to reuse the keychain entry. You'll see a **"stored in keychain"** pill confirming this.
4. **Tab 2 — Conventions.** The wizard probes your ADO project for plans, custom fields, and iterations, then asks you to set:
   * **Sprint folder prefix** (default `Sprint_`)
   * **Test plan mappings** — pick which probed plans to map and confirm the AreaPath fragment for each
   * **Personas** — add rows for the personas your TCs use; leave empty if your TCs don't have a Persona section
   * **Prerequisite** + **Solution Design** field references — pick from probed `Custom.*` fields
   * **Additional context fields** — extra rich-text ADO fields you want pulled into `/ado-story`

   The Test Case title format is shown read-only — it's locked to `TC_<userStoryId>_<NN> -> <featureTags> -> <use case>` for now to keep the draft → ADO sync parser happy.

   Click **Save Conventions** when done. The wizard pops a confirmation modal showing exactly what's about to be written; if nothing changed, the save is silently skipped.

The wizard writes:
* `<workspace>/.vortex-ado/config.json` — connection + conventions (no secrets)
* Your PAT and Confluence token into the OS keychain (macOS Keychain / Windows Credential Manager / Linux libsecret) under service `vortex-ado`

🚫 If `/ado-connect` errors with "refusing to write into home directory", it means Cursor doesn't have a project folder open. Open one and retry.

> ℹ️ Switching to a different ADO project? Tab 2 will ask whether to **Reuse my existing conventions** (carries over personas / sprint prefix / field refs as pre-fills, re-probes plans against the new project) or **Start fresh** (empty form). Plan IDs are always project-specific and never carried forward.

**Option B: Edit Manually**

See [docs/conventions.md § 8](conventions.md#8-copy-pasteable-starter-template) for a copy-paste starter `<workspace>/.vortex-ado/config.json`. After saving the file, store your PAT in your OS's credential store under service `vortex-ado`, account `ado::{org}::{project}` — see [docs/setup-guide.md → Step 2 Option B](setup-guide.md#option-b-edit-manually) for per-platform commands.

> **Important:** Never paste your PAT in Cursor's chat. The keychain keeps it off disk.

**Optional Confluence config** lives under `confluence` in the same `config.json` file. The Confluence API token also goes in the OS keychain under account `confluence::{org}::{project}`. See [Confluence Setup (Optional)](#confluence-setup-optional) below.

> **Note on `~/.vortex-ado/credentials.json`.** The MCP no longer creates this file. Earlier installs may have one left over; the MCP still reads it on startup as a one-time fallback so a tester with real values doesn't get hard-broken, but it's no longer the supported credential location. Once you've run `/ado-connect`, you can delete it.

---

### Step 3: Restart Cursor

1. Go to **Cursor Settings → MCP**.
2. Find **vortex-ado** in the list.
3. Click the **refresh/restart** button next to it.
4. Wait for the green status indicator.

---

### Step 4: Verify Setup

In Cursor's AI chat, type `/vortex-ado/ado-check` and run it.

- On the **first successful run** for the current version, you will see a full welcome message plus setup status.
- On **later runs**, you will see a brief `VortexADO MCP v1.1.0 | Status: ✓ Ready` header plus component status.
- After a future deploy, `ado-check` will show a one-time **What's New** summary.

If you see **READY**, setup is complete.

---

## Advanced Configuration (Optional)

Your per-workspace config at `<workspace>/.vortex-ado/config.json` controls test-case naming, personas, prerequisites, Solution Design behavior, and how much work-item context `ado_story` returns to the AI. The MCP merges your workspace overlay on top of framework defaults — anything you don't specify uses the default.

> ✅ **Phase 2 update.** Most fields are now collected via the **Conventions tab** of the `/ado-connect` wizard — sprint prefix, test plan mappings, personas, prerequisite + Solution Design field references, and additional context fields. You only need to hand-edit JSON for a few rarely-changed fields:
>
> * `testCaseTitle.prefix` — locked to `TC` for now (parser dependency); custom prefixes are deferred to a future phase.
> * `prerequisiteDefaults.personaRolesLabel` and `personaPsgLabel` — defaults `Roles` / `Permission Set Group` work for most teams.

Most teams will want to set, on the wizard's Conventions tab:

* `suiteStructure.testPlanMapping` — required for `/qa-publish` (without it, push fails with `plan-resolution-failed`)
* `prerequisiteDefaults.personas` — without it, the Persona section is omitted from both the drafted markdown and the published ADO TC Description
* `suiteStructure.sprintPrefix` — match your team's sprint folder naming

See **[docs/conventions.md](conventions.md)** for the full annotated schema, an edit-priority table, and a copy-pasteable starter template.

> ✅ Your `<workspace>/.vortex-ado/config.json` is **not** touched by re-installs. The installer only updates the MCP runtime under `~/.vortex-ado/`. Re-running `/ado-connect` Tab 1 only updates the connection block; Tab 2 only updates the conventions blocks; neither tab touches the fields the other manages.

---

## Confluence Setup (Optional)

If your User Stories link to Solution Design documents in Confluence, you can configure the MCP to fetch that content automatically. This gives the AI richer context when drafting test cases.

The easiest way is to fill in the Confluence section in `/vortex-ado/ado-connect` — the wizard saves the URL/email to `<workspace>/.vortex-ado/config.json` under `confluence` and stores the API token in the OS keychain (account `confluence::{org}::{project}`).

If you'd rather configure manually:

1. Create an Atlassian API token at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Add a `confluence` block to `<workspace>/.vortex-ado/config.json`:

   ```json
   {
     "confluence": {
       "enabled": true,
       "url":     "https://your-org.atlassian.net/wiki",
       "email":   "your.email@company.com"
     }
   }
   ```

3. Store the API token in your OS keychain under service `vortex-ado`, account `confluence::{org}::{project}` (see [docs/conventions.md § 7](conventions.md#7-where-credentials-live) for per-platform commands).
4. Restart the MCP server (Settings → MCP → refresh vortex-ado).

If Confluence is not configured, the MCP works normally—Solution Design content will simply be unavailable.

---

## What You Can Do After Setup

Type `/vortex-ado` in the AI chat to see all commands. Common ones:

| Command | Purpose |
|---------|---------|
| `/vortex-ado/ado-check` | Verify ADO credentials, Confluence config, and server health |
| `/vortex-ado/ado-story` | Fetch a User Story — fields, Confluence pages, images, and links |
| `/vortex-ado/qa-draft` | Draft test cases as reviewable markdown — never pushes to ADO |
| `/vortex-ado/qa-publish` | Push a reviewed draft to ADO — agent guides you through confirmation at every step |
| `/vortex-ado/ado-plans` | List all test plans in the ADO project |
| `/vortex-ado/qa-tc-update` | Update a test case, or apply the same fields uniformly to many |

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

### VortexADO doesn't appear in Cursor

**Fix:**

* **Restart Cursor** after installation
* Check **Cursor Settings → MCP** — ado\-testforge should be listed
* If missing, re\-run the installation command above

---

### "No valid credentials found"

**Fix:**

1. Open your project folder in Cursor (the wizard refuses to write into your home directory).
2. Run `/vortex-ado/ado-connect` to write `<workspace>/.vortex-ado/config.json` and store the PAT in the OS keychain.
3. Run `/vortex-ado/ado-check` to see which field is missing.

If you have a leftover `~/.vortex-ado/credentials.json` file from an earlier install, the MCP still reads it as a one-time fallback. Re-run `/ado-connect` to commit your credentials to the OS keychain, then you can delete the file.

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

* **Credentials are in the OS keychain.** Your PAT and Confluence API token live in macOS Keychain / Windows Credential Manager / Linux libsecret under service `vortex-ado` — never written to disk.
* **Connection details are per-workspace.** Org, project, URL, and Confluence email live in `<workspace>/.vortex-ado/config.json`. Each project has its own.
* **Each user has their own.** Everyone creates their own PAT and configures their own credentials.
* **Never share your PAT.** Don't paste it in chat, email, or shared documents.
* **Re\-installing preserves your config.** The installer only updates the MCP runtime under `~/.vortex-ado/`; per-workspace configs and keychain entries are untouched.

---

## Need Help?

* **Setup issues:** Re\-run the installation command and then `/vortex-ado/ado-check` to diagnose.
* **Detailed technical guide:** See the full [Setup Guide](setup-guide.md).
* **Team support:** Reach out to your QA lead or project administrator.

---

## Updating

To update to the latest version:

```bash
curl -fsSL https://raw.githubusercontent.com/badgujar-kavita/ado-mcp-server/main/install.sh | bash
```

Your credentials will be preserved.
