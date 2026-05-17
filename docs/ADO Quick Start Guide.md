# Vortex for ADO — Quick Start Guide

A Cursor MCP server that drafts, reviews, and publishes Azure DevOps test cases through the Cursor AI chat. Designed for QA engineers — author test cases as markdown, review them locally, push to ADO when ready.

> **Video walkthrough:** *[link to be added]* — recommended for first-time setup.

---

## At a glance

| What | Details |
|---|---|
| **What it does** | Lets you draft, review, and push test cases to Azure DevOps directly from Cursor's AI chat |
| **Time to set up** | ~10–15 minutes (one-time per workspace) |
| **Where credentials go** | OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret) — never plaintext on disk |
| **Where conventions go** | `<workspace>/.vortex-ado/config.json` — one config per project, so two ADO projects in two Cursor windows stay isolated |
| **Works in** | Any project folder after setup (globally registered) |

---

## What you can do with it

- **Draft test cases from a User Story** — the agent reads the US (description, acceptance criteria, linked Confluence Solution Design, custom fields) and produces a structured markdown draft you can review before anything hits ADO.
- **Publish drafts to ADO** — creates real Test Case work items, links them to the User Story via "Tests / Tested By", and builds the Sprint → Epic → US suite hierarchy automatically.
- **Update existing test cases** — single TC or bulk, with safety rails for mixed-shape changes.
- **Round-trip drafts** — published TCs carry ADO IDs back into the markdown, so you can edit the draft and re-push without losing audit trail.
- **Stay isolated per project** — open ADO Project A in one Cursor window and Project B in another; each window's MCP loads its own config and uses its own keychain entry. No cross-contamination.

---

## Prerequisites

