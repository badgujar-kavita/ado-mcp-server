# Per-Workspace Conventions Reference

**Documentation index:** [docs/README.md](README.md) | **Changelog:** [docs/changelog.md](changelog.md)

Canonical reference for `<workspace>/.vortex-ado/config.json` — the per-workspace config that VortexADO MCP reads on every load.

---

## 1. Why per-workspace?

A QA engineer who works on more than one ADO project simultaneously used to hit a wall: a single global config at `~/.vortex-ado/conventions.config.json` and a single PAT at `~/.vortex-ado/credentials.json` were shared by **every** Cursor window. Two windows = one shared config, and every `/ado-connect` overwrote the same file.

Phase 1 fixes that. Each Cursor window has its own MCP process with its own working directory. The MCP reads its config from `<workspace>/.vortex-ado/config.json` and looks up its credentials in the OS keychain by `org/project` — so two windows on two projects coexist with zero interference.

```
┌──────────────────────────────┐         ┌──────────────────────────────┐
│  Cursor window 1             │         │  Cursor window 2             │
│  Workspace: ~/code/abc       │         │  Workspace: ~/code/xyz       │
│                              │         │                              │
│  MCP process A               │         │  MCP process B               │
│  ├─ cwd = ~/code/abc         │         │  ├─ cwd = ~/code/xyz         │
│  ├─ reads .vortex-ado/       │         │  ├─ reads .vortex-ado/       │
│  │   config.json             │         │  │   config.json             │
│  └─ keychain lookup:         │         │  └─ keychain lookup:         │
│     ado::OrgA::Project_ABC   │         │     ado::OrgB::Project_XYZ   │
└──────────────────────────────┘         └──────────────────────────────┘
        │                                        │
        ▼                                        ▼
   ADO OrgA / Project_ABC                  ADO OrgB / Project_XYZ
```

---

## 2. File location

```
<workspace>/.vortex-ado/config.json
```

| Aspect | Detail |
|---|---|
| Created by | `/ado-connect` (run from inside the workspace folder in Cursor) |
| Edited by  | You — directly with any text editor |
| Committed? | Up to you. Most teams add `.vortex-ado/` to `.gitignore` since it can carry org-specific values, but the file itself contains **no secrets** (PAT/tokens live in the OS keychain). |

> ℹ️ **Phase 1 limitation.** `/ado-connect` only fills in connection fields — `ado.url`, `ado.org`, `ado.project`, and Confluence settings. Naming conventions, personas, and plan mappings must be added by hand. Phase 2 will extend the wizard to collect these.

---

## 3. Schema reference (annotated)

Every field below appears as a top-level key in `config.json`. Anything not listed here is supplied by the framework defaults — you don't need to specify it.

### 3.1 Connection — `ado`, `confluence`

| Field | Required? | What it does |
|---|---|---|
| `version` | REQUIRED | Schema version. Always `1` today. |
| `ado.url` | REQUIRED | Full ADO URL, e.g. `https://dev.azure.com/MyOrg`. |
| `ado.org` | REQUIRED | Organization name. Used as the keychain account key (`ado::{org}::{project}`). |
| `ado.project` | REQUIRED | Project name. Combined with `org` for keychain lookup. |
| `ado.setupAt` | RECOMMENDED | ISO timestamp of when `/ado-connect` last ran. The wizard writes this; you don't need to maintain it manually. |
| `ado.fieldRefs.prerequisite` | SAFE-TO-LEAVE | Optional override for the ADO field that holds the Prerequisite-for-Test HTML. Defaults to `Custom.PrerequisiteforTest`, falls back to `System.Description`. |
| `ado.fieldRefs.solutionDesign` | SAFE-TO-LEAVE | Optional override for the ADO field that contains the Solution Design Confluence link. Defaults to `Custom.TechnicalSolution`. |
| `confluence.enabled` | SAFE-TO-LEAVE | `true` enables Confluence enrichment. If absent or `false`, Solution Design content is skipped silently. |
| `confluence.url` | RECOMMENDED if `enabled` | e.g. `https://your-org.atlassian.net/wiki`. |
| `confluence.email` | RECOMMENDED if `enabled` | Email of the Atlassian account that owns the API token. |

### 3.2 Naming conventions — `testCaseTitle`, `suiteStructure`

