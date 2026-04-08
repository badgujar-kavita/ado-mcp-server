# Post-Install Onboarding and Project Context Capture

## Overview

Add an interactive post-install onboarding experience that auto-detects first run, welcomes the user, collects project context using structured multi-select UI for platforms and free-text for names/notes, performs background web research, and feeds the context into test case drafting.

## Current State

- After installation, user gets a static "Installation complete!" message -- no welcome, no guided tour
- No project context (platforms, domain, technologies) is captured or used
- Test case drafting relies only on: US fields + one Confluence SD page + hardcoded conventions config
- Existing profile/enhanced-context plans are pending and can layer on top later

---

## Key UX Decisions

- **Question format:** Structured multi-select UI (checkboxes) for platform/module/domain selection; free-text for project name, integration notes, and other open-ended inputs
- **Trigger:** Auto-detect on first meaningful tool use -- when `get_project_context` returns "not configured," the AI proactively welcomes and guides onboarding before proceeding
- **Non-blocking:** Onboarding is strongly encouraged but never blocks tool usage
- **Web research:** Always performed on mentioned platforms, regardless of file uploads

---

## How Auto-Detect Works (Step by Step)

```mermaid
sequenceDiagram
    participant U as User
    participant AI as Cursor AI
    participant MCP as MCP Server
    participant FS as FileSystem

    Note over U,FS: Scenario: User runs /draft_test_cases for first time

    U->>AI: /draft_test_cases (US ID: 12345)
    AI->>MCP: get_project_context()
    MCP->>FS: Read ~/.ado-testforge-mcp/project-context.json
    FS-->>MCP: File not found
    MCP-->>AI: { configured: false, message: "Project context not set up yet..." }

    Note over AI: AI sees configured=false, triggers onboarding

    AI->>U: Welcome! Before drafting, let me learn about your project...
    AI->>U: AskQuestion: "What is your project name?" (free-text)
    U-->>AI: "Lightning CRM Migration"
    AI->>U: AskQuestion: "Business domain?" (multi-select checkboxes)
    U-->>AI: [Sales, Order Management]
    AI->>U: AskQuestion: "Platforms involved?" (multi-select checkboxes)
    U-->>AI: [Salesforce, SAP, MuleSoft]
    AI->>U: AskQuestion: "Salesforce modules?" (multi-select)
    U-->>AI: [Sales Cloud, CPQ]
    AI->>U: AskQuestion: "SAP modules?" (multi-select)
    U-->>AI: [SD, MM]
    AI->>U: "How do these connect?" (free-text)
    U-->>AI: "MuleSoft middleware, Okta SSO"
    AI->>U: "Any supporting docs to share?" (optional)
    U-->>AI: "Skip"

    Note over AI: AI performs web research on all platforms
    AI->>AI: Web search: Salesforce Sales Cloud, CPQ, SAP SD/MM, MuleSoft, Okta
    AI->>AI: Generate platform knowledge summaries

    AI->>MCP: save_project_context({ projectName, platforms, knowledge... })
    MCP->>FS: Write project-context.json
    AI->>U: "Context saved! Now continuing with your test case draft..."

    Note over AI: AI now continues the original /draft_test_cases flow
    AI->>MCP: get_user_story(12345)
    AI->>AI: Draft with platform awareness
```

**The key insight:** The AI does not need a separate trigger. The `draft_test_cases` prompt instructs it to call `get_project_context` first. If not configured, the AI runs the onboarding inline then the original command continues seamlessly. The user never has to know about a separate `/setup_project` command -- it just happens naturally.

The `/setup_project` prompt still exists as a standalone command for users who want to set up context proactively or update it later.

---

## Structured Question Design

### Questions Using Multi-Select UI (AskQuestion tool with checkboxes)

**Business Domain:**
- Options: Sales, Service, Finance, HR, Supply Chain, Marketing, Order Management, E-Commerce, Analytics, Custom/Other
- `allow_multiple: true`

