# Version Notification Strategy

**How users will know what version they're on and when updates are available**

---

## Overview

Users need to know:
1. **What version they're currently using**
2. **When a new version is available**
3. **What's new in the latest version**
4. **How to update**

We use **three notification channels** to ensure users stay informed:

---

## Channel 1: MCP Server Metadata (Passive)

### Current Implementation
The MCP server reports its version in metadata (visible in Cursor's MCP settings):

```typescript
// src/index.ts
const server = new McpServer({
  name: "ado-testforge",
  version: "1.0.0",  // Visible in Cursor Settings → MCP
});
```

**User Action:** Settings → MCP → Hover over "ado-testforge" server
**Limitation:** Users rarely check this; not proactive

---

## Channel 2: Welcome Message via `check_setup_status` (Active on Demand)

### Implementation (Part of Post-Install Onboarding Plan)

When users run `check_setup_status` or when credentials are verified:

```
ADO TestForge MCP v1.1.0 | Status: ✓ Ready

Azure DevOps: Connected to org/project
Confluence: Configured
Test Plan Mappings: 2 configured
```

**Features:**
- Shows current version prominently
- First-run detection shows full welcome message
- Returning users see brief status only
- After version update, shows "What's New" summary

**User Action:** Run `/ado-testforge/check_status` anytime
**Benefit:** User-initiated, non-intrusive

---

## Channel 3: Cursor Hooks (Automatic, Proactive) ⭐ **RECOMMENDED**

### Why Hooks?

Cursor hooks can **automatically notify users** when:
- A new version is detected in the deployed folder
- They haven't seen the latest version
- They start a new session with an updated MCP

### Hook Implementation Strategy

Create a **`sessionStart` hook** that:
1. Reads current version from deployed `package.json`
2. Compares with user's last-seen version (stored in flag file)
3. Shows update notification if version is newer
4. Updates flag file with current version

---

## Proposed Implementation: Version Check Hook

### File Structure

```
.cursor/
├── hooks.json
└── hooks/
    └── version-check.sh
```

### 1. Create `.cursor/hooks.json`

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "command": ".cursor/hooks/version-check.sh",
        "timeout": 5
      }
    ]
  }
}
```

### 2. Create `.cursor/hooks/version-check.sh`

```bash
#!/bin/bash
# Version Check Hook for ADO TestForge MCP
# Shows update notification when new version is detected

set -e

# Paths
CREDENTIALS_DIR="$HOME/.ado-testforge-mcp"
FLAG_FILE="$CREDENTIALS_DIR/.version-check"
PACKAGE_JSON="./package.json"

# Create credentials dir if missing
mkdir -p "$CREDENTIALS_DIR"

# Read current version from package.json
if [[ ! -f "$PACKAGE_JSON" ]]; then
  # Not in MCP folder, skip silently
  echo '{ "permission": "allow" }'
  exit 0
fi

CURRENT_VERSION=$(node -p "require('$PACKAGE_JSON').version" 2>/dev/null || echo "unknown")

# Read last seen version from flag file
if [[ -f "$FLAG_FILE" ]]; then
  LAST_SEEN_VERSION=$(cat "$FLAG_FILE" 2>/dev/null || echo "0.0.0")
else
  LAST_SEEN_VERSION="0.0.0"
fi

# Compare versions (simple string comparison for semver)
if [[ "$CURRENT_VERSION" != "$LAST_SEEN_VERSION" ]] && [[ "$CURRENT_VERSION" != "unknown" ]]; then
  # New version detected!
  
  # Update flag file
  echo "$CURRENT_VERSION" > "$FLAG_FILE"
  
  # Show notification
  cat <<EOF
{
  "user_message": "🎉 ADO TestForge MCP Updated to v${CURRENT_VERSION}

📋 What's New:
• Check the changelog: Run \`/ado-testforge/check_status\` or see docs/changelog.md
• Full documentation: docs/README.md

💡 Tip: All your existing drafts and configurations continue to work.",
  "agent_message": "ADO TestForge MCP was updated from v${LAST_SEEN_VERSION} to v${CURRENT_VERSION}. The user has been notified."
}
EOF
else
  # No update, allow silently
  echo '{ "permission": "allow" }'
fi

exit 0
```

### 3. Make Hook Executable

```bash
chmod +x .cursor/hooks/version-check.sh
```

### 4. Test the Hook

1. Deploy new version to Google Drive
2. Users' folders sync automatically
3. Next time they start a Cursor session in a workspace with the MCP folder open, they see:

```
🎉 ADO TestForge MCP Updated to v1.1.0

📋 What's New:
• Check the changelog: Run `/ado-testforge/check_status` or see docs/changelog.md
• Full documentation: docs/README.md

💡 Tip: All your existing drafts and configurations continue to work.
```

---

## Alternative: `preToolUse` Hook (More Frequent)

If you want notifications when users **first use any MCP tool** after an update:

### `.cursor/hooks.json`

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "command": ".cursor/hooks/version-check.sh",
        "matcher": "^MCP: ado-testforge",
        "timeout": 5
      }
    ]
  }
}
```

This runs the version check **before the first MCP tool use** in a session, ensuring users see the notification when they're actively using the MCP.

---

## Notification Timing Comparison

| Hook Event | When It Fires | User Experience | Pros | Cons |
|------------|---------------|-----------------|------|------|
| `sessionStart` | Every new Cursor session | First thing when opening workspace | Immediate, proactive | May feel intrusive if user isn't using MCP |
| `preToolUse` with matcher | First MCP tool use in session | When user actively uses MCP | Contextual, relevant | Delayed if user doesn't use MCP immediately |
| `check_setup_status` output | User runs status check | User-initiated | Non-intrusive, on-demand | Passive, requires user action |

**Recommendation:** Use **`sessionStart`** for maximum visibility, but only show notification **once per version**. The flag file ensures users don't see the same notification repeatedly.

---

## Version Display in Other Locations

### 1. Test Case Draft Headers

Add version to test case draft metadata:

```markdown
| User Story ID | 1245456 |
| Plan ID | 1066479 |
| Status | DRAFT |
| Version | 1 |
| Drafted By | john.doe |
| **MCP Version** | **1.1.0** |
```

**Benefit:** Users can track which MCP version generated each draft

### 2. Welcome Message (Already Planned)

```
Welcome to ADO TestForge MCP v1.1.0