| Field | Required? | What it does |
|---|---|---|
| `testCaseTitle.prefix` | RECOMMENDED | Prefix used in TC titles (e.g. `TC`, `TC_`, `TestCase_`). Defaults to `TC`. |
| `suiteStructure.sprintPrefix` | RECOMMENDED | Sprint suite folder prefix. `Sprint_14` ← `Sprint_`. Override for `SFTPM_`, `Iteration_`, etc. |
| `suiteStructure.tcTitlePrefix` | SAFE-TO-LEAVE | Used in query-based suite WIQL (`Title Contains TC_<USID>`). Defaults to `TC`. Usually matches `testCaseTitle.prefix`. |
| `suiteStructure.testPlanMapping` | **REQUIRED for `/qa-publish`** | Array routing user stories to test plans by area path. Without it, `qa_publish_push` returns `plan-resolution-failed`. |

`testPlanMapping` shape:

```json
[
  { "planId": 12345, "areaPathContains": ["MyArea", "MyOtherArea"] },
  { "planId": 67890, "areaPathContains": ["AnotherArea"] }
]
```

Match is case-insensitive substring. First match wins.

### 3.3 Personas + prereq defaults — `prerequisiteDefaults`

| Field | Required? | What it does |
|---|---|---|
| `prerequisiteDefaults.personas` | RECOMMENDED | Map of persona keys to their `label`, `profile`, `roles`, `psg` (and optional `user`). Drives the "Persona" block in every drafted test case. |
| `prerequisiteDefaults.personaRolesLabel` | SAFE-TO-LEAVE | Column heading shown next to the roles value (e.g. `Roles`, `TPM Roles`). Defaults to `Roles`. |
| `prerequisiteDefaults.personaPsgLabel` | SAFE-TO-LEAVE | Column heading shown next to the permission group value (e.g. `PSG`, `Permission Set Group`). Defaults to `Permission Set Group`. |

Persona example:

```json
{
  "Cashier": {
    "label":   "Cashier",
    "profile": "POS_Profile",
    "roles":   "Cashier",
    "psg":     "POS Users"
  },
  "Manager": {
    "label":   "Store Manager",
    "profile": "Manager_Profile",
    "roles":   "Manager",
    "psg":     "Store Managers"
  }
}
```

Order in JSON determines display order. Without any personas, drafted TCs render with an empty Persona section.

### 3.4 Optional integrations — `solutionDesign`, `additionalContextFields`

| Field | Required? | What it does |
|---|---|---|
| `additionalContextFields` | SAFE-TO-LEAVE | Array of extra ADO fields to include in `ado_story` context. Useful when your team uses custom rich-text fields (Impact Assessment, Reference Documentation, etc.). Empty by default. |

Element shape:

```json
{
  "adoFieldRef":  "Custom.ImpactAssessment",
  "label":        "Impact Assessment",
  "fetchLinks":   true,
  "fetchImages":  true
}
```

### 3.5 Tuning — `images`, `context`, `allFields`

