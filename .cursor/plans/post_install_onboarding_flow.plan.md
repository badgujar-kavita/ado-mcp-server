---
name: Post-Install Welcome and Orientation
overview: A concise, user-friendly welcome experience that introduces ADO TestForge MCP, summarizes current capabilities, and outlines best practices for scalability, reliability, and maintainability.
todos:
  - id: first-run-detection
    status: pending
    content: Add first-run detection via flag file (.ado-testforge-initialized) or conventions.config.json field
  - id: welcome-message
    status: pending
    content: Implement state-aware welcome message in check_setup_status output (conditional on Confluence/ADO setup)
  - id: quick-start-cta
    status: pending
    content: Add quick-start call-to-action to welcome message with example command
  - id: version-tracking
    status: pending
    content: Add version number to welcome header and support version-aware updates
  - id: reliability-best-practices
    status: pending
    content: Add Reliability section to Best Practices
  - id: update-setup-guide
    status: pending
    content: Update docs/setup-guide.md to reference welcome experience and first-run flow
  - id: deploy
    status: pending
    content: Run npm run deploy after changes with rollback note
isProject: true
---

# Post-Install Welcome and Orientation

## Overview

After installation, greet the user with a clear, professional welcome message that explains what ADO TestForge MCP is, what it can do today, and how to get the most out of it. The message should be accessible to both technical and non-technical stakeholders — no jargon walls, no setup fatigue.

---

## First-Run Detection

Track first-run and version state to provide appropriate welcome messages without creating noise on every run.

### Detection Mechanism

**Option 1: Flag File (Recommended)**
- Create `.ado-testforge-initialized` in credentials directory (`~/.ado-testforge-mcp/`)
- File contains JSON: `{ "initialized": true, "lastSeenVersion": "1.0.0", "firstRunDate": "2026-04-15" }`
- If flag absent → show full welcome + feature summary
- If flag present → show brief header only (version number + status)
- If credentials missing/invalid → show setup guide link instead of welcome

**Option 2: Config Field**
- Add `userState.firstRunCompleted` and `userState.lastSeenVersion` to `conventions.config.json`
- Less invasive but requires config file to exist

### Display Logic

```
IF credentials missing OR config invalid:
  → Show setup guide link + error details
ELSE IF flag file absent:
  → Show full welcome message + feature summary + quick-start CTA
  → Create flag file with current version
ELSE IF flag.lastSeenVersion < currentVersion:
  → Show "What's New in vX.Y" update summary
  → Update flag file version
ELSE:
  → Show brief header: "ADO TestForge MCP v1.0.0 | Status: ✓ Ready"
```

---

## Welcome Message (State-Aware)

When a user completes installation (or runs `check_status` for the first time), the server should present a **state-aware** welcome message:

> **Welcome to ADO TestForge MCP v1.0.0**
>
> ADO TestForge MCP connects your Cursor IDE directly to Azure DevOps, giving you AI-assisted test case management without leaving your editor. It reads User Stories, [CONDITIONAL: fetches Solution Design context from Confluence,] and helps you draft, review, and push test cases — all through natural-language commands in Cursor's AI chat.
>
> Think of it as your QA co-pilot: it understands your User Story context, follows your team's naming conventions and formatting rules, and handles the repetitive ADO plumbing (folder structures, query-based suites, field mappings) so you can focus on test quality.
>
> **Ready? Start with:**
> - `Get me the context for User Story #12345` — Fetch US with auto-linked Solution Design
> - `/ado-testforge/draft_test_cases` — Draft test cases for a User Story
> - `/ado-testforge/check_status` — Verify your setup anytime
>
> **Tip:** All slash commands are available in Cursor's AI chat. Type `/ado-testforge/` to see the full list.

**Tone:** Conversational but professional. No marketing fluff. Explain the "what" and "why" in plain language.

### Conditional Content Rules

- **Confluence mention:** Only show if `confluenceBaseUrl` is set in config
- **Suite hierarchy:** Only mention if ADO connection is verified
- **Degraded state:** If credentials are missing, show: "Setup incomplete. Run `/ado-testforge/install` or see `docs/setup-guide.md` for help."

