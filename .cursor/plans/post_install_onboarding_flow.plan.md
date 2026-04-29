---
name: Post-Install Welcome and Orientation
overview: A concise, user-friendly welcome experience that introduces ADO TestForge MCP, summarizes current capabilities, and outlines best practices for scalability, reliability, and maintainability.
todos:
  - id: first-run-detection
    content: Add first-run detection via flag file (.ado-testforge-initialized) or conventions.config.json field
    status: completed
  - id: welcome-message
    content: Implement state-aware welcome message in check_setup_status output (conditional on Confluence/ADO setup)
    status: completed
  - id: quick-start-cta
    content: Add quick-start call-to-action to welcome message with example command
    status: completed
  - id: version-tracking
    content: Add version number to welcome header and support version-aware updates
    status: completed
  - id: reliability-best-practices
    content: Add Reliability section to Best Practices
    status: completed
  - id: update-setup-guide
    content: Update docs/setup-guide.md to reference welcome experience and first-run flow
    status: completed
  - id: confluence-silent-skip
    content: Ensure Confluence missing config or errors are silently skipped — no exceptions thrown, no warnings shown to user, core ADO flow unaffected
    status: completed
  - id: deploy
    content: Run npm run deploy after changes with rollback note
    status: completed
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

When a user completes installation (or runs `check_status` for the first time), the server should present a **state-aware** welcome message.

---

### Variant A — First Run (No Confluence)

> **Welcome to ADO TestForge MCP v1.0.0**
>
> Your AI-powered QA co-pilot is ready.
>
> ADO TestForge MCP connects Cursor IDE directly to Azure DevOps — so you can draft, review, and push test cases without ever leaving your editor. It reads your User Stories, understands your team's naming conventions, and handles all the ADO plumbing (folder structures, query-based suites, field mappings) so you can stay focused on test quality.
>
> Think of it as the QA teammate who never forgets a convention, never skips a step, and works at the speed of your prompts.
>
> **Two ways to work — pick what feels natural:**
> | Style | Example |
> |---|---|
> | Slash command | `/ado-testforge/draft_test_cases` |
> | Plain English | "Draft test cases for User Story #12345" |
>
> **Ready? Start here:**
> - `/ado-testforge/get_user_story` — Fetch a User Story with full QA context
> - `/ado-testforge/draft_test_cases` — Generate test cases ready for ADO
> - `/ado-testforge/check_status` — Verify your setup anytime
>
> Type `/ado-testforge/` in Cursor's AI chat to explore all 20+ commands, or just ask in plain English.

---

### Variant B — First Run (Confluence Configured)

> **Welcome to ADO TestForge MCP v1.0.0**
>
> Your AI-powered QA co-pilot is ready — with Confluence connected.
>
> ADO TestForge MCP connects Cursor IDE directly to Azure DevOps and Confluence — so you can draft, review, and push test cases without ever leaving your editor. It reads your User Stories, automatically pulls in linked Solution Design pages from Confluence for full business and technical context, follows your team's naming conventions, and handles all the ADO plumbing (folder structures, query-based suites, field mappings) so you can stay focused on test quality.
>
> Think of it as the QA teammate who never forgets a convention, never skips a step, and works at the speed of your prompts.
>
> **Two ways to work — pick what feels natural:**
> | Style | Example |
> |---|---|
> | Slash command | `/ado-testforge/draft_test_cases` |
> | Plain English | "Draft test cases for User Story #12345" |
>
> **Ready? Start here:**
> - `/ado-testforge/get_user_story` — Fetch a User Story with full QA context + Solution Design
> - `/ado-testforge/draft_test_cases` — Generate test cases ready for ADO
> - `/ado-testforge/check_status` — Verify your setup anytime
>
> Type `/ado-testforge/` in Cursor's AI chat to explore all 20+ commands, or just ask in plain English.

---

### Variant C — Returning User (Same Version)

> **ADO TestForge MCP v1.0.0** | Status: ✓ Ready

---

### Variant D — Degraded State (Missing or Invalid Credentials)

> **ADO TestForge MCP — Setup Incomplete**
>
> Your ADO credentials are missing or invalid. No tools will work until this is resolved.
>
> Run `/ado-testforge/install` or follow the setup guide: `docs/setup-guide.md`

---

**Tone:** Conversational but professional. No marketing fluff. Lead with value, explain the "why", make the first action obvious.

### Conditional Content Rules

- **Confluence mention:** Only show Variant B if `confluenceBaseUrl` is present and valid in config — otherwise show Variant A
- **get_user_story CTA:** Show "with full QA context + Solution Design" only when Confluence is configured; otherwise show "with full QA context"
- **Suite hierarchy:** Only mention if ADO connection is verified at startup
- **Degraded state:** Show Variant D and suppress all other content if credentials are missing or config is invalid

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
- Fetch User Stories with full QA context
- *(Optional)* Auto-fetch linked Solution Design from Confluence when `confluenceBaseUrl` is configured

### Test Suite Management
- Auto-build the complete suite folder hierarchy from just a User Story ID

### Test Case Drafting
- Draft test cases in markdown for review, then push approved drafts to ADO

### Test Case Management
- Create, read, update, and delete test cases with convention-driven formatting

### Confluence Integration *(Optional)*
- Solution Design pages are fetched automatically when linked in the User Story — requires `confluenceBaseUrl` set in config
- If Confluence is not configured, this feature is silently skipped — no errors, no warnings, no degraded experience
- Core ADO functionality works fully without Confluence

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

### Welcome Variants
- [ ] Variant A shown on first run when `confluenceBaseUrl` is absent
- [ ] Variant B shown on first run when `confluenceBaseUrl` is present and valid
- [ ] Variant C (brief header only) shown on second run with same version
- [ ] Variant D (degraded) shown when ADO credentials are missing or invalid
- [ ] `get_user_story` CTA shows "with full QA context" when Confluence absent
- [ ] `get_user_story` CTA shows "with full QA context + Solution Design" when Confluence configured

### First-Run Detection
- [ ] Flag file created correctly after first successful run
- [ ] Flag file contains correct version and timestamp
- [ ] Flag file absent → full welcome shown
- [ ] Flag file present, same version → brief header shown

### Version-Aware Updates
- [ ] After version bump, "What's New" message is shown
- [ ] Flag file version updated after "What's New" is displayed
- [ ] Subsequent runs after update show brief header (not "What's New" again)

### Confluence Silent-Skip
- [ ] Missing `confluenceBaseUrl` — no error thrown, ADO tools work normally
- [ ] Invalid/unreachable Confluence URL — error suppressed, ADO tools unaffected
- [ ] Confluence section absent from welcome when not configured

### Flag File & Stability
- [ ] Flag file is created/updated correctly across all state transitions
- [ ] Version number appears correctly in all welcome variants
- [ ] No welcome noise on every run — brief header only after first run
