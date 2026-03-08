# ADO TestForge MCP — Distribution Guide for Google Drive

This guide explains what to share on Google Drive so team members can install and use the MCP. **Option B hides your source code.**

---

## ⚠️ Deploy After Any Changes (Required)

**One-way flow only:** Changes flow Main Project (ADO TestForge MCP) → Deployment folder. Never the reverse. The deployment folder (e.g. Center of Excellence (CoE)/MCP Servers) is read-only; users must make changes in the main project.

**After making ANY changes to commands, tools, or enhancements**, run from the main project:

```bash
npm run deploy
```

This builds and copies the updated distribution to the Google Drive folder. **Do not skip this step.**

Configure the deploy path: create `.deploy-path` with the target folder path (see `.deploy-path.example`), or set `GDRIVE_DEPLOY_PATH` env var.

---

## Option A: Share Minimal Files (Code Visible)

If you're okay with users having access to the source, share only these:

| Folder/File | Required? | Why |
|-------------|-----------|-----|
| `bin/` | **Yes** | Bootstrap script (installer + launcher) |
| `src/` | **Yes** | Server code (runs via `npx tsx`) |
| `package.json` | **Yes** | Dependencies |
| `package-lock.json` | **Yes** | Locked versions for reproducible installs |
| `.cursor/mcp.json` | **Yes** | Defines ado-testforge MCP entry for the install flow |
| `docs/setup-guide.md` | **Yes** | User instructions |
| `conventions.config.json` | **Yes** | Test case naming conventions |

**Exclude from share:** `node_modules/`, `.env`, `.git/`, `tc-drafts/`, `.cursor/plans/`

---

## Option B: Distribution Without Source Code (Recommended)

Share a pre-built package so users never see your code.

### Step 1: Build the distribution package

From the ADO TestForge MCP folder, run:

```bash
npm run build:dist
```

This creates a `dist-package/` folder containing:
- `bin/` — bootstrap script
- `dist/` — compiled JavaScript (no `src/`, no TypeScript)
- `package.json` — no dependencies (bundle is self-contained)
- `.cursor/mcp.json`
- `docs/setup-guide.md`
- `conventions.config.json`

### Step 2: Share `dist-package/` on Google Drive

Upload the entire `dist-package/` folder. Users:
1. Download/sync the folder
2. Add it to Cursor workspace
3. Run `/ado-testforge/install` (no `npm install` needed)
4. Configure credentials at `~/.ado-testforge-mcp/credentials.json`

**No `src/` folder = no source code exposed.**

---

## What Users Need

Regardless of Option A or B, users need:

| Requirement | Notes |
|-------------|-------|
| **Node.js v18+** | Installer checks this |
| **Cursor IDE** | Latest version |
| **ADO PAT** | They create their own (never share yours) |
| **Internet** | For `npm install` |

Credentials are stored in each user's home directory (`~/.ado-testforge-mcp/credentials.json`) — never in the shared folder.

---

## Folder Structure for Google Drive

```
ADO TestForge MCP/      ← Share this folder
├── bin/
│   └── bootstrap.mjs
├── src/               ← Omit in Option B (use dist/ instead)
├── dist/              ← Only in Option B
├── package.json
├── package-lock.json
├── .cursor/
│   └── mcp.json
├── docs/
│   └── setup-guide.md
├── conventions.config.json
└── (no .env, no node_modules, no .git if desired)
```

---

## Security Notes

- **Never share** `.env` or `~/.ado-testforge-mcp/credentials.json` — they contain PATs
- Each user creates their own ADO PAT with their account
- The shared folder contains no secrets; credentials are local to each machine