---

## Version-Aware Updates

When a returning user runs `check_status` after an update:

> **What's New in ADO TestForge MCP v1.1.0**
>
> - ✨ Automation-friendly expected result patterns for test cases
> - 📁 Test case asset management with structured folder conventions
> - 🎯 Mandatory condition-based prerequisite format
> - 📖 New quick reference: `docs/automation-friendly-test-patterns.md`
>
> **Full changelog:** `docs/changelog.md`

Keep update summaries to 3-5 bullet points max.

---

## Current Functionality

### User Story Context
- Fetch User Stories with full QA context and auto-fetch linked Solution Design from Confluence

### Test Suite Management
- Auto-build the complete suite folder hierarchy from just a User Story ID

### Test Case Drafting
- Draft test cases in markdown for review, then push approved drafts to ADO

### Test Case Management
- Create, read, update, and delete test cases with convention-driven formatting

### Confluence Integration
- Solution Design pages are fetched automatically when linked in the User Story

### Configuration-Driven
- All naming patterns, formats, and defaults are externalized in `conventions.config.json`

---

## Best Practices

### Scalability

- All conventions are externalized in config — update rules without changing code
- Each tool does one thing well; complex workflows are composed by the AI prompt layer
- Prompts and skills are separate from tool logic — new use cases often need only a new prompt
- Per-user credentials and global registration make multi-project use straightforward

### Reliability

- Credentials are validated at startup via `check_setup_status` — fail fast before any tool runs
- All ADO/Confluence calls are wrapped with descriptive error messages — no raw API errors exposed to the user
- Config schema is validated on load — misconfigured fields surface immediately, not mid-workflow
- First-run detection prevents welcome message noise on every status check
- Version tracking ensures users are informed of updates without being overwhelmed

### Maintainability

- Updates are deployed to Google Drive automatically via `npm run deploy` — users just refresh the MCP server in Cursor Settings to get the latest changes, no manual syncing required
- **Rollback:** Keep previous build artifact in Google Drive (e.g., `dist-package-v1.0.0-backup/`) before overwriting for safety
- Version number in welcome header allows users to confirm they have the latest build

---

## Implementation Notes

### Files to Modify

1. **`src/tools/setup.ts`** (check_setup_status tool)
   - Add first-run detection logic
   - Add state-aware welcome message generation
   - Add version tracking
   - Create/update flag file at `~/.ado-testforge-mcp/.ado-testforge-initialized`

2. **`package.json`**
   - Ensure version number is accessible (already exists)
   - Version should be incremented before each deploy

3. **`docs/setup-guide.md`**
   - Reference welcome experience in Quick Start section
   - Document first-run flow
   - Mention version-aware updates

4. **`deploy.mjs`** (optional)
   - Add automatic backup of previous dist-package before overwrite
   - Rename old folder to `dist-package-v<version>-backup` before copying new build

### Flag File Structure

```json
{
  "initialized": true,
  "lastSeenVersion": "1.0.0",
  "firstRunDate": "2026-04-15T10:30:00Z",
  "lastCheckDate": "2026-04-15T15:45:00Z"
}
```

### Version Comparison Logic

```typescript
function shouldShowUpdate(flagVersion: string, currentVersion: string): boolean {
  // Simple semver comparison: "1.0.0" vs "1.1.0"
  const [flagMajor, flagMinor, flagPatch] = flagVersion.split('.').map(Number);
  const [curMajor, curMinor, curPatch] = currentVersion.split('.').map(Number);
  
  return curMajor > flagMajor || 
         (curMajor === flagMajor && curMinor > flagMinor) ||
         (curMajor === flagMajor && curMinor === flagMinor && curPatch > flagPatch);
}
```

---

## Testing Checklist

- [ ] First run (no flag file) shows full welcome + CTA
- [ ] Second run (flag exists, same version) shows brief header only
- [ ] After version bump, shows "What's New" message
- [ ] Confluence conditional works (show/hide based on config)
- [ ] Degraded state (missing credentials) shows setup link
- [ ] Flag file is created/updated correctly
- [ ] Version number appears in all welcome variants