These live in framework defaults and are usually fine to leave alone. If you do want to override, see [setup-guide.md → Step 2c](setup-guide.md#step-2c-tune-context-richness-optional) for the full list of keys.

---

## 4. Edit priority — what to fill in first

| Field | Priority | Why |
|---|---|---|
| `ado.org`, `ado.project`, `ado.url` | **REQUIRED** | Wizard fills these. Needed to resolve the PAT in the OS keychain. |
| `suiteStructure.testPlanMapping` | **REQUIRED for `/qa-publish`** | Without it, push fails with `plan-resolution-failed`. |
| `prerequisiteDefaults.personas` | **RECOMMENDED** | Without it, draft TCs render with an empty Persona section. |
| `testCaseTitle.prefix` | **RECOMMENDED** | Defaults to `TC`. Override if your team uses `TC_`, `TestCase_`, etc. |
| `suiteStructure.sprintPrefix` | **RECOMMENDED** | Defaults to `Sprint_`. Override for `SFTPM_`, `Iteration_`, etc. |
| `ado.fieldRefs.prerequisite` | SAFE-TO-LEAVE | Defaults to `Custom.PrerequisiteforTest`, falls back to `System.Description`. |
| `additionalContextFields` | SAFE-TO-LEAVE | Empty default. Only set if your team has custom ADO fields with rich-text context worth fetching. |

---

## 5. Multi-project scenario

Take a QA engineer who needs to work on `Project_ABC` and `Project_XYZ` in parallel — different ADO orgs, different personas, different test plans.

**Two workspaces, two configs:**

```
~/code/project-abc/                        ~/code/project-xyz/
├── .vortex-ado/                           ├── .vortex-ado/
│   └── config.json                        │   └── config.json
│       {                                  │       {
│         "ado": {                         │         "ado": {
│           "org":     "OrgA",             │           "org":     "OrgB",
│           "project": "Project_ABC"       │           "project": "Project_XYZ"
│         },                               │         },
│         "testCaseTitle": {               │         "testCaseTitle": {
│           "prefix": "TC_"                │           "prefix": "TestCase_"
│         },                               │         },
│         "suiteStructure": {              │         "suiteStructure": {
│           "sprintPrefix": "Sprint_",     │           "sprintPrefix": "Iteration_",
│           "testPlanMapping": [           │           "testPlanMapping": [
│             { "planId": 111, ... }       │             { "planId": 222, ... }
│           ]                              │           ]
│         },                               │         },
│         "prerequisiteDefaults": {        │         "prerequisiteDefaults": {
│           "personas": { "Cashier": ... } │           "personas": { "Manager": ... }
│         }                                │         }
│       }                                  │       }
└── ...                                    └── ...
```

**Two keychain entries:**

| Service | Account | What it stores |
|---|---|---|
| `vortex-ado` | `ado::OrgA::Project_ABC` | PAT for OrgA |
| `vortex-ado` | `ado::OrgB::Project_XYZ` | PAT for OrgB |

Open both folders in two Cursor windows. Each window's MCP process picks up its own config and its own PAT. They never share state.

---

## 6. Where credentials live

ADO PATs and Confluence API tokens are stored in the operating system's secure credential store via [`keytar`](https://github.com/atom/node-keytar) — never on disk, never in `config.json`.

| Platform | Backing store | How to inspect |
|---|---|---|
| macOS    | Keychain Services | Open **Keychain Access.app**, search for `vortex-ado` |
| Windows  | Credential Manager | **Control Panel → Credential Manager → Generic Credentials**, search for `vortex-ado` |
| Linux    | libsecret (GNOME Keyring / KWallet) | `secret-tool search service vortex-ado` |

**Service name:** `vortex-ado`

**Account format:**

| Account | Stores |
|---|---|
| `ado::{org}::{project}` | ADO Personal Access Token |
| `confluence::{org}::{project}` | Confluence API token |

### Deleting a token manually

If you ever need to wipe a credential outside the wizard:

**macOS:**
```bash
security delete-generic-password -s "vortex-ado" -a "ado::MyOrg::MyProject"
```

**Windows (PowerShell):**
```powershell
cmdkey /delete:"vortex-ado/ado::MyOrg::MyProject"
```
(or remove via Credential Manager UI)

**Linux:**
```bash
secret-tool clear service vortex-ado account "ado::MyOrg::MyProject"
```

> ℹ️ Re-running `/ado-connect` and switching to a different `org/project` automatically deletes orphaned keychain entries — you don't normally need to clean up by hand.

---

## 7. Copy-pasteable starter template

Drop this in `<workspace>/.vortex-ado/config.json`, replace the placeholders, and you're set. Anything you delete falls back to framework defaults.

```jsonc
{
  "version": 1,

  // -- Connection (REQUIRED) -------------------------------------------------
  "ado": {
    "url":     "https://dev.azure.com/MyOrg",
    "org":     "MyOrg",
    "project": "MyProject"
    // Optional field overrides:
    // "fieldRefs": {
    //   "prerequisite":   "Custom.PrerequisiteforTest",
    //   "solutionDesign": "Custom.TechnicalSolution"
    // }
  },

  // -- Confluence (optional) -------------------------------------------------
  "confluence": {
    "enabled": false,
    "url":     "https://your-org.atlassian.net/wiki",
    "email":   "your.email@company.com"
  },

  // -- Naming conventions ----------------------------------------------------
  "testCaseTitle": {
    "prefix": "TC"             // override to "TC_" or "TestCase_" if needed
  },

  "suiteStructure": {
    "sprintPrefix":   "Sprint_",  // override for "SFTPM_", "Iteration_", etc.
    "tcTitlePrefix":  "TC",       // used in query-based suite queries

    // REQUIRED for /qa-publish — maps user-story area paths to test plans
    "testPlanMapping": [
      { "planId": 12345, "areaPathContains": ["MyArea"] }
    ]
  },

  // -- Personas + prereq defaults -------------------------------------------
  "prerequisiteDefaults": {
    "personaRolesLabel": "Roles",
    "personaPsgLabel":   "Permission Set Group",
    "personas": {
      "Cashier": {
        "label":   "Cashier",
        "profile": "POS_Profile",
        "roles":   "Cashier",
        "psg":     "POS Users"
      }
    }
  },

  // -- Extra rich-text fields to fetch with /ado-story (optional) -----------
  "additionalContextFields": []
}
```

---

## See also

- [docs/setup-guide.md](setup-guide.md) — full installation + credentials walkthrough
- [docs/user-setup-guide.md](user-setup-guide.md) — condensed setup for end users
- [docs/implementation.md](implementation.md) — internals of the two-layer config resolution
- [docs/changelog.md](changelog.md#phase-1--per-workspace-config--os-keychain) — Phase 1 release notes