**Platforms / Technologies:**
- Options: Salesforce, SAP, ServiceNow, MuleSoft, Azure, AWS, Oracle, Workday, Custom Web App, Custom Mobile App, Other
- `allow_multiple: true`

**Per-platform modules** (shown only for selected platforms):
- Salesforce: Sales Cloud, Service Cloud, CPQ, Marketing Cloud, Communities/Experience Cloud, Platform/Custom, Other
- SAP: SD, MM, FI, CO, PP, HR, Other
- (extensible for other platforms)
- `allow_multiple: true`

**Supporting files:**
- Options: "Upload files now", "Skip for now"
- `allow_multiple: false`

### Questions Using Free-Text

- Project name
- Integration notes ("How do these platforms connect?")
- Additional context or notes

---

## Data Model: `project-context.json`

Stored at `~/.ado-testforge-mcp/project-context.json`:

```json
{
  "projectName": "Lightning CRM Migration",
  "businessDomain": ["Sales", "Order Management"],
  "platforms": [
    {
      "name": "Salesforce",
      "type": "CRM",
      "modules": ["Sales Cloud", "CPQ"]
    },
    {
      "name": "SAP S/4HANA",
      "type": "ERP",
      "modules": ["SD", "MM"]
    },
    {
      "name": "MuleSoft",
      "type": "Middleware",
      "modules": []
    }
  ],
  "integrations": "MuleSoft handles all integration between SF and SAP. SSO via Okta.",
  "platformKnowledge": {
    "Salesforce_SalesCloud": "...concise testing-relevant summary...",
    "Salesforce_CPQ": "...concise summary...",
    "SAP_SD": "...concise summary...",
    "MuleSoft": "...integration testing patterns...",
    "Okta_SSO": "...auth testing patterns..."
  },
  "additionalNotes": "",
  "createdAt": "2026-04-09T...",
  "updatedAt": "2026-04-09T..."
}
```

---

## Implementation

### Phase 1: Project Context Module and Tools

**New file: [src/project-context.ts](src/project-context.ts)**
- Zod schema for `ProjectContext` (matching the JSON model above)
- `loadProjectContext()` -- reads from `~/.ado-testforge-mcp/project-context.json`, returns `{ configured: false, message: "..." }` if missing, or `{ configured: true, context: {...} }` if present
- `saveProjectContext(data)` -- validates with Zod, writes to file
- Constants for the home directory path

**Modify: [src/tools/setup.ts](src/tools/setup.ts)**
- Add `get_project_context` tool -- calls `loadProjectContext()`, returns status + context
- Add `save_project_context` tool -- accepts structured project data, calls `saveProjectContext()`
- Enhance `check_setup_status` -- add a "Project Context" line showing configured/not-configured status

### Phase 2: `/setup_project` Prompt

**Modify: [src/prompts/index.ts](src/prompts/index.ts)**

Register `/setup_project` prompt with detailed AI instructions:
- Welcome message text
- Step-by-step question flow
- Explicit instruction to use AskQuestion tool with `allow_multiple: true` for domain, platform, and module questions
- Explicit instruction to use free-text for project name, integration notes
- Instruction to always perform web research on each selected platform (search for "[Platform] [Module] testing concepts and common test scenarios")
- Instruction to generate concise platform knowledge summaries (2-3 paragraphs per platform, focused on testing relevance)
- Instruction to call `save_project_context` at the end
- Closing message with next-steps guidance

### Phase 3: Auto-Detect in Drafting Flow

**Modify: [src/prompts/index.ts](src/prompts/index.ts)** -- update `draft_test_cases` prompt:
- Add instruction: "Before starting, call `get_project_context`. If `configured: false`, welcome the user and run the full onboarding flow (same as `/setup_project`) before proceeding with the draft."
- Add instruction: "If `configured: true`, use the platform knowledge to inform your analysis of the acceptance criteria and solution design."

