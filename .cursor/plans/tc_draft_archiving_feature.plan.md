---
name: TC Draft Archiving Feature
overview: Add archiving functionality for test case draft folders with manual archive command and configurable time-based archiving. Supports restore, listing, and cleanup of archived drafts.
todos:
  - id: create-archive-tool
    content: Create archive_tc_draft tool for manual archiving of specific US folders
    status: pending
  - id: create-auto-archive-tool
    content: Create archive_old_drafts tool for time-based archiving with configurable days
    status: pending
  - id: create-list-archived-tool
    content: Create list_archived_drafts tool to browse archived drafts
    status: pending
  - id: create-restore-tool
    content: Create restore_tc_draft tool to restore archived drafts back to active
    status: pending
  - id: add-config-option
    content: Add archive_after_days config option to credentials.json (default 30)
    status: pending
  - id: update-skill
    content: Update test-case-asset-manager skill with archiving section
    status: pending
  - id: update-docs
    content: Update implementation.md and testing-guide.md with archiving tools
    status: pending
  - id: deploy
    content: Rebuild distribution bundle via npm run build:dist (Vercel tarball distribution handles delivery)
    status: pending
isProject: false
---

# TC Draft Archiving Feature Plan

## Overview

Add archiving functionality for test case draft folders to manage long-term maintenance of the `tc-drafts/` directory. Supports:
- **Manual archiving** via command
- **Time-based archiving** with configurable threshold (default 30 days)
- **Restore** capability to bring drafts back to active state
- **Listing** of archived drafts with metadata

---

## Folder Structure Recommendation

### Recommended: Date-Organized Archive (YYYY-MM)

```
tc-drafts/
├── US_1399001/                    ← Active draft
├── US_1399045/                    ← Active draft
├── US_1400123/                    ← Active draft
└── _archived/
    ├── 2026-03/
    │   ├── US_1350001/            ← Archived March 2026
    │   └── US_1355012/
    ├── 2026-04/
    │   ├── US_1380001/            ← Archived April 2026
    │   └── US_1385034/
    └── _archive_index.json        ← Metadata index (optional)
```

### Why This Structure?

| Aspect | Benefit |
|--------|---------|
| **YYYY-MM grouping** | Easy to find drafts by time period; natural chronological browsing |
| **Single `_archived/` folder** | Clear separation from active drafts; `_` prefix sorts it to top/bottom |
| **Month-level granularity** | Not too granular (daily) or too coarse (yearly); easy bulk cleanup |
| **Flat within month** | No deep nesting; all US folders directly under month |
| **Index file** | Optional metadata for quick lookups without scanning folders |

### Alternative Considered: Flat Archive

```
tc-drafts/
├── US_1399001/
└── _archived/
    ├── US_1350001/
    ├── US_1355012/
    └── US_1380001/
```

**Rejected because:**
- Hard to identify when drafts were archived
- Difficult to bulk cleanup by age
- No chronological organization

---

## Archive Metadata

Each archived folder gets a `.archive_meta.json` file:

```json
{
  "userStoryId": 1350001,
  "userStoryTitle": "Product Category Access Control",
  "archivedAt": "2026-04-27T10:30:00Z",
  "archivedBy": "kavita.badgujar",
  "archiveReason": "manual",
  "originalPath": "tc-drafts/US_1350001",
  "pushedToAdo": true,
  "adoTestCaseIds": [1350101, 1350102, 1350103],
  "fileCount": 3,
  "files": [
    "US_1350001_test_cases.md",
    "US_1350001_solution_design_summary.md",
    "US_1350001_qa_cheat_sheet.md"
  ]
}
```

### Optional: Archive Index

`_archived/_archive_index.json` for quick lookups:

