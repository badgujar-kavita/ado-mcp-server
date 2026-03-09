# Setup ADO TestForge MCP

Install the ADO TestForge MCP server globally so it works in all workspaces.

## Instructions

Run the following command in the terminal to install:

```bash
node install-ado-testforge.mjs
```

This will:
1. Check prerequisites (Node.js v18+, folder structure)
2. Register `ado-testforge` globally in `~/.cursor/mcp.json`
3. Create credentials template at `~/.ado-testforge-mcp/credentials.json`

## After Installation

1. **Restart Cursor** to load the MCP server
2. Fill in your credentials at `~/.ado-testforge-mcp/credentials.json`:
   - `ado_pat`: Your Azure DevOps Personal Access Token
   - `ado_org`: Your organization name (e.g., YourOrgName)
   - `ado_project`: Your project name

After restart, `ado-testforge` will be available in all workspaces with commands like `/ado-testforge/get_user_story`, `/ado-testforge/draft_test_cases`, etc.
