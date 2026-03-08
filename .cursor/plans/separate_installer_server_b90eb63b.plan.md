---
name: Separate installer server
overview: "Split the single bootstrap into two MCP server entries: a standalone `setup-mars-ado` installer (always available, zero deps) and the main `mars-ado` server, so the setup command is discoverable independently."
todos:
  - id: update-bootstrap
    content: "Update `bin/bootstrap.mjs`: add --installer flag, rename prompt to `install`, add not-ready mode for mars-ado"
    status: completed
  - id: update-mcp-json
    content: "Update `.cursor/mcp.json` with two server entries: `setup-mars-ado` and `mars-ado`"
    status: completed
  - id: simplify-index
    content: Simplify `src/index.ts` to always run in normal mode (no setup branch)
    status: completed
  - id: clean-prompts
    content: Remove `registerSetupPrompts` from `src/prompts/index.ts`
    status: completed
  - id: update-docs
    content: Update `docs/testing-guide.md` with new command names
    status: completed
  - id: commit
    content: Commit all changes
    status: completed
isProject: false
---

# Separate `setup-mars-ado` Installer Server

## Current State

Single MCP server entry (`mars-ado`) handles both installer and full server modes via `bin/bootstrap.mjs`. The setup command appears as `mars-ado / setup`.

## Target State

Two MCP server entries:

- `**setup-mars-ado**` -- Always-available installer (`/setup-mars-ado / install`). Zero npm dependencies. Handles `npm install` + credentials template.
- `**mars-ado**` -- Full ADO server. If not ready, shows a helpful message pointing to `setup-mars-ado`.

In Cursor's chat, a new team member types `/setup-mars-ado` and sees the install command immediately.

## Changes

### [.cursor/mcp.json](.cursor/mcp.json)

Two server entries, both pointing to `bin/bootstrap.mjs` with different flags:

```json
{
  "mcpServers": {
    "setup-mars-ado": {
      "command": "node",
      "args": ["bin/bootstrap.mjs", "--installer"]
    },
    "mars-ado": {
      "command": "node",
      "args": ["bin/bootstrap.mjs"]
    }
  }
}
```

### [bin/bootstrap.mjs](bin/bootstrap.mjs)

Add `--installer` flag handling:

- **With `--installer`**: Always run the zero-dep installer MCP server (exposes `install` tool + `install` prompt)
- **Without flag**: If ready, proxy to full server (`npx tsx src/index.ts`). If NOT ready, run a minimal MCP server that only exposes a `check_setup_status` tool returning a message like "Run /setup-mars-ado/install first".

Rename the installer's prompt from `setup` to `install` so it appears as `setup-mars-ado / install`.

### [src/prompts/index.ts](src/prompts/index.ts)

- Remove `registerSetupPrompts` (setup prompts are now only in the bootstrap installer)
- Keep `registerAllPrompts` with all ADO prompts + the `check_status` prompt

### [src/index.ts](src/index.ts)

- Remove setup-mode branch (the bootstrap handles that now)
- Always assume credentials are available (bootstrap won't launch the full server otherwise)
- Keep `registerSetupTools` for the `check_setup_status` tool (useful even when running)

### [docs/testing-guide.md](docs/testing-guide.md)

- Update command references from `mars-ado / setup` to `setup-mars-ado / install`