```json
{
  "version": 1,
  "lastUpdated": "2026-04-27T10:30:00Z",
  "archives": [
    {
      "userStoryId": 1350001,
      "folder": "2026-03/US_1350001",
      "archivedAt": "2026-03-15T10:30:00Z",
      "pushedToAdo": true
    },
    {
      "userStoryId": 1380001,
      "folder": "2026-04/US_1380001",
      "archivedAt": "2026-04-27T10:30:00Z",
      "pushedToAdo": false
    }
  ]
}
```

---

## Configuration

### New Config Option in credentials.json

```json
{
  "ado_pat": "...",
  "ado_org": "...",
  "ado_project": "...",
  "tc_drafts_path": "...",
  "archive_after_days": 30
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `archive_after_days` | number | 30 | Drafts older than this are candidates for time-based archiving |

### User Can Modify Later

Users can change `archive_after_days` in their `~/.ado-testforge-mcp/credentials.json`:
- Set to `15` for aggressive archiving
- Set to `60` or `90` for longer retention
- Set to `0` or `null` to disable time-based archiving (manual only)

---

## Tools Specification

### Tool 1: `archive_tc_draft`

**Purpose:** Manually archive a specific User Story draft folder.

**Schema:**
```typescript
{
  name: "archive_tc_draft",
  description: "Archive a test case draft folder to _archived/. Use after pushing to ADO or when draft is no longer needed in active workspace.",
  inputSchema: {
    type: "object",
    properties: {
      userStoryId: {
        type: "number",
        description: "User Story ID to archive (e.g., 1399001)"
      },
      workspaceRoot: {
        type: "string",
        description: "Workspace root path (where tc-drafts/ lives)"
      },
      draftsPath: {
        type: "string",
        description: "Alternative: explicit tc-drafts path"
      },
      reason: {
        type: "string",
        description: "Optional reason for archiving",
        enum: ["manual", "pushed_to_ado", "obsolete", "superseded"]
      }
    },
    required: ["userStoryId"]
  }
}
```

**Behavior:**
1. Locate `tc-drafts/US_<ID>/` folder
2. Create `_archived/YYYY-MM/` if not exists (using current date)
3. Move entire US folder to archive location
4. Create `.archive_meta.json` inside archived folder
5. Update `_archive_index.json` (if exists)
6. Return success with archive path

**Output:**
```
Archived US_1399001 to tc-drafts/_archived/2026-04/US_1399001/

Files archived:
- US_1399001_test_cases.md
- US_1399001_solution_design_summary.md
- US_1399001_qa_cheat_sheet.md

Metadata saved to .archive_meta.json
```

---

### Tool 2: `archive_old_drafts`

**Purpose:** Archive all drafts older than specified days (time-based bulk archive).

**Schema:**
```typescript
{
  name: "archive_old_drafts",
  description: "Archive all test case drafts older than specified days. Uses archive_after_days from config if not specified.",
  inputSchema: {
    type: "object",
    properties: {
      olderThanDays: {
        type: "number",
        description: "Archive drafts older than this many days. Defaults to archive_after_days from config (30)."
      },
      workspaceRoot: {
        type: "string",
        description: "Workspace root path"
      },
      draftsPath: {
        type: "string",
        description: "Alternative: explicit tc-drafts path"
      },
      dryRun: {
        type: "boolean",
        description: "If true, show what would be archived without actually archiving"
      },
      excludePushed: {
        type: "boolean",
        description: "If true, skip drafts that have been pushed to ADO (status = APPROVED)"
      }
    }
  }
}
```

**Behavior:**
1. Read `archive_after_days` from config (or use `olderThanDays` param)
2. Scan all `tc-drafts/US_*/` folders
3. Check modification date of main test cases file
4. For each folder older than threshold:
   - If `dryRun`: add to preview list
   - Else: archive using same logic as `archive_tc_draft`
5. Return summary

**Output (dry run):**
```
Dry run: Would archive 5 drafts older than 30 days:

| US ID    | Last Modified | Age (days) | Status   |
|----------|---------------|------------|----------|
| 1350001  | 2026-03-15    | 43         | APPROVED |
| 1355012  | 2026-03-20    | 38         | Draft    |
| 1360045  | 2026-03-25    | 33         | APPROVED |
| 1365078  | 2026-03-27    | 31         | Draft    |
| 1370099  | 2026-03-28    | 30         | APPROVED |

