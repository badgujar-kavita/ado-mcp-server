# Distributing VortexADO MCP via release zip

Internal-facing reference for how releases are built and distributed while the project lives on a personal GitHub repo + Google Drive (until company-policy alignment is sorted). Tester-facing instructions live inside the release zip itself as `README.md`.

---

## How a release is built

```bash
cd "<repo-root>"
bash scripts/release.sh
```

This runs `npm run build:dist` to compile the MCP, tars the contents of `dist-package/` into `vortex-ado.tar.gz`, and bundles it with three companion files into a single zip:

```
releases/vortex-ado-v<version>-<YYYY-MM-DD>.zip
└── vortex-ado-v<version>-<YYYY-MM-DD>/
    ├── README.md              ← tester-facing prerequisites + install steps
    ├── install.sh             ← runs first-time install + upgrades
    ├── uninstall.sh           ← always asks for confirmation before deleting
    └── vortex-ado.tar.gz      ← the compiled MCP bundle
```

Filename includes the `package.json` version and a date stamp, so multiple releases can sit side-by-side in Drive without naming collisions.

The `releases/` folder is gitignored — binary artifacts don't go in git.

---

## How a release is distributed

1. Run `bash scripts/release.sh` in the repo.
2. Upload `releases/vortex-ado-v<version>-<date>.zip` to your Google Drive release folder.
3. Right-click → "Get link" → set sharing to whoever should see it (specific people, an organization-domain group, etc.).
4. Send the share link to testers.

**Optionally** drop a `CHANGES-<version>.md` in the same Drive folder listing what's changed. Cuts down on "is this the latest?" Slack questions.

---

## What testers do

They download the zip, extract it, and run two scripts. The bundled `README.md` walks them through it; the short version is:

```bash
# After extracting
cd ~/Downloads/vortex-ado-v1.0.0-2026-05-16/
bash install.sh
```

Then restart Cursor and run `/vortex-ado/ado-connect` from inside their project folder.

To uninstall later:

```bash
cd ~/Downloads/vortex-ado-v1.0.0-2026-05-16/
bash uninstall.sh
```

The uninstaller asks for confirmation before each step — the install dir, the Cursor MCP entry, and (optional, defaulting to no) the OS keychain entries.

---

## What the bundled scripts handle

**`install.sh`:**
- Verifies Node 18+ is present.
- Auto-detects `vortex-ado.tar.gz` next to itself (no path arg required, but accepts one if you want to point elsewhere).
- Validates the tarball is a real gzip-tar (catches Drive virus-scan corruption).
- Wipes `~/.vortex-ado/` and re-extracts the tarball there. Per-workspace configs at `<project>/.vortex-ado/config.json` are NOT touched — they live alongside user projects, not in the install dir.
- Runs `npm install` for runtime deps (`keytar`, `jimp`).
- Registers `vortex-ado` in `~/.cursor/mcp.json`, preserving any other MCP entries the user has (jira, sf-devtools, etc.).

**`uninstall.sh`:**
- Asks for top-level confirmation before doing anything.
- Removes `~/.vortex-ado/`.
- Removes only the `vortex-ado` key from `~/.cursor/mcp.json` (other MCPs preserved).
- Asks separately before touching the OS keychain (defaults to no — credentials stay unless the user opts in).
- On macOS, automates the keychain cleanup via `security delete-generic-password`. On Linux/Windows, prints manual instructions (libsecret / Credential Manager don't have a uniform CLI).
- Per-workspace configs at `<project>/.vortex-ado/config.json` are NEVER touched — the script has no way to know where they are.

---

## Source files (in the repo)

These live in `scripts/` and are git-tracked. They're copied into the staged release folder and renamed:

| Source | Renamed to (in zip) |
|---|---|
| `scripts/release.sh` | (not bundled — repo-only) |
| `scripts/bundled-install.sh` | `install.sh` |
| `scripts/bundled-uninstall.sh` | `uninstall.sh` |
| `scripts/bundled-readme.md` | `README.md` |

Edit the `bundled-*` source files in the repo; they get repackaged on every `release.sh` run.

---

## When to switch off Drive

Whenever the project moves to a company-owned GitHub org / GitHub Enterprise, swap the Drive flow for **GitHub Releases**:

1. `gh release create v1.0.0 releases/vortex-ado-v1.0.0-*.zip --title "v1.0.0" --notes-file CHANGES-1.0.0.md`
2. Testers run `gh release download v1.0.0` (or click through the Releases UI).

Same zip, same install flow, just hosted somewhere with versioning, audit trail, and stable URLs. The bundled scripts don't need to change.

For now, keep the Drive flow — it's simple, controlled, and doesn't put anything public.
