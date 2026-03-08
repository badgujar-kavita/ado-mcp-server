import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createCredentialsTemplate,
  getCredentialsPath,
  getTcDraftsDir,
  loadCredentials,
  credentialsFileExists,
} from "../credentials.ts";

export function registerSetupTools(server: McpServer) {
  server.tool(
    "setup_credentials",
    "Create the credentials template file at ~/.mars-ado-mcp/credentials.json. The user then edits it privately -- PAT is never passed through chat.",
    {},
    async () => {
      const credPath = createCredentialsTemplate();
      const alreadyValid = loadCredentials() !== null;

      if (alreadyValid) {
        return {
          content: [{
            type: "text" as const,
            text: `Credentials are already configured at: ${credPath}\n\nTo update them, edit the file directly.`,
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: [
            `Credentials template created at: ${credPath}`,
            "",
            "Open this file and fill in your values:",
            "  - ado_pat: Your Azure DevOps Personal Access Token",
            "  - ado_org: Your ADO organization name (from https://dev.azure.com/{org})",
            "  - ado_project: Your ADO project name",
            "",
            "Confluence fields are optional -- leave empty if not needed.",
            "",
            "After saving the file, restart the MCP server in Cursor Settings > MCP.",
          ].join("\n"),
        }],
      };
    }
  );

  server.tool(
    "check_setup_status",
    "Check if the MARS ADO MCP server is fully configured and ready to use",
    {},
    async () => {
      const checks: string[] = [];
      let allGood = true;

      if (credentialsFileExists()) {
        checks.push("Credentials file: EXISTS");
      } else {
        checks.push("Credentials file: MISSING -- run setup_credentials first");
        allGood = false;
      }

      const creds = loadCredentials();
      if (creds) {
        checks.push("ADO PAT: Configured");
        checks.push(`ADO Org: ${creds.ado_org}`);
        checks.push(`ADO Project: ${creds.ado_project}`);
        const confluenceUrl =
          creds.confluence_base_url || process.env.CONFLUENCE_BASE_URL;
        if (confluenceUrl) {
          checks.push(`Confluence: Configured (${confluenceUrl})`);
        } else {
          checks.push("Confluence: Not configured (optional)");
        }
        const tcPath = getTcDraftsDir();
        checks.push(`TC Drafts: ${tcPath ?? "Use workspace (open folder) or set TC_DRAFTS_PATH"}`);
      } else if (credentialsFileExists()) {
        checks.push("Credentials: File exists but contains placeholder values -- please edit it");
        allGood = false;
      } else {
        checks.push("Credentials: Not configured");
        allGood = false;
      }

      if (allGood) {
        checks.push("");
        checks.push("Status: READY -- all tools and commands are available.");
      } else {
        checks.push("");
        checks.push("Status: SETUP REQUIRED -- run /mars-ado/setup to get started.");
      }

      return {
        content: [{ type: "text" as const, text: checks.join("\n") }],
      };
    }
  );
}