...
```

### 3. Error Messages

Include version in error messages for support:

```
[ADO TestForge MCP v1.1.0] Error: Could not connect to Azure DevOps
Please check your credentials at ~/.ado-testforge-mcp/credentials.json
```

### 4. Slash Command Response

Add version to command help:

```
/ado-testforge/check_status

ADO TestForge MCP v1.1.0
Status: ✓ Ready
...
```

---

## Update Workflow for Users

When a new version is deployed:

1. **Automatic Sync** — Google Drive syncs the updated `dist-package/` folder to all users
2. **Hook Notification** — Next session/tool use, Cursor hook shows update notification
3. **User Action** — User can:
   - Continue working (no action needed, backward-compatible)
   - Run `/ado-testforge/check_status` to see "What's New" details
   - Read `docs/changelog.md` for full changes
4. **MCP Refresh** — If needed, refresh MCP in Settings → MCP (rare, only for breaking changes)

---

## Version Check Logic (Detailed)

### Flag File Format

```
~/.ado-testforge-mcp/.version-check
```

**Contents:** Simple version string
```
1.1.0
```

### Comparison Logic

```bash
# Simple string comparison works for semver
if [[ "$CURRENT_VERSION" != "$LAST_SEEN_VERSION" ]]; then
  # Show notification
fi
```

For more robust comparison (optional):

```bash
# Use sort -V for proper semver comparison
if [[ "$(printf '%s\n' "$LAST_SEEN_VERSION" "$CURRENT_VERSION" | sort -V | tail -n1)" == "$CURRENT_VERSION" ]] && [[ "$CURRENT_VERSION" != "$LAST_SEEN_VERSION" ]]; then
  # CURRENT_VERSION is newer
fi
```

---

## Implementation Checklist

- [ ] Create `.cursor/hooks.json` in main project
- [ ] Create `.cursor/hooks/version-check.sh` script
- [ ] Make script executable (`chmod +x`)
- [ ] Test hook by deploying new version
- [ ] Add version to `check_setup_status` output
- [ ] Add version to test case draft headers
- [ ] Add version to error messages (optional)
- [ ] Document version check in user-setup-guide.md
- [ ] Include hooks.json and hooks/ in build-dist.mjs deployment

---

## Deployment: Including Hooks in Distribution

Update `build-dist.mjs` to copy hooks:

```javascript
// Copy hooks
if (existsSync(join(ROOT, ".cursor", "hooks.json"))) {
  copyFileSync(join(ROOT, ".cursor", "hooks.json"), join(OUT, ".cursor", "hooks.json"));
}
if (existsSync(join(ROOT, ".cursor", "hooks"))) {
  const hooksDir = join(ROOT, ".cursor", "hooks");
  const outHooksDir = join(OUT, ".cursor", "hooks");
  mkdirSync(outHooksDir, { recursive: true });
  cpSync(hooksDir, outHooksDir, { recursive: true });
}
```

---

## Testing the Hook

### Test Scenario 1: First Run
1. Delete flag file: `rm ~/.ado-testforge-mcp/.version-check`
2. Open Cursor workspace with MCP folder
3. **Expected:** See update notification with current version

### Test Scenario 2: Same Version
1. Open Cursor again in same workspace
2. **Expected:** No notification (silent)

### Test Scenario 3: Version Upgrade
1. Bump version in `package.json` to `1.2.0`
2. Redeploy: `npm run deploy`
3. Open Cursor workspace
4. **Expected:** See notification: "Updated to v1.2.0"

### Test Scenario 4: Hook Failure
1. Make script non-executable: `chmod -x .cursor/hooks/version-check.sh`
2. Open Cursor workspace
3. **Expected:** Hook fails, but session continues (fail open by default)

---

## Advantages of Hook-Based Notification

✅ **Automatic** — No user action required
✅ **Proactive** — Users learn about updates immediately
✅ **Non-blocking** — Doesn't interrupt workflow
✅ **One-time** — Shows once per version, not repeatedly
✅ **Workspace-aware** — Only shows when MCP folder is open
✅ **Lightweight** — Simple bash script, fast execution
✅ **Fail-safe** — If hook fails, user session continues normally

---

## Alternative: MCP Server Banner (Future)

If MCP SDK adds banner/notification support in the future, we could:
- Display version in MCP settings UI
- Show update notifications directly in Cursor's UI
- Add "Check for Updates" button in MCP settings

**Current Status:** Not available in MCP SDK v1.26.0

---

## Summary: How Users Know About Versions

| Method | Visibility | Timing | User Action | Status |
|--------|-----------|--------|-------------|--------|
| **Cursor Hook** | High | Automatic (session start) | None | **Recommended** ✅ |
| **check_setup_status** | Medium | On-demand | Run command | Planned |
| **MCP Settings** | Low | Manual check | Open settings | Available now |
| **Test Case Headers** | Medium | When drafting TCs | None | Can add |
| **Changelog.md** | Low | Manual read | Open file | Available now |

**Best Practice:** Implement **Cursor hook + check_setup_status** combination for comprehensive coverage.