**Modify: [.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md](.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md)**
- Add "Step 0: Load Project Context" before the existing Step 1
- Instruct: "Call `get_project_context`. Use the platform knowledge to understand domain terminology, identify platform-specific test scenarios, and generate accurate prerequisites."

### Phase 4: `/update_project` for Later Changes

**Modify: [src/prompts/index.ts](src/prompts/index.ts)**
- Register `/update_project` -- loads existing context, shows current summary, asks what to change
- Lighter flow: only re-asks about the parts being updated, re-runs web research if new platforms added

### Phase 5: Docs and Deploy

- [docs/user-setup-guide.md](docs/user-setup-guide.md) -- add "Project Context" section explaining that onboarding auto-triggers but can also be run via `/setup_project`
- [docs/implementation.md](docs/implementation.md) -- document new tools and schema
- [docs/testing-guide.md](docs/testing-guide.md) -- add `/setup_project` and `/update_project` to command reference
- Run `npm run deploy`

---

## Design Decisions

- **Auto-detect over explicit trigger:** The user never needs to remember `/setup_project`. It fires naturally on first use. But the slash command exists for proactive/repeat use.
- **Inline onboarding:** When auto-detected during `/draft_test_cases`, onboarding runs inline then the original command continues seamlessly. The user does not have to re-invoke.
- **Mixed UI:** Structured checkboxes for selections (less typing, fewer errors), free-text for names and notes (more natural).
- **Single file, profile-ready:** `project-context.json` lives at `~/.ado-testforge-mcp/` now. When profiles land, `loadProjectContext()` just changes its path -- no other code changes needed.
- **Web research always runs:** Even if the user uploads detailed docs, the AI still searches for each platform to build baseline testing knowledge. Uploads supplement, not replace.

---

## Example: What Check Status Shows

Before onboarding:
```
User: /ado-testforge/check_status

AI:   Setup Status
      ---
      ADO Connection:      Connected (org: myorg, project: myproject)
      Confluence:          Connected
      Project Context:     Not configured
                           Run /setup_project or it will auto-start on your
                           first /draft_test_cases run.
```

After onboarding:
```
      Project Context:     Configured
                           Project: Lightning CRM Migration
                           Platforms: Salesforce (Sales Cloud, CPQ),
                                     SAP S/4HANA (SD, MM), MuleSoft
                           Last updated: 2026-04-09
```

---

## Risks and Mitigations

- **Web search quality:** Platform knowledge from web search may be generic. Mitigation: the prompt instructs the AI to focus on testing-relevant aspects, and the user can correct/supplement.
- **Context drift:** Project scope changes over time. Mitigation: `/update_project` makes it easy to refresh. Context has `updatedAt` timestamp.
- **Large context size:** Many platforms with detailed knowledge could bloat the context. Mitigation: platform knowledge summaries are kept concise (2-3 paragraphs per platform max).
- **Privacy:** Project names and platform info are stored locally only, never transmitted. Web searches are generic ("Salesforce Sales Cloud testing concepts") not project-specific.

---

## Todos

- [ ] Create `src/project-context.ts` -- Zod schema, load/save functions, path constants
- [ ] Add `get_project_context` and `save_project_context` tools to `src/tools/setup.ts`; enhance `check_setup_status` with context status line
- [ ] Register `/setup_project` prompt in `src/prompts/index.ts` with full conversational flow, structured AskQuestion instructions, web research instructions
- [ ] Update `draft_test_cases` prompt to call `get_project_context` first and auto-trigger onboarding if not configured
- [ ] Add Step 0 (Load Project Context) to `SKILL.md` with platform-aware analysis instructions
- [ ] Register `/update_project` prompt for lightweight context updates
- [ ] Update `user-setup-guide.md`, `implementation.md`, `testing-guide.md`; run `npm run deploy`
