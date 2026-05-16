# Install VortexADO MCP from a tarball

Use these steps when you've been given a `.tar.gz` file (typically via Google Drive) instead of installing from GitHub. Same end result as the standard installer; just a different distribution channel.

> **Why a tarball?** While the project lives on a personal GitHub repo, distribution is intentionally kept off public hosting. The tarball is the same compiled bundle the GitHub installer would pull, just delivered through a private channel.

---

## Prerequisites

| Requirement | How to check |
|---|---|
| **Node.js v18 or higher** | `node -v` in a terminal. Install from [nodejs.org](https://nodejs.org/) (LTS) if missing. |
| **Cursor IDE** | Latest version. |
| **An Azure DevOps PAT** | Personal Access Token with `Work Items: Read & Write` and `Test Management: Read & Write` scopes. See [setup-guide.md § Step 1](setup-guide.md#step-1-create-an-azure-devops-personal-access-token-pat) for how to create one. |

---

## Step 1 — Get the tarball

Download `vortex-mcp-ado-vX.Y.Z-YYYY-MM-DD.tar.gz` from the share link you were given.

Save it somewhere you can find it (e.g. `~/Downloads/`).

> **Google Drive note.** If your browser shows a "Google Drive can't scan this file for viruses" warning before download, click **"Download anyway"**. The interstitial trips on files over ~25MB and on `tar.gz` mime types — it's not a real warning about the file.

---

## Step 2 — Run the installer

Open a terminal, then:

```bash
# Replace ~/Downloads/... with the path you saved to.
bash <(curl -fsSL ...)/install-from-tarball.sh ~/Downloads/vortex-mcp-ado-v1.0.0-2026-05-16.tar.gz
```

If you don't have a hosted copy of `install-from-tarball.sh`, the simpler form is:

1. Extract once to get the script:
   ```bash
   mkdir -p /tmp/vortex-tmp && tar -xzf ~/Downloads/vortex-mcp-ado-*.tar.gz -C /tmp/vortex-tmp
   bash /tmp/vortex-tmp/scripts/install-from-tarball.sh ~/Downloads/vortex-mcp-ado-*.tar.gz
   rm -rf /tmp/vortex-tmp
   ```

The installer:
1. Verifies you have Node.js 18+.
2. Extracts the tarball into `~/.vortex-ado/`.
3. Runs `npm install` to fetch native dependencies (`keytar`, `jimp`, etc.).
4. Registers the MCP server in `~/.cursor/mcp.json` under the name `vortex-ado`.

If you already have an older install at `~/.vortex-ado/`, it's wiped and replaced. **Per-workspace configs at `<your-project>/.vortex-ado/config.json` are NOT touched** — they live alongside your project, not in the install dir.

---

## Step 3 — Restart Cursor

Either:

- **Cmd+Q** to fully quit Cursor and relaunch (recommended — Cursor doesn't auto-restart MCP processes), or
- **Cursor → Settings → MCP** → click the refresh icon next to `vortex-ado`.

---

## Step 4 — Configure credentials

1. Open your project folder in Cursor.
2. In the AI chat, run:
   ```
   /vortex-ado/ado-connect
   ```
3. The two-tab wizard opens in your browser. Tab 1 saves your ADO + Confluence connection; Tab 2 collects per-project conventions (test plan mappings, personas, sprint prefix, custom field references).
4. Connection details land in `<workspace>/.vortex-ado/config.json`. Your PAT and Confluence API token go to the OS keychain — never to disk in plaintext.

> **Multi-project tip.** Working on more than one ADO project? Open each project in its own Cursor window and run `/vortex-ado/ado-connect` per workspace. Each window's MCP process stays isolated.

---

## Step 5 — Verify

In the AI chat:

```
/vortex-ado/ado-check
```

You should see a status table with all components ✅. If anything is missing, the report tells you which step to repeat.

---

## Updating to a new tarball

When a new version is shared:

1. Download the new `.tar.gz`.
2. Re-run `install-from-tarball.sh <path-to-new-tarball>` — it detects the existing install at `~/.vortex-ado/` and replaces the runtime files.
3. Restart Cursor.

Your per-workspace configs and keychain credentials are preserved across upgrades.

---

## Uninstalling

```bash
# Remove the install dir.
rm -rf ~/.vortex-ado/

# Remove the MCP entry from Cursor's config.
# (Open ~/.cursor/mcp.json and delete the "vortex-ado" key under mcpServers.)

# Optionally clean up keychain entries (macOS):
security delete-generic-password -s vortex-ado 2>/dev/null || true

# Per-workspace configs — only delete if you're done with the project.
# rm -rf <your-project>/.vortex-ado/
```

---

## Troubleshooting

**"Tarball is not a valid gzipped tar archive"**
The download didn't complete or hit the Google Drive virus-scan interstitial. Open the share link in a browser, click "Download anyway", save the file, and re-run the installer with the local path.

**"Node.js v18+ required"**
Run `node -v`. If below v18, install the LTS from [nodejs.org](https://nodejs.org/) and retry.

**"npm install failed"**
Run `cd ~/.vortex-ado && npm install` manually to see the error. Most often it's a `keytar` build failure — make sure you have Xcode Command Line Tools (macOS) or `build-essential` (Linux).

**MCP doesn't appear in Cursor after restart**
Open `~/.cursor/mcp.json` and verify it contains a `vortex-ado` entry under `mcpServers`. If not, re-run `install-from-tarball.sh`. If yes, fully quit Cursor (Cmd+Q) and relaunch — closing the window isn't enough.

**Wizard says "refusing to write into home directory"**
You opened Cursor without a project folder. Open your actual project folder and re-run `/vortex-ado/ado-connect`.
