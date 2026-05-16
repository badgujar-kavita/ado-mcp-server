# Vortex ADO MCP — QA Quick Start Guide

> **Audience:** QA Engineers and Test Case Authors  
> **Setup time:** 10–15 minutes (one-time per workspace)  
> **Owner:** *Kavita Badgujar*  
> **Last updated:** May 16, 2026  
>

> **Video walkthrough:** *Coming soon — recommended for first-time setup.*

---

## Table of Contents

1. [What this tool does](#what-this-tool-does)
2. [Typical workflow](#typical-workflow)
3. [Before you begin](#before-you-begin)
4. [Step 1 — Create your Azure DevOps PAT](#step-1--create-your-azure-devops-pat)
5. [Step 1.5 — Create your Confluence API token (optional)](#step-15--create-your-confluence-api-token-optional)
6. [Step 2 — Install on your machine](#step-2--install-on-your-machine)
7. [Step 3 — Connect your workspace](#step-3--connect-your-workspace)
8. [Step 4 — Verify your setup](#step-4--verify-your-setup)
9. [Files created in your workspace](#files-created-in-your-workspace)
10. [Slash commands reference](#slash-commands-reference)
11. [Common fixes](#common-fixes)
12. [Troubleshooting and FAQ](#troubleshooting-and-faq)
13. [Need help?](#need-help)

---

## What this tool does

**Vortex ADO MCP** is a Cursor MCP server that lets QA engineers draft, review, and publish Azure DevOps test cases directly from Cursor's AI chat.

The tool reads User Story context — description, acceptance criteria, custom fields, linked Confluence Solution Design pages, and embedded images — then generates reviewable markdown drafts locally. **Nothing is published to Azure DevOps until you explicitly approve the draft.**


| Capability                  | What it means for you                                                       |
| --------------------------- | --------------------------------------------------------------------------- |
| **Draft test cases**        | Generate structured markdown drafts from a User Story quickly               |
| **Review locally**          | Iterate with AI feedback before anything reaches ADO                        |
| **Publish safely**          | Push approved drafts to ADO with full work-item linking and suite hierarchy |
| **Round-trip edits**        | Re-publish updated drafts to the same test cases — no duplicates            |
| **Multi-project isolation** | Two ADO projects in two Cursor windows stay independent                     |


### At a glance


| Area                      | Details                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------- |
| **Purpose**               | Draft, review, and publish Azure DevOps test cases from Cursor's AI chat            |
| **Primary users**         | QA engineers and test case authors                                                  |
| **Setup time**            | 10–15 minutes per workspace                                                         |
| **Credentials**           | Stored in the OS keychain; never written to plaintext files                         |
| **Project configuration** | Stored in `<workspace>/.vortex-ado/config.json`                                     |
| **Supported context**     | ADO User Stories, optional Confluence Solution Design pages, custom fields, images  |
| **Output**                | Markdown test case drafts, QA summaries, cheat sheets, and ADO-published test cases |


---

## Typical workflow

Once setup is complete, your day-to-day flow is:

1. **Open your project folder in Cursor.**
2. **Draft test cases:**
  ```
   /vortex-ado/qa-draft <us-id>
  ```
3. **Review the generated markdown** in `tc-drafts/US_<id>/`.
4. **Iterate with the AI** — add scenarios, refine steps, adjust priorities.
5. **Publish approved test cases:**
  ```
   /vortex-ado/qa-publish <us-id>
  ```
6. **Edit and re-publish later** — the same test cases update without duplicates.

> **Video:** *Coming soon — end-to-end draft → review → publish walkthrough.*

---

## Before you begin


| #   | Requirement           | How to confirm                                                                                                |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Node.js v18 or higher | Run `node -v` in a terminal. Install LTS from [nodejs.org](https://nodejs.org/) if missing.                   |
| 2   | Cursor IDE (latest)   | Update via Cursor's built-in updater.                                                                         |
| 3   | Azure DevOps access   | You can sign in to your ADO organization and open your project.                                               |
| 4   | Azure DevOps PAT      | Created in **Step 1** below.                                                                                  |
| 5   | Confluence API token  | *Optional* — only required if your stories link to Confluence Solution Design pages. Created in **Step 1.5**. |


> **Security callout**  
> Do not paste PATs or API tokens into Slack messages, markdown files, screenshots, Git commits, or support tickets. Credentials are stored in your OS keychain by the setup wizard. Share diagnostic output only after removing secrets.

---

## Step 1 — Create your Azure DevOps PAT

The MCP authenticates to ADO on your behalf using a Personal Access Token (PAT).

> **Recommended approach:** Use a least-privilege PAT with only the scopes you need (Option B). Choose Full access (Option A) only if your team's security guidance explicitly permits it.

> **Important:** In either option, the PAT inherits your existing ADO access level. If your account cannot access a project today, the PAT cannot either — choosing Full access does not grant additional permissions.

### Option A — PAT with Full access

Create the token with **Full access** selected. The PAT can perform any action your account can perform, no more, no less.

### Option B — PAT with Custom defined scopes *(recommended)*

Select **Custom defined** and enable only the three scopes below. These are the required scopes for the features supported in this MCP version — including image fetching from work-item attachments.


| #   | Scope                | Access       | Purpose                                                                                                                                       |
| --- | -------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Work Items**       | Read & Write | Read user stories; create, update, delete test cases; fetch embedded images and attachments; resolve custom fields, tags, and iteration paths |
| 2   | **Test Management**  | Read & Write | Manage test plans, suites, and test case associations                                                                                         |
| 3   | **Project and Team** | Read         | Validate project connectivity during the setup wizard                                                                                         |


> **Why this list is short:** Work-item image attachments are served by the Work Items scope (the `/_apis/wit/attachments/` endpoint) — there is no need for the broader **Secure Files** scope, which belongs to Azure Pipelines and is unrelated to test-case workflows. The MCP also does not call the Notifications, Service Connections, Symbols, or User Profile APIs — leave those scopes off.

### Steps to create the token

1. Open `https://dev.azure.com/<your-org>/_usersSettings/tokens` in your browser. Replace `<your-org>` with your ADO organization name.
2. Click **+ New Token**.
3. Configure:
  - **Name:** something memorable (e.g. `Vortex ADO MCP`)
  - **Expiration:** 90 days recommended
  - **Scopes:** select **Full access** (Option A) or **Custom defined** with the scopes above (Option B)
4. Click **Create**.
5. **Copy the token immediately** — ADO will not display it again. Store it in your approved password manager.

> **Security note:** The setup wizard in Step 3 reads the token once and writes it to your OS keychain. If the PAT is ever exposed, revoke it in ADO and create a new one.

---

## Step 1.5 — Create your Confluence API token *(optional)*

Skip this step if your User Stories do not link to Confluence Solution Design pages.

Confluence uses the **same Atlassian token mechanism as Jira** — one token from `id.atlassian.com` works for both.

### Option A — Standard Atlassian API token

A standard token inherits your existing Atlassian permissions. It can read any space and page your account can already read.

### Option B — Fine-grained API token *(recommended)*

Create a fine-grained API token with only the scopes below.


| #   | Scope                                 | Purpose                                       |
| --- | ------------------------------------- | --------------------------------------------- |
| 1   | `read:confluence-content.all`         | Read full page content (storage format HTML)  |
| 2   | `read:confluence-content.summary`     | Read page summaries and metadata              |
| 3   | `read:confluence-space.summary`       | List and resolve spaces                       |
| 4   | `read:page:confluence`                | Read individual pages by ID                   |
| 5   | `read:content:confluence`             | Read content objects (pages, blogs, comments) |
| 6   | `read:content-details:confluence`     | Read expanded content details                 |
| 7   | `read:space:confluence`               | Read space details and permissions context    |
| 8   | `read:attachment.download:confluence` | Download page attachments (images, diagrams)  |


> **Important:** The token is bounded by your Atlassian account's existing permissions in either option. If you cannot read a Solution Design page in your browser today, the token cannot either.

> **Note for scoped tokens:** Enter your Confluence URL in the same format for both options (e.g. `https://yourorg.atlassian.net/wiki`). The MCP automatically resolves the Confluence Cloud ID and uses Atlassian's scoped-token API gateway (`api.atlassian.com/ex/confluence/...`) behind the scenes when needed.

### Steps to create the token

1. Open [Atlassian → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Click **Create API token** (Option A) or **Create API token with scopes** (Option B).
3. Label it (e.g. `Vortex ADO MCP`).
4. **Expiration:** Choose the shortest practical duration allowed by your team policy. Atlassian API tokens can be set to expire between 1 and 365 days.
5. For Option B, select the scopes above.
6. Click **Create**, then **copy the token immediately** — Atlassian displays it only once.

If Confluence is not configured, the MCP works normally — Solution Design content is simply unavailable during drafting, and the agent will ask you to paste relevant content manually when needed.

---

## Step 2 — Install on your machine

> The installer is the same `bash install.sh` command on every platform. The steps below cover how to open a terminal in the correct folder.

> **Windows users:** The installer requires a Bash-compatible shell. Use **Git Bash** (recommended) or **WSL** — PowerShell and Command Prompt will not work. Install [Git for Windows](https://gitforwindows.org/) if Git Bash is not available.

### 2.1 — Download the release zip

1. Open the shared Drive folder you were given.
2. Select the file with the **highest semantic version and most recent release date** — e.g. `vortex-ado-v1.1.0-2026-05-16.zip` supersedes `vortex-ado-v1.0.0-2026-05-01.zip`.
3. Download to `~/Downloads/` or your default download folder.

### 2.2 — Extract the zip


| Platform    | How to extract                                                                               |
| ----------- | -------------------------------------------------------------------------------------------- |
| **macOS**   | Double-click the zip in Finder. Contents extract to a folder beside the zip.                 |
| **Windows** | Right-click the zip in File Explorer → **Extract All…** → confirm destination → **Extract**. |
| **Linux**   | In a terminal: `unzip vortex-ado-*.zip`                                                      |


After extracting, the folder should contain four files: `README.md`, `install.sh`, `uninstall.sh`, and `vortex-ado.tar.gz`.

### 2.3 — Run the installer

Open a terminal in the extracted folder:


| Platform    | How to open a terminal in the extracted folder                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **macOS**   | Right-click the folder in Finder → **New Terminal at Folder**. *(Enable in System Settings → Keyboard → Keyboard Shortcuts → Services if missing.)* |
| **Windows** | Right-click inside the extracted folder → **Git Bash Here**.                                                                                        |
| **Linux**   | Right-click inside the folder in your file manager → **Open Terminal Here**.                                                                        |


Then run:

```bash
bash install.sh
```

The installer will:

1. Verify Node 18+ is installed.
2. Extract the bundled MCP into `~/.vortex-ado/` (macOS/Linux) or `%USERPROFILE%\.vortex-ado\` (Windows).
3. Run `npm install` for native dependencies (1–2 minutes on first run).
4. Register `vortex-ado` in Cursor's MCP config at `~/.cursor/mcp.json`.

You should see `Installation Complete` at the end. If the installer fails, the error message identifies the next step — common causes are listed in **Troubleshooting and FAQ**.

> **Video:** *Coming soon — installation walkthrough.*

### 2.4 — Restart Cursor IDE

**Fully quit and relaunch Cursor** (Cmd+Q on macOS, or Quit from the menu on Windows/Linux). Closing the window is not sufficient — Cursor does not auto-restart MCP processes.

Alternative: in Cursor, open **Settings → MCP** and click the refresh icon next to `vortex-ado`.

---

## Step 3 — Connect your workspace

> **What "per workspace" means:** A workspace is the project folder you have open in Cursor. The MCP stores connection details in a hidden `.vortex-ado/` subfolder inside that workspace. If you work on two ADO projects, each one keeps its own settings — open Project A in one Cursor window and Project B in another, and they remain isolated.

### 3.1 — Open your project folder

In Cursor: **File → Open Folder…** → select your project folder (where your team's source code lives).

> The wizard refuses to write into your home directory. Always open a real project folder first.

### 3.2 — Run the connect wizard

In Cursor's AI chat, type:

```
/vortex-ado/ado-connect
```

This opens a two-tab wizard in your browser.

> **Video:** *Coming soon — /ado-connect wizard walkthrough.*

### 3.3 — Tab 1: Connection

Enter your ADO (and optionally Confluence) connection details, then click **Validate and Save Connection**. The wizard validates your PAT against ADO **before** writing anything to disk or keychain — a bad PAT cannot half-save.


| Field                | Required | What to enter                                 | Example                              |
| -------------------- | -------- | --------------------------------------------- | ------------------------------------ |
| ADO URL              | Yes      | Full URL of your ADO organization             | `https://dev.azure.com/YourOrgName`  |
| ADO Org              | Yes      | Organization name (no slashes)                | `YourOrgName`                        |
| ADO Project          | Yes      | Project name (case-sensitive, spaces allowed) | `Your Project Name`                  |
| ADO PAT              | Yes      | The PAT from Step 1                           | `<your-ado-pat>`                     |
| Confluence URL       | Optional | Atlassian wiki base URL                       | `https://yourorg.atlassian.net/wiki` |
| Confluence Email     | Optional | Atlassian account email                       | `you@yourcompany.com`                |
| Confluence API token | Optional | Token from Step 1.5                           | `<your-atlassian-token>`             |


> **Returning users** can leave the PAT field blank to reuse the keychain entry. The input shows a **stored in keychain** indicator in this case.

On success, the wizard auto-navigates to Tab 2.

### 3.4 — Tab 2: Conventions

Tab 2 collects per-project conventions so drafts and pushes follow your team's patterns. The wizard probes your ADO project for plans, custom fields, and iterations, then renders pre-filled options for review.


| Field                               | Importance                   | Purpose                                                                         |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| **Test plan mappings**              | **Required for /qa-publish** | Tells the publish flow which test plan to land test cases in                    |
| **Personas**                        | Optional                     | Drives the Persona block in the test case Prerequisite section                  |
| **Sprint folder prefix**            | Recommended                  | Drives sprint folder names in the suite hierarchy (auto-detected)               |
| **Prerequisite field reference**    | Optional                     | ADO field that receives Prerequisites HTML at publish time                      |
| **Solution Design field reference** | Optional                     | ADO custom field that links your Confluence Solution Design page                |
| **Additional context fields**       | Optional                     | Extra ADO custom fields to fetch when reading a User Story                      |
| **Enable image fetching**           | Optional                     | Off by default. Enable if your User Stories carry screenshots the AI should see |


**Two fields that benefit from extra context:**

#### Personas

- **Purpose:** Personas drive only the Persona block in the test case Prerequisite section — nothing else depends on them.
- **Fields per persona:** Display label, Profile, Role(s), Permission Set or Permission Set Group.
- **If configured:** Drafts include a Persona section, and the same block is written into the ADO test case Prerequisite field at publish time.
- **If skipped:** Drafts will not include a Persona section, and the omission carries through to the published test case.
- **Recommended for:** Teams whose test cases call out persona context (Cashier, Admin, Sales Rep, etc.).

#### Prerequisite field reference

- **What gets generated regardless:** Every drafted test case markdown carries a Common Prerequisites section (Persona + Pre-requisite conditions + Test Data). This is authored locally by the agent.
- **What this setting controls:** When you run `/vortex-ado/qa-publish`, the Prerequisites HTML is written to the ADO field you select here.
- **Dropdown filter:** Custom fields whose name contains `Prerequisite` or `Pre-requisite` (e.g. `Custom.PrerequisiteforTest`).
- **If configured:** Prerequisites land in your team's dedicated custom Prerequisite field.
- **If skipped:** Prerequisites are still pushed to ADO at publish — they land in `System.Description` instead.

Click **Save Conventions** when done. The wizard shows a confirmation modal of exactly what will be written; if nothing changed, the save is silently skipped.

---

## Step 4 — Verify your setup

In Cursor's AI chat, run:

```
/vortex-ado/ado-check
```

All components should report as healthy. If any component is missing, the diagnostic identifies which step to repeat.

---

## Files created in your workspace

Running `/vortex-ado/qa-draft <us-id>` creates three markdown files in `<your-workspace>/tc-drafts/US_<ID>/`. After a successful `/vortex-ado/qa-publish`, a fourth JSON file is co-located with them.


| #   | File                                 | Created by    | Purpose                                                        |
| --- | ------------------------------------ | ------------- | -------------------------------------------------------------- |
| 1   | `US_<ID>_test_cases.md`              | `/qa-draft`   | Reviewable test case draft — source of truth for `/qa-publish` |
| 2   | `US_<ID>_solution_design_summary.md` | `/qa-draft`   | QA-facing summary of the story's design                        |
| 3   | `US_<ID>_qa_cheat_sheet.md`          | `/qa-draft`   | Scannable execution reference (kept under 60 lines)            |
| 4   | `US_<ID>_test_cases.json`            | `/qa-publish` | Post-publish JSON snapshot of what was pushed to ADO           |


### `US_<ID>_test_cases.md` — the test case draft

The actual test cases written as reviewable markdown. This is the file you iterate on with the AI before publishing.

**Contains:** Header (status, version, last-updated, drafted-by, plan ID) · Functionality Process Flow (Mermaid diagram or text) · Test Coverage Insights (Positive/Negative, Functional/Non-Functional, priority) · Common Prerequisites (Persona block, Pre-requisite conditions, Test Data) · One section per test case (title, priority, use case, TC-specific prerequisites, steps and expected results).

**How to use it:**

- Review every test case before publishing. Provide feedback to the AI ("split this TC", "add a negative case", "tighten the expected result"), then regenerate.
- Run `/vortex-ado/qa-publish` once approved — this file becomes the source of truth pushed to ADO.
- After publish, each test case title carries its ADO ID (`(ADO #12345)`). Edit and re-publish to update the same test cases — no duplicates.

### `US_<ID>_solution_design_summary.md` — the QA-facing design summary

A concise summary of the User Story's Solution Design (Confluence page plus ADO custom fields), distilled for testing.

**Contains:** Purpose and process overview · Decision logic · Fields and configs introduced · Setup prerequisites · Behavior by scenario · Edge cases · Admin validations · Open questions and assumptions.

**How to use it:** Quick reference during test execution. Onboarding artifact for teammates joining the story. Decision-log capturing why tests were structured a particular way.

### `US_<ID>_qa_cheat_sheet.md` — the execution cheat sheet

A scannable reference card for running the tests — intentionally terse (under 60 lines).

**Contains:** Decision Logic table · Quick-Maps for field/value lookups · Setup checklist · Debug order.

**How to use it:** Open alongside the test cases during execution. Use this as a companion reference, not as the primary source of test case detail.

### `US_<ID>_test_cases.json` — the post-publish snapshot

A JSON snapshot of the test cases pushed to ADO during the most recent successful publish. **This file is generated automatically and should not be manually edited** — it is refreshed every time you publish.

**Contains:** Header metadata at the moment of publish · Full `testCases[]` array as structured JSON.

**How to use it:** Audit trail for PRs and stakeholders. Feed into automation, dashboards, or coverage trackers. Diff between revisions when older copies are version-controlled.

---

## Slash commands reference

All commands are available under `/vortex-ado/` in Cursor's AI chat. Type `/vortex-ado/` to see the full list.

### Core workflow (daily use)


| #   | Command                            | When to use                                                   |
| --- | ---------------------------------- | ------------------------------------------------------------- |
| 1   | `/vortex-ado/ado-connect`          | First-time setup, or when credentials or conventions change   |
| 2   | `/vortex-ado/ado-check`            | Verify the MCP is configured and connected                    |
| 3   | `/vortex-ado/ado-story <id>`       | Fetch a User Story with full context — useful before drafting |
| 4   | `/vortex-ado/qa-draft <id>`        | Author a new test case draft from a User Story                |
| 5   | `/vortex-ado/qa-publish <id>`      | Push an approved draft to ADO (with consent gates)            |
| 6   | `/vortex-ado/qa-tc-read <tc-id>`   | Read an existing ADO test case                                |
| 7   | `/vortex-ado/qa-tc-update <tc-id>` | Update one or many existing test cases                        |


> **Publishing safety**  
> `/vortex-ado/qa-publish` does not silently create or update ADO test cases. The tool validates the draft, identifies missing inputs, and asks for explicit confirmation before any change reaches Azure DevOps.

### Reference and navigation


| #   | Command                                        | When to use                                |
| --- | ---------------------------------------------- | ------------------------------------------ |
| 1   | `/vortex-ado/ado-plans`                        | List all test plans in your project        |
| 2   | `/vortex-ado/ado-plan <plan-id>`               | Read a specific test plan's details        |
| 3   | `/vortex-ado/ado-suites <plan-id>`             | List suites in a test plan                 |
| 4   | `/vortex-ado/ado-suite <plan-id> <suite-id>`   | Read a specific suite                      |
| 5   | `/vortex-ado/ado-suite-tests`                  | List test cases linked to a suite          |
| 6   | `/vortex-ado/ado-fields`                       | Inspect ADO field metadata                 |
| 7   | `/vortex-ado/qa-tests <us-id>`                 | List all test cases linked to a User Story |
| 8   | `/vortex-ado/confluence-read <page-id-or-url>` | Fetch a Confluence page directly           |


### Suite and cleanup operations


| #   | Command                              | When to use                                           |
| --- | ------------------------------------ | ----------------------------------------------------- |
| 1   | `/vortex-ado/qa-suite-setup <us-id>` | Manually build the Sprint → Epic → US suite hierarchy |
| 2   | `/vortex-ado/qa-suite-update`        | Rename or reshape an existing suite                   |
| 3   | `/vortex-ado/qa-suite-delete`        | Delete a suite (test cases remain in ADO)             |
| 4   | `/vortex-ado/qa-tc-delete <tc-id>`   | Delete a test case from ADO (with confirmation)       |
| 5   | `/vortex-ado/qa-clone`               | Clone a test case from one User Story to another      |


---

## Common fixes

Quick reference for the most frequent issues. See the full FAQ below for additional context.


| Problem                                                        | Try this                                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| MCP not showing in Cursor                                      | Fully quit and relaunch Cursor, then check **Settings → MCP**                       |
| `spawn node ENOENT` in MCP log                                 | Re-run `bash install.sh` from the latest release, then relaunch Cursor              |
| `/vortex-ado/ado-connect` refuses to write into home directory | Open a real project folder via **File → Open Folder…**, not your home folder        |
| `/vortex-ado/qa-publish` fails — missing plan                  | Re-run `/vortex-ado/ado-connect` and confirm **Test plan mappings** in Tab 2        |
| Confluence content missing from drafts                         | Verify Confluence URL, email, token, and that your account can read the source page |
| Windows installer fails to run                                 | Open the extracted folder in **Git Bash** (not PowerShell or Command Prompt)        |


---

## Troubleshooting and FAQ

### Which release zip is the latest?

Select the file in the shared Drive folder with the **highest semantic version and most recent release date**. Example: `vortex-ado-v1.1.0-2026-05-16.zip` supersedes `vortex-ado-v1.0.0-2026-05-01.zip`. When uncertain, contact the person who shared the folder.

### Do I have to re-run `/vortex-ado/ado-connect` after each upgrade?

**No.** The installer wipes `~/.vortex-ado/` and re-extracts the new release, but your per-workspace config (`<project>/.vortex-ado/config.json`) and OS keychain credentials are preserved. Re-run `/vortex-ado/ado-connect` only if your ADO org/project changes or you need to update conventions.

### Will my drafts survive an upgrade?

**Yes.** Drafts live in `<your-workspace>/tc-drafts/` — outside the install directory. The installer does not modify them.

### Can I run this against multiple ADO projects at the same time?

**Yes.** Open each project in a separate Cursor window. Each window's MCP loads its own per-workspace config and uses its own keychain entry (`ado::<org>::<project>`). No cross-contamination, even though both windows share the same Node MCP runtime.

### Where is my PAT stored? Is it secure?

- **Stored in:** your OS keychain — macOS Keychain, Windows Credential Manager, or Linux libsecret.
- **Never written:** to disk in plaintext.
- **Never sent:** to any third party.
- **To inspect or delete:** use your OS's keychain UI. The service name is `vortex-ado`.

### Cursor's MCP log shows `spawn node ENOENT`. What do I do?

This indicates Cursor's GUI process cannot find your `node` binary — common with **nvm**, **asdf**, **Volta**, or **Homebrew on Apple Silicon**.

1. Re-run `bash install.sh` from the latest release zip. Newer installer versions write the absolute path to node into Cursor's config.
2. Fully quit and relaunch Cursor.

### `/vortex-ado/ado-connect` says "refusing to write into home directory"

Cursor was opened without a project folder.

1. Close any Cursor window showing only your home folder.
2. Open your actual project folder via **File → Open Folder…**.
3. Re-run `/vortex-ado/ado-connect` from inside that window.

### How do I uninstall?

From the same release zip folder you installed from, run:

```bash
bash uninstall.sh
```

The uninstaller asks for confirmation before each step: removes `~/.vortex-ado/`, removes the `vortex-ado` entry from Cursor's MCP config (other MCPs preserved), and asks separately whether to delete keychain entries (defaults to **no**).

---

## Need help?

Reach out via *[#qa-vortex-ado Slack channel]* — or contact the person who shared this guide with you. When asking for help, include:

1. **What you ran** — the exact command or wizard step.
2. **What you expected to happen.**
3. **What actually happened** — screenshots or error logs if available *(remove any tokens or credentials first)*.
4. **Output of `/vortex-ado/ado-check`** — the single most useful diagnostic.

---

*Feedback on this guide? Drop a comment in the Canvas or reach out to the owner above.*