Run without dryRun: true to archive these drafts.
```

**Output (actual):**
```
Archived 5 drafts older than 30 days:

✓ US_1350001 → _archived/2026-04/US_1350001/
✓ US_1355012 → _archived/2026-04/US_1355012/
✓ US_1360045 → _archived/2026-04/US_1360045/
✓ US_1365078 → _archived/2026-04/US_1365078/
✓ US_1370099 → _archived/2026-04/US_1370099/

Total: 5 drafts archived, 15 files moved.
```

---

### Tool 3: `list_archived_drafts`

**Purpose:** List archived drafts with filtering options.

**Schema:**
```typescript
{
  name: "list_archived_drafts",
  description: "List archived test case drafts with optional filtering by date range or User Story ID.",
  inputSchema: {
    type: "object",
    properties: {
      workspaceRoot: {
        type: "string",
        description: "Workspace root path"
      },
      draftsPath: {
        type: "string",
        description: "Alternative: explicit tc-drafts path"
      },
      userStoryId: {
        type: "number",
        description: "Filter by specific User Story ID"
      },
      archivedAfter: {
        type: "string",
        description: "Filter: archived after this date (YYYY-MM-DD)"
      },
      archivedBefore: {
        type: "string",
        description: "Filter: archived before this date (YYYY-MM-DD)"
      },
      limit: {
        type: "number",
        description: "Max results to return (default 20)"
      }
    }
  }
}
```

**Output:**
```
Archived Drafts (20 most recent):

| US ID    | Title                          | Archived     | Pushed | Files |
|----------|--------------------------------|--------------|--------|-------|
| 1380001  | Customer Manager Access        | 2026-04-27   | Yes    | 3     |
| 1375034  | Tactic Fund Validation         | 2026-04-20   | Yes    | 3     |
| 1370099  | Promotion Status Workflow      | 2026-04-15   | No     | 2     |
| 1365078  | LOA Template Configuration     | 2026-04-10   | Yes    | 3     |
| ...      | ...                            | ...          | ...    | ...   |

