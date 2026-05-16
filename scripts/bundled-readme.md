# VortexADO MCP

Cursor MCP server for Azure DevOps test-case lifecycle: spec → markdown draft → reviewed publish → round-trip update. Configures per workspace; multi-project parallel work supported.

---

## Prerequisites

| Requirement | How to check |
|---|---|
| **Node.js v18 or higher** | Run `node -v`. Install LTS from [nodejs.org](https://nodejs.org/) if missing. |
| **Cursor IDE** | Latest version. |
| **Azure DevOps PAT** | Personal Access Token with `Work Items: Read & Write` and `Test Management: Read & Write` scopes. |

---

## Install

Open a terminal, `cd` into this folder, and run the installer:

```bash
cd <path-to-this-extracted-folder>
bash install.sh
```

The script:
1. Verifies Node 18+ is installed.
2. Extracts the bundled `vortex-ado.tar.gz` into `~/.vortex-ado/`.
3. Runs `npm install` to fetch native dependencies.
4. Registers `vortex-ado` in Cursor's MCP config at `~/.cursor/mcp.json`.

If you already have an older install at `~/.vortex-ado/`, it's wiped and replaced. **Per-workspace configs at `<your-project>/.vortex-ado/config.json` are NOT touched** — they live alongside your projects, not in the install dir.

---

## After install

1. **Restart Cursor IDE.** Cmd+Q then relaunch — closing the window isn't enough; Cursor doesn't auto-restart MCP processes.
2. **Open your project folder in Cursor.**
3. **Configure credentials per workspace** by running this in the AI chat:
   ```
   /vortex-ado/ado-connect
   ```
   The two-tab wizard saves connection details to `<workspace>/.vortex-ado/config.json` and stores your PAT and Confluence API token in the OS keychain (macOS Keychain / Windows Credential Manager / Linux libsecret). Nothing in plaintext on disk.
4. **Verify** with:
   ```
   /vortex-ado/ado-check
   ```
   You should see all components ✅. If anything is missing, the report tells you what step to repeat.

---

## Multi-project setup

Working on more than one ADO project? Open each project in its own Cursor window and run `/vortex-ado/ado-connect` per workspace. Each window's MCP process stays isolated — different orgs, different projects, different credentials, no cross-contamination.

---

## Updating

When you receive a new release zip:
1. Extract it.
2. Run `bash install.sh` from the new folder.
3. The installer detects the existing install at `~/.vortex-ado/` and replaces it.
4. Restart Cursor.

Your per-workspace configs and keychain credentials survive across upgrades.

---

## Uninstall

To remove the MCP from your machine:

```bash
cd <path-to-this-extracted-folder>
bash uninstall.sh
```

The uninstaller asks for confirmation before each step:
1. Removes `~/.vortex-ado/` (the install dir).
2. Removes the `vortex-ado` entry from `~/.cursor/mcp.json` (other MCPs preserved).
3. **Asks** whether to also delete keychain entries (defaults to no — credentials stay unless you opt in).

Per-workspace configs at `<your-project>/.vortex-ado/config.json` are NEVER touched by the uninstaller. Delete them manually if you want.

---

## Troubleshooting

**"Tarball is not a valid gzipped tar archive"**
The bundled `vortex-ado.tar.gz` next to this script is corrupted or incomplete. If you got the zip via Google Drive, redownload and try again — the virus-scan interstitial sometimes truncates downloads.

**"Node.js v18+ required"**
Run `node -v`. If below v18, install the LTS from [nodejs.org](https://nodejs.org/) and retry.

**"npm install failed"**
Run `cd ~/.vortex-ado && npm install` manually to see the error. Most often a `keytar` build failure — ensure Xcode Command Line Tools (macOS) or `build-essential` (Linux) is installed.

**MCP doesn't appear in Cursor after restart**
Open `~/.cursor/mcp.json` and verify a `vortex-ado` entry exists under `mcpServers`. If yes, fully quit Cursor (Cmd+Q) and relaunch — closing the window isn't enough.

**`/ado-connect` says "refusing to write into home directory"**
You opened Cursor without a project folder. Open your actual project folder and re-run `/vortex-ado/ado-connect`.

---

Questions / issues → reach out to the person who shared this with you.