| # | Requirement | How to check |
|---|---|---|
| 1 | **Node.js v18 or higher** | Run `node -v` in a terminal. Install LTS from [nodejs.org](https://nodejs.org/) if missing. |
| 2 | **Cursor IDE** | Latest version. |
| 3 | **Azure DevOps access** | You can sign in to your ADO organization. |
| 4 | **ADO Personal Access Token (PAT)** | Create one in Step 1 below. |
| 5 | **Confluence API token** *(optional)* | Create one in Step 1.5 below if your stories link Confluence Solution Design pages. |

---

## Step 1 — Create your ADO Personal Access Token (PAT)

The MCP authenticates to ADO on your behalf using a PAT. You can choose between two approaches:

### Option A — PAT with Full access (simpler)

When you create the token, choose **Full access**. The PAT inherits **your current ADO permissions** — it can do anything you can do, no more, no less. If your account can't read a project today, the PAT can't either. This is the easiest option and works for everyone.

### Option B — PAT with Custom defined scopes (least-privilege)

If your security team requires least-privilege tokens, choose **Custom defined** and enable the scopes below. The PAT is still bounded by your account's existing permissions, but it adds a second layer — only the listed APIs are reachable even within your access.

| # | Scope (UI Label) | Access Level | Why it's needed |
|---|---|---|---|
| 1 | **Work Items** | Read & Write | Read user stories, create/update/delete test cases |
| 2 | **Test Management** | Read & Write | Manage test plans, suites, and test case associations |
| 3 | **Project and Team** | Read & Write | Resolve project context, area paths, iteration paths |
| 4 | **Notifications** | Read | Access user notification preferences for work item context |
| 5 | **Service Connections** | Read | Resolve service endpoints referenced in work items |
| 6 | **Symbols** | Read & Write | Access symbol information for attachment handling |
| 7 | **User Profile** | Read & Write | Resolve user identities for "Assigned To" fields |
| 8 | **Secure Files** | Read | Access secure file references in test configurations |

> **Tip:** If you only need basic test case drafting and publishing, the two essential scopes are **Work Items (Read & Write)** and **Test Management (Read & Write)**. The other six unlock full feature coverage (suite management, user resolution, attachment handling) — leave them off if you genuinely don't need them.

> **Important:** The PAT inherits **your current ADO access level** in either approach. If you can already create test cases in your ADO project, the PAT can too. If you don't have access to a particular project, neither does the PAT — choosing "Full access" doesn't grant you more permission than you already have.

### Steps to create the token

1. Open `https://dev.azure.com/<your-org>/_usersSettings/tokens` in your browser. Replace `<your-org>` with your ADO organization name.
2. Click **+ New Token**.
3. Configure:
   - **Name:** anything memorable (e.g. `Vortex ADO MCP`)
   - **Expiration:** 90 days recommended
   - **Scopes:** select **Full access** (Option A) or **Custom defined** with the scopes above (Option B)
4. Click **Create**.
5. **Copy the token immediately** — ADO won't show it again. Store it in a password manager.

> **Security note:** Never paste your PAT into Cursor's chat, email, or shared documents. The setup wizard in Step 3 reads it once and stores it in your OS keychain. If the PAT is ever exposed, revoke it in ADO and create a new one.

---

## Step 1.5 — Generate your Confluence API token *(optional)*

Confluence integration is **optional**. You only need a Confluence API token if your User Stories link to Solution Design pages on Confluence — when configured, the ADO MCP can fetch that page content automatically and feed it into test case drafting. If your stories don't link Confluence pages, skip this step entirely.

Confluence uses the **same Atlassian token mechanism** as Jira — one token from `id.atlassian.com`. You can choose between two approaches:

### Option A — API token with full account access (simpler)

Create a standard Atlassian API token. It inherits **your current Atlassian access level** — it can read every Confluence space and page your account can read, no more, no less. This is the easiest option and works for everyone.

### Option B — API token with custom scopes (least-privilege)

If your security team requires least-privilege tokens, create a **fine-grained API token** with only the scopes below. The token is still bounded by your account's existing permissions, but it adds a second layer — only the listed APIs are reachable even within your access.

| # | Scope | Why it's needed |
|---|---|---|
| 1 | `read:confluence-content.all` | Read full page content (storage format HTML) |
| 2 | `read:confluence-content.summary` | Read page summaries and metadata |
| 3 | `read:confluence-space.summary` | List and resolve spaces |
| 4 | `read:page:confluence` | Read individual pages by ID |
| 5 | `read:content:confluence` | Read content objects (pages, blogs, comments) |
| 6 | `read:content-details:confluence` | Read expanded content details (body, version, ancestors) |
| 7 | `read:space:confluence` | Read space details and permissions context |
| 8 | `read:attachment.download:confluence` | Download page attachments (images, diagrams) |

> **Important:** The token inherits **your current Atlassian access level** in either approach. If you can already read a Confluence Solution Design page in your browser, the token can too. If you don't have access to a particular space, neither does the token — choosing full account access doesn't grant you more permission than you already have.

### Steps to create the token

1. Open [id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) in your browser.
2. Click **Create API token** (Option A) or **Create API token with scopes** (Option B).
3. Give it a label (e.g. `Vortex ADO MCP`). For Option B, also select the eight scopes above.
4. Click **Create**, then **copy the token immediately** — Atlassian shows it only once. Store it in a password manager.

> **Security note:** Never paste your Confluence token into Cursor's chat, email, or shared documents. The setup wizard in Step 3 reads it once and stores it in your OS keychain. If the token is ever exposed, revoke it in the Atlassian UI and create a new one.

If Confluence is **not** configured, the ADO MCP works normally — Solution Design content simply won't be available during drafting, and the agent will ask you to paste relevant content manually when it needs it.

---

## Step 2 — Install on your machine

> The installer is the same `bash install.sh` command on every platform. The differences below are just **how to open a terminal in the right folder.**

### Step 2.1 — Download the release zip

1. Open the shared Drive folder you were given.
2. Pick the file with the **highest version + most recent date** — e.g. `vortex-ado-v1.0.0-2026-05-16.zip`. Newer versions always win (`v1.2.0-2026-06-01.zip` beats `v1.0.0-2026-05-16.zip`).
3. Download to `~/Downloads/` (or wherever your browser saves files).

### Step 2.2 — Extract the zip

| Platform | How to extract |
|---|---|
| **macOS** | Double-click the zip in Finder. macOS extracts to a folder next to the zip with the same name (e.g. `vortex-ado-v1.0.0-2026-05-16/`). |
| **Windows** | Right-click the zip in File Explorer → **Extract All…** → confirm the destination → click **Extract**. |
| **Linux** | Open a terminal in the download folder and run: `unzip vortex-ado-*.zip` |

After extracting, you should see a folder containing four files: `README.md`, `install.sh`, `uninstall.sh`, and `vortex-ado.tar.gz`.

### Step 2.3 — Run the installer from the extracted folder

| Platform | How to open a terminal in the extracted folder |
|---|---|
| **macOS** | Right-click the extracted folder in Finder → **New Terminal at Folder**. *(If that option is missing, enable it in System Settings → Keyboard → Keyboard Shortcuts → Services → "New Terminal at Folder".)* |
| **Windows** | Right-click inside the extracted folder in File Explorer → **Open in Terminal** (Windows 11), or **Open in Windows Terminal**, or hold Shift while right-clicking → **Open PowerShell window here** (older Windows). |
| **Linux** | Right-click inside the extracted folder in your file manager → **Open Terminal Here** (most distros). |

Then run:

```bash
bash install.sh
```

The installer:
1. Verifies Node 18+ is installed.
2. Extracts the bundled MCP into `~/.vortex-ado/` (Linux/macOS) or `%USERPROFILE%\.vortex-ado\` (Windows).
3. Runs `npm install` for native dependencies (this takes a minute or two on the first run).
4. Registers `vortex-ado` in Cursor's MCP config at `~/.cursor/mcp.json`.

You should see `✨ Installation Complete!` at the end. If anything fails, the error message tells you what to do — most common causes are listed in the **FAQ** at the bottom of this doc.

### Step 2.4 — Restart Cursor IDE

**Cmd+Q (macOS) / fully quit and relaunch (Windows/Linux).** Closing the window isn't enough — Cursor doesn't auto-restart MCP processes.

Alternative: in Cursor, go to **Settings → MCP** and click the refresh icon next to `vortex-ado`.

---

## Step 3 — Configure credentials per workspace

> **What does "per workspace" mean?**
> A "workspace" is just the project folder you have open in Cursor. The MCP saves your ADO connection details next to that folder (in a hidden `.vortex-ado/` subfolder). If you work on two ADO projects, each one keeps its own settings — open Project A in one Cursor window and Project B in another, and they never see each other's credentials or conventions. This is the multi-project safety net.

### Step 3.1 — Open your project folder in Cursor

In Cursor: **File → Open Folder…** → pick your actual project folder (the one your team's source code lives in).

> ⚠️ The wizard refuses to write into your home directory or to a Cursor window that has no folder open. Always open a real project folder first.

### Step 3.2 — Run the connect wizard

In the Cursor AI chat, type:

```
/vortex-ado/ado-connect
```

This opens a two-tab wizard in your browser.

### Step 3.3 — Tab 1: Connection

Fill in your ADO (and optionally Confluence) connection details. Click **Validate and Save Connection** — the wizard validates your PAT against ADO **before** writing anything to disk or keychain. A bad PAT can't half-save.

| Field | Required? | What to enter | Example |
|---|---|---|---|
| ADO URL | Required | The full URL of your ADO organization | `https://dev.azure.com/YourOrgName` |
| ADO Org | Required | Your ADO organization name (no slashes) | `YourOrgName` |
| ADO Project | Required | Your ADO project name (case-sensitive, spaces allowed) | `Your Project Name` |
| ADO PAT | Required | The PAT you copied in Step 1 | `ghp4x7abc123...` (long opaque string) |
| Confluence URL | Optional | Your Atlassian wiki base URL | `https://yourorg.atlassian.net/wiki` |
| Confluence Email | Optional | Your Atlassian account email | `you@yourcompany.com` |
| Confluence API token | Optional | Atlassian API token | `ATATT3xFf...` |

> **Returning users** can leave the PAT field blank to reuse the keychain entry. The PAT input shows a **"stored in keychain"** pill in this case.

On success, the wizard auto-navigates to Tab 2.

### Step 3.4 — Tab 2: Conventions

Tab 2 collects per-project conventions so drafts and pushes follow your team's patterns. The wizard probes your ADO project for plans, custom fields, and iterations, then renders pre-filled options for you to review.

**At-a-glance summary:**

| Field | Importance | One-liner |
|---|---|---|
| **Test plan mappings** | **Required for `/qa-publish`** | Tells the publish flow which test plan to land test cases in. Without this, push fails. |
| **Personas** | Optional | Drives the Persona block in the test case Prerequisite section. *See callout below.* |
| **Sprint folder prefix** | Recommended | Drives sprint folder names in the suite hierarchy. Wizard auto-detects from your iterations and pre-fills it. |
| **Prerequisite field reference** | Optional | Which ADO field receives the Prerequisites HTML at publish time. *See callout below.* |
| **Solution Design field reference** | Optional | Which ADO custom field links your Confluence Solution Design page. |
| **Additional context fields** | Optional | Extra ADO custom fields the agent should fetch when reading a User Story. |
| **Enable image fetching** | Optional | Off by default. Turn on if your User Stories carry screenshots/diagrams the AI should see while drafting. |

**Notes for the two fields that need more context:**

#### Personas — what to know before you decide

- **Purpose:** Personas drive **only** the Persona block in the test case Prerequisite section. Nothing else in the test case structure depends on them.
- **Fields per persona:** Display label, Profile, Role(s), Permission Set or Permission Set Group.
- **If you configure them:** Drafts include a Persona section in the markdown, and the same Persona block is written into the ADO test case Prerequisite field at publish time.
- **If you skip them:** Drafts will not include a Persona section in the markdown — and the omission carries through to the published ADO test case (no `Persona:` heading, no placeholder rows in the Prerequisite field).
- **Configure if:** Your team's TCs traditionally call out persona context (Cashier, Admin, Sales Rep, etc.).
- **Skip if:** Your test cases don't follow that convention.

#### Prerequisite field reference — what to know before you decide

- **What gets generated regardless of this setting:** Every drafted test case markdown carries a Common Prerequisites section (Persona + Pre-requisite conditions + Test Data). That's authored locally by the agent — independent of where it eventually lands in ADO.
- **What this setting controls:** When you run `/qa-publish`, the Prerequisites HTML gets written to the ADO field you pick here.
- **Dropdown:** Filtered to `Custom.*` fields whose name contains `Prerequisite` or `Pre-requisite` (e.g. `Custom.PrerequisiteforTest`).
- **If you configure it:** Prerequisites land in your team's dedicated custom Prerequisite field on the ADO test case work item.
- **If you skip it:** Prerequisites are still pushed to ADO during publish — they just land in the built-in `System.Description` field instead of a custom one.
- **Configure if:** Your team has a dedicated Prerequisite custom field they want test cases to write into.
- **Skip if:** You're happy having prerequisites in the standard Description field.

Click **Save Conventions** when done. The wizard shows a confirmation modal of exactly what's about to be written; if nothing changed, the save is silently skipped.

### Step 3.5 — Verify

In the AI chat, run:

```
/vortex-ado/ado-check
```

You should see all components ✅. If anything is missing, the diagnostic tells you what step to repeat.

---

## What gets created in your workspace

`/qa-draft <US-ID>` creates **three markdown files** in `<your-workspace>/tc-drafts/US_<ID>/`. After a successful `/qa-publish`, a **fourth file** — a JSON snapshot of what was pushed — is co-located with them. Each artifact has a distinct purpose; read this section once so you know which file is which.

| # | File | Created by | Purpose |
|---|---|---|---|
| 1 | `US_<ID>_test_cases.md` | `/qa-draft` | Reviewable test case draft — the source of truth for `/qa-publish` |
| 2 | `US_<ID>_solution_design_summary.md` | `/qa-draft` | QA-facing summary of the story's design, distilled for testing |
| 3 | `US_<ID>_qa_cheat_sheet.md` | `/qa-draft` | Scannable execution reference (kept under 60 lines) |
| 4 | `US_<ID>_test_cases.json` | `/qa-publish` | Post-publish JSON snapshot of what was pushed to ADO |

### 1. `US_<ID>_test_cases.md` — the test case draft

**What it is:** The actual test cases, written as reviewable markdown. This is the file you'll iterate on with the AI before pushing to ADO.

**What it contains:**
- Header (status, version, last-updated, drafted-by, plan ID)
- A **Functionality Process Flow** (Mermaid diagram or text — visualizes the business logic)
- **Test Coverage Insights** — table classifying every scenario as Positive/Negative, Functional/Non-Functional, with priority. Lets you see coverage at a glance.
- **Common Prerequisites** — Persona block (from your config), shared Pre-requisite conditions, Test Data
- **One section per test case** with title, priority, use case, TC-specific pre-requisites, and step-by-step actions + expected results

**When to use it:**
- Review every TC before publishing — feedback to the AI ("split this TC", "add a negative case for X", "tighten the expected result on step 3"), regenerate, repeat.
- Once you're happy, run `/qa-publish` — the file becomes the source of truth that gets pushed to ADO.
- After publish, the file gets ADO IDs written back into each TC title (`(ADO #12345)`). Edit the draft later and re-publish to update the same TCs — no duplicates.

### 2. `US_<ID>_solution_design_summary.md` — the QA-facing design summary

**What it is:** A concise summary of the User Story's Solution Design (Confluence page + ADO custom fields), distilled for testing.

**What it contains:**
- Purpose and process overview
- Decision logic, fields/configs introduced, setup prerequisites
- Behavior by scenario, edge cases, admin validations
- Open questions / assumptions

**When to use it:**
- Quick reference during test execution — "what was this story actually trying to do?" without re-reading the whole Confluence page.
- Onboarding a teammate to the story — share this single file instead of 4 different links.
- Decision-log artifact — when QA later asks "why did we test it this way?", the design summary captures the why.

### 3. `US_<ID>_qa_cheat_sheet.md` — the execution cheat sheet

**What it is:** A scannable reference card for actually running the tests — kept terse on purpose (under 60 lines).

**What it contains:**
- Decision Logic table (Use Case | Config/Fields | Conditions | Outcome)
- Quick-Maps for field/value lookups
- Setup checklist
- Debug order (where to look first when something fails)

**When to use it:**
- Open this file alongside the test cases while running them — quick lookup of expected values, field names, or "if this fails, check that."
- Don't try to use it as primary documentation. It's a cheat sheet — pairs with the test_cases.md and solution_design_summary.md, doesn't replace them.

### 4. `US_<ID>_test_cases.json` — the post-publish snapshot *(created on publish, not draft)*

**What it is:** A JSON snapshot of the test cases that were pushed to ADO during the most recent successful `/qa-publish`. **You don't normally edit this file** — it's an audit/automation artifact. Created automatically; refreshed every time you publish.

**What it contains:**
- Header metadata at the moment of publish (status, version, plan ID, story info)
- The full `testCases[]` array as structured JSON (titles, priorities, use cases, prerequisites, steps, expected results)

**When to use it:**
- **Audit trail** — drop it into a PR or share it as proof of what was published, without screenshotting ADO.
- **Programmatic consumers** — feed it into automation, dashboards, or coverage trackers that prefer JSON over scraping ADO.
- **Diff between revisions** — keep older copies in version control to see exactly what changed in test coverage between publishes.
- Otherwise: leave it alone. It's regenerated on every publish, so manual edits get overwritten.

---

## Generating regression / E2E / SIT / UAT drafts (optional)

The canonical pack (`US_<ID>_test_cases.md`) holds the functional test cases for a User Story. When you also want a **parallel pack** — regression scenarios, an E2E business journey, SIT integration tests, UAT acceptance scripts — you generate it as a SEPARATE FILE alongside the canonical draft. This keeps each pack independently reviewable and pushable.

### How to ask for one

Just tell the agent: *"generate regression test cases for US 1234"* or *"draft an E2E pack for US 1234"*. The agent will:

1. Confirm with you whether you want a **NEW separate file** (option A) or **more rows in the existing canonical draft** (option B). This confirmation gate is mandatory — if you skip past it, you'll end up with a parallel file when you wanted in-place additions, or vice versa.
2. On `A`, run `/qa-draft <ID> suffix=<slug>`. Allowed slugs (lowercase): `regression`, `e2e`, `sit`, `uat`, `smoke`, `performance`, or any custom slug matching `/^[a-z0-9_-]+$/`.

### What you get on disk

```
tc-drafts/US_1234/
├── US_1234_test_cases.md             (canonical pack — TC_1234_01, _02, _03 …)
├── US_1234_test_cases_regression.md  (TC_1234_REG_01, _REG_02 …)
├── US_1234_test_cases_e2e.md         (TC_1234_E2E_01, _E2E_02 …)
└── US_1234_solution_design_summary.md  (shared — authored once with the canonical pack)
```

Suffixed packs share the canonical pack's solution design summary and QA cheat sheet — they're authored once per US, not duplicated. The suffixed draft replaces the Supporting Documents block with a `**Suite Type** | <Capitalized Suffix> |` row in the header so reviewers see at a glance which pack they're looking at.

### TC title format

| Pack | Title shape | Example |
|---|---|---|
| Canonical (no suffix) | `TC_<USID>_<NN> -> ...` | `TC_1234_01 -> Case Creation -> ...` |
| Regression (`suffix=regression`) | `TC_<USID>_REG_<NN> -> ...` | `TC_1234_REG_01 -> Email-to-Case -> ...` |
| E2E (`suffix=e2e`) | `TC_<USID>_E2E_<NN> -> ...` | `TC_1234_E2E_01 -> Order-to-Cash -> ...` |
| SIT (`suffix=sit`) | `TC_<USID>_SIT_<NN> -> ...` | `TC_1234_SIT_01 -> External API -> ...` |
| UAT (`suffix=uat`) | `TC_<USID>_UAT_<NN> -> ...` | `TC_1234_UAT_01 -> Acceptance -> ...` |
| Smoke / Performance | `TC_<USID>_SMOKE_<NN>` / `TC_<USID>_PERF_<NN>` | as above |

The TAG segment is what makes WIQL searches work — `[System.Title] CONTAINS '_REG_'` surfaces every regression case across the project. ADO numbering is independent per pack: each suffixed file starts its own `01, 02, …` numbering, never colliding with the canonical pack.

### Publishing a suffixed pack

Run `/qa-publish <ID> suffix=<slug>` to push the parallel pack. The suffixed flow uses the **same gates and the same suite-resolution path as the canonical flow** — there are no suffix-specific consent gates. If the US-level suite doesn't exist yet, the publish creates it (Sprint → Parent → US hierarchy). If it does exist, the new TCs are added to it.

Both functional and suffixed test cases coexist in the **same US-level dynamic suite**. The suite's WIQL `[System.Title] CONTAINS 'TC_<USID>'` matches both `TC_<USID>_NN` (canonical) and `TC_<USID>_REG_NN` (suffixed) titles via substring match, so all packs auto-populate the same suite. If you want a visual "Regression" folder in ADO, create it manually — the tool intentionally stays out of the suite-tree-shape business since ADO doesn't allow nesting any child under a query-based suite.

### Publish writes back to the suffixed file (not the canonical)

After a successful suffixed publish, the suffixed `.md` file gets the same in-place edits as the canonical flow — Status flips DRAFT → APPROVED, each TC title gets `(ADO #N)` appended, and a sibling `US_<ID>_test_cases_<suffix>.json` snapshot is written. The canonical `.md` and `.json` are untouched.

### Where to teach your agent the rules

The agent rules for the canonical-vs-suffixed decision and the slash-command syntax live in your project's `.cursor/rules/` folder (or a `.mdc` file your tenant agent loads). A reference rules file is shipped with this MCP at:

```
tenant-rules-examples/qa.mdc
```

Copy it into your project (or merge with your existing rules) so the agent applies the Group A vs Group B confirmation gate, picks the right suffix slug, and never invents tags.

A complete worked example of a suffixed regression draft — with parser-validated header, TC titles, common prerequisites, and per-TC sections — lives at:

```
tenant-rules-examples/sample-drafts/US_1234_test_cases_regression.md
```

---

## Slash commands you'll use

Everything happens through slash commands in Cursor's AI chat. Type `/vortex-ado/` and Cursor shows the full list.

### Core flow (you'll use these every day)

| # | Command | When to use |
|---|---|---|
| 1 | `/vortex-ado/ado-connect` | First-time setup, or whenever credentials/conventions change. |
| 2 | `/vortex-ado/ado-check` | Verify the MCP is configured and connected. Run after install or if something feels off. |
| 3 | `/vortex-ado/ado-story <id>` | Fetch a User Story with full context (fields, Confluence pages, images, links). Useful for browsing what the AI sees before drafting. |
| 4 | `/vortex-ado/qa-draft <id>` | Author a new test case draft from a User Story. Produces the three markdown artifacts. |
| 5 | `/vortex-ado/qa-publish <id>` | Push an APPROVED draft to ADO. Has consent gates — won't push silently. Creates the JSON snapshot on success. |
| 6 | `/vortex-ado/qa-tc-read <tc-id>` | Read an existing ADO test case. Useful for reviewing what was published. |
| 7 | `/vortex-ado/qa-tc-update <tc-id>` | Update one or many existing test cases (priority, state, prerequisites, steps). Has guardrails for bulk operations. |

### Reference / navigation

| # | Command | When to use |
|---|---|---|
| 1 | `/vortex-ado/ado-plans` | List all test plans in your project. |
| 2 | `/vortex-ado/ado-plan <plan-id>` | Read a specific test plan's details. |
| 3 | `/vortex-ado/ado-suites <plan-id>` | List suites in a test plan. |
| 4 | `/vortex-ado/ado-suite <plan-id> <suite-id>` | Read a specific suite. |
| 5 | `/vortex-ado/ado-suite-tests` | List the test cases linked to a suite. |
| 6 | `/vortex-ado/ado-fields` | Inspect ADO field metadata — useful when configuring `additionalContextFields`. |
| 7 | `/vortex-ado/qa-tests <us-id>` | List all test cases linked to a User Story. |
| 8 | `/vortex-ado/confluence-read <page-id-or-url>` | Fetch a Confluence page directly (e.g. for inspecting Solution Design content). |

### Suite + cleanup operations

| # | Command | When to use |
|---|---|---|
| 1 | `/vortex-ado/qa-suite-setup <us-id>` | Manually build the Sprint → Epic → US suite hierarchy. Normally done automatically by `/qa-publish`; use this if you need to fix a missing/broken hierarchy. |
| 2 | `/vortex-ado/qa-suite-update` | Rename or reshape an existing suite. |
| 3 | `/vortex-ado/qa-suite-delete` | Delete a suite. Test cases stay in ADO; only the suite link is removed. |
| 4 | `/vortex-ado/qa-tc-delete <tc-id>` | Delete a test case from ADO. Has confirmation gates. |
| 5 | `/vortex-ado/qa-clone` | Clone a TC from one User Story to another, with the agent adapting persona/pre-requisites. |

---

## FAQ

### 1. How do I know which release zip is the latest?
Pick the file in the Drive folder with the **highest version number AND most recent date**. Examples:
- `vortex-ado-v1.2.0-2026-06-01.zip` beats `vortex-ado-v1.0.0-2026-05-16.zip`
- When in doubt, ask the person who shared the folder.

### 2. Do I have to re-do `/ado-connect` after each upgrade?
**No.**
1. The installer wipes `~/.vortex-ado/` and re-extracts the new release.
2. Your per-workspace config (`<project>/.vortex-ado/config.json`) survives.
3. Your OS keychain credentials survive.
4. Re-run `/ado-connect` only if your ADO org/project changes or you need to update conventions.

### 3. Will my drafts survive an upgrade?
**Yes.** Drafts live in `<your-workspace>/tc-drafts/` — outside the install dir. The installer doesn't touch them.

### 4. Can I run this against multiple ADO projects at the same time?
**Yes.**
1. Open Project A in one Cursor window — it sees `Project-A/.vortex-ado/config.json`.
2. Open Project B in another Cursor window — it sees `Project-B/.vortex-ado/config.json`.
3. Each window's MCP uses its own keychain entry (`ado::<org>::<project>`).
4. No cross-contamination, even though both windows share the same Node MCP runtime.

### 5. Where does my PAT go? Is it safe?
- **Stored in:** your OS keychain — macOS Keychain, Windows Credential Manager, or Linux libsecret.
- **Never on disk:** in plaintext.
- **Never sent:** to any third party.
- **Inspect/delete:** via your OS's keychain UI; the service name is `vortex-ado`.

### 6. What happens if I run `/qa-publish` on a draft with errors?
The tool has **structured consent gates** — it won't push silently. You'll see a clear `needs-confirmation` or `needs-input` response explaining:
1. What's missing (plan ID, sprint number, etc.)
2. What to provide

The user is always in control.

### 7. Can I edit a draft and re-publish?
**Yes.**
1. After publish, each TC carries its ADO ID in the title.
2. Edit the draft.
3. Run `/qa-publish` with `repush: true`.
4. The same TCs get full-field updates — no duplicates.

Round-trip fidelity is a core feature.

### 8. How do I uninstall?
From the same release zip folder you installed from:

```bash
bash uninstall.sh
```

The uninstaller asks for confirmation before each step:
1. Removes `~/.vortex-ado/`.
2. Removes the `vortex-ado` entry from Cursor's MCP config (other MCPs preserved).
3. Asks separately whether to delete keychain entries (defaults to **no**).

### 9. My Cursor MCP log shows `spawn node ENOENT`. What now?
This means Cursor's GUI process can't find your `node` binary — common with **nvm**, **asdf**, **Volta**, or **Homebrew on Apple Silicon**.
1. Re-run `bash install.sh` from the latest release zip — newer installer versions write the absolute path to node into Cursor's config.
2. Quit and relaunch Cursor.

### 10. `/ado-connect` says "refusing to write into home directory" — why?
You opened Cursor without a project folder.
1. Close any Cursor window that's just showing your home folder.
2. Open your actual project folder via **File → Open Folder…**.
3. Re-run `/ado-connect` from inside that window.

---

## Need help?

Reach out to the person who shared this guide and the release zip with you. Include:

1. **What you ran** — exact command or wizard step.
2. **What you expected to happen.**
3. **What actually happened** — screenshots or error logs if available.
4. **Output of `/vortex-ado/ado-check`** — single most useful diagnostic.