Total: 45 archived drafts across 6 months.
Location: tc-drafts/_archived/
```

---

### Tool 4: `restore_tc_draft`

**Purpose:** Restore an archived draft back to active state.

**Schema:**
```typescript
{
  name: "restore_tc_draft",
  description: "Restore an archived test case draft back to the active tc-drafts/ folder.",
  inputSchema: {
    type: "object",
    properties: {
      userStoryId: {
        type: "number",
        description: "User Story ID to restore"
      },
      workspaceRoot: {
        type: "string",
        description: "Workspace root path"
      },
      draftsPath: {
        type: "string",
        description: "Alternative: explicit tc-drafts path"
      },
      overwrite: {
        type: "boolean",
        description: "If true, overwrite if active folder exists. Default false (error if exists)."
      }
    },
    required: ["userStoryId"]
  }
}
```

**Behavior:**
1. Find archived folder in `_archived/*/US_<ID>/`
2. Check if active folder already exists
   - If exists and `overwrite: false`: error
   - If exists and `overwrite: true`: backup existing to `_archived/` first
3. Move folder from archive to `tc-drafts/US_<ID>/`
4. Remove `.archive_meta.json` from restored folder
5. Update `_archive_index.json`
6. Return success

**Output:**
```
Restored US_1380001 from archive:

Source: tc-drafts/_archived/2026-04/US_1380001/
Target: tc-drafts/US_1380001/

Files restored:
- US_1380001_test_cases.md
- US_1380001_solution_design_summary.md
- US_1380001_qa_cheat_sheet.md

Draft is now active. Previous archive metadata removed.
```

---

## Implementation Details

### File: `src/tools/tc-archive.ts`

```typescript
// New file for archiving tools

import { z } from "zod";
import { existsSync, readdirSync, statSync, mkdirSync, renameSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join, basename } from "path";
import { loadCredentials } from "../credentials.ts";

// Helper: Get archive month folder name
function getArchiveMonthFolder(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// Helper: Get folder age in days
function getFolderAgeDays(folderPath: string): number {
  const testCasesFile = readdirSync(folderPath).find(f => f.endsWith("_test_cases.md"));
  if (!testCasesFile) return 0;
  const stat = statSync(join(folderPath, testCasesFile));
  const ageMs = Date.now() - stat.mtimeMs;
  return Math.floor(ageMs / (1000 * 60 * 60 * 24));
}

// Helper: Create archive metadata
interface ArchiveMeta {
  userStoryId: number;
  userStoryTitle: string | null;
  archivedAt: string;
  archivedBy: string;
  archiveReason: string;
  originalPath: string;
  fileCount: number;
  files: string[];
}

// ... tool implementations
```

### Integration with Existing Tools

**`push_tc_draft_to_ado`** - Add optional auto-archive:
```typescript
// After successful push, optionally archive
if (input.archiveAfterPush) {
  // Call archive_tc_draft internally
}
```

**`list_tc_drafts`** - Add archive indicator:
```typescript
// Show if draft is archivable (older than threshold)
// Show "[old]" marker for drafts beyond archive_after_days
```

---

## User Workflow Examples

### 1. Manual Archive After Push

```
User: Push US 1399001 to ADO
AI: [pushes successfully]

User: Archive US 1399001
AI: [calls archive_tc_draft]

Output:
Archived US_1399001 to tc-drafts/_archived/2026-04/US_1399001/
```

### 2. Time-Based Cleanup

```
User: Archive old drafts

AI: [calls archive_old_drafts with dryRun: true first]

Output:
Dry run: Would archive 5 drafts older than 30 days:
| US ID   | Age | Status   |
|---------|-----|----------|
| 1350001 | 43  | APPROVED |
| 1355012 | 38  | Draft    |
...

User: Yes, archive them

AI: [calls archive_old_drafts with dryRun: false]

Output:
Archived 5 drafts older than 30 days.
```

### 3. Find and Restore Old Draft

```
User: Find archived draft for US 1350001

AI: [calls list_archived_drafts with userStoryId: 1350001]

Output:
Found: US_1350001 archived on 2026-03-15
Location: tc-drafts/_archived/2026-03/US_1350001/
Files: 3 (test_cases.md, solution_design_summary.md, qa_cheat_sheet.md)

User: Restore it

AI: [calls restore_tc_draft]

Output:
Restored US_1350001 to tc-drafts/US_1350001/
```

### 4. Configure Archive Threshold

```
User: I want to keep drafts longer, change to 60 days

AI: Update your credentials file at ~/.ado-testforge-mcp/credentials.json:

{
  ...
  "archive_after_days": 60
}

The archive_old_drafts tool will now use 60 days as the default threshold.
```

---

## Prompt Integration

### Update `/ado-testforge/draft_test_cases` prompt

Add to step after successful push:
```
After push: "Test cases pushed successfully. Would you like to archive the draft folder? (keeps workspace clean, draft remains in _archived/ for reference)"
```

### Add `/ado-testforge/archive_drafts` prompt

```typescript
{
  name: "archive_drafts",
  description: "Archive old test case drafts to keep workspace clean",
  messages: [{
    role: "user",
    content: `Archive old test case drafts.

1. First, run archive_old_drafts with dryRun: true to show what would be archived
2. Wait for my confirmation before actually archiving
3. Use the default archive_after_days from config (or ask if I want different threshold)
4. Show summary of archived drafts when done`
  }]
}
```

---

## Skill Update

### Add to `test-case-asset-manager/SKILL.md`

```markdown
---

## Archiving Drafts

### When to Archive

- After pushing test cases to ADO (draft is now in ADO, local copy is backup)
- When draft is obsolete or superseded by newer version
- During periodic cleanup of old drafts

### Archive Location

Archived drafts go to `tc-drafts/_archived/YYYY-MM/`:

```
tc-drafts/
├── US_1399001/          ← Active
└── _archived/
    ├── 2026-03/
    │   └── US_1350001/  ← Archived March 2026
    └── 2026-04/
        └── US_1380001/  ← Archived April 2026
```

### Archive Commands

| Command | Purpose |
|---------|---------|
| `archive_tc_draft` | Manually archive specific US folder |
| `archive_old_drafts` | Archive all drafts older than N days |
| `list_archived_drafts` | Browse archived drafts |
| `restore_tc_draft` | Restore archived draft to active |

### Configuration

Set `archive_after_days` in credentials.json:

```json
{
  "archive_after_days": 30
}
```

- Default: 30 days
- Set to 15 for aggressive cleanup
- Set to 60 or 90 for longer retention
- Set to 0 or null to disable time-based archiving

### Archive Metadata

Each archived folder contains `.archive_meta.json` with:
- When archived
- Why archived (manual, pushed_to_ado, etc.)
- Original location
- List of files

---
```

---

## Documentation Updates

### `docs/implementation.md` - Add Tools Section

```markdown
### Archiving Tools

| Tool | Description |
|------|-------------|
| `archive_tc_draft` | Manually archive a specific US draft folder |
| `archive_old_drafts` | Archive drafts older than N days (default from config) |
| `list_archived_drafts` | List archived drafts with filtering |
| `restore_tc_draft` | Restore archived draft to active state |

**Archive location:** `tc-drafts/_archived/YYYY-MM/US_<ID>/`

**Configuration:** Set `archive_after_days` in credentials.json (default 30).
```

### `docs/testing-guide.md` - Add Quick Reference

```markdown
### Archive Commands

| Task | Tool | Example |
|------|------|---------|
| Archive specific US | `archive_tc_draft` | Archive US 1399001 |
| Cleanup old drafts | `archive_old_drafts` | Archive drafts older than 30 days |
| Find old draft | `list_archived_drafts` | Find archived US 1350001 |
| Restore from archive | `restore_tc_draft` | Restore US 1350001 |
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Accidental archive | `archive_old_drafts` always does dry run first by default in prompts |
| Lost data | Archive, don't delete; restore tool available |
| Confusion about location | Clear output messages show archive path |
| Breaking existing workflows | All new tools; existing tools unchanged |
| Performance with many archives | Index file for quick lookups; month-based organization |

---

## Implementation Order

1. **Create `src/tools/tc-archive.ts`** with all four tools
2. **Update `src/index.ts`** to register new tools
3. **Add config option** to credentials schema
4. **Update skill** with archiving section
5. **Update docs** (implementation.md, testing-guide.md)
6. **Add prompt** for archive_drafts
7. **Test** all four tools manually
8. **Rebuild distribution bundle** via `npm run build:dist` (Vercel tarball distribution handles delivery; see docs/distribution-guide.md)

---

## Success Criteria

- [ ] `archive_tc_draft` moves US folder to `_archived/YYYY-MM/`
- [ ] `archive_old_drafts` finds and archives drafts older than configured days
- [ ] `archive_old_drafts --dryRun` shows preview without archiving
- [ ] `list_archived_drafts` shows all archived drafts with metadata
- [ ] `restore_tc_draft` moves draft back to active location
- [ ] Archive metadata is created and preserved
- [ ] `archive_after_days` config is respected
- [ ] Prompts guide user through archive workflow
- [ ] Documentation updated

---

## Future Enhancements (Out of Scope)

- **Auto-archive on push** — Option to automatically archive after successful ADO push
- **Bulk delete old archives** — Delete archives older than X months
- **Archive compression** — Zip old archive months to save space
- **Cloud backup** — Sync archives to cloud storage
- **Archive search** — Full-text search within archived drafts
