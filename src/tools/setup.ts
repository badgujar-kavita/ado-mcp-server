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
    "Create the credentials template file at ~/.ado-testforge-mcp/credentials.json. The user then edits it privately -- PAT is never passed through chat.",
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
    "Check if the ADO TestForge MCP server is fully configured and ready to use",
    {},
    async () => {
      const lines: string[] = [];

      lines.push("Welcome to ADO TestForge MCP");
      lines.push("============================");
      lines.push("");
      lines.push(
        "ADO TestForge MCP connects your Cursor IDE directly to Azure DevOps, " +
        "giving you AI-assisted test case management without leaving your editor. " +
        "It reads User Stories, fetches Solution Design context from Confluence, " +
        "and helps you draft, review, and push test cases — all through natural-language commands."
      );
      lines.push("");

      lines.push("What You Can Do");
      lines.push("---------------");
      lines.push("• User Story Context — Fetch US with acceptance criteria + auto-linked Solution Design from Confluence");
      lines.push("• Test Suite Management — Auto-build suite folder hierarchy from just a User Story ID");
      lines.push("• Test Case Drafting — Draft test cases in markdown, review, then push approved drafts to ADO");
      lines.push("• Test Case CRUD — Create, read, update, and delete test cases with convention-driven formatting");
      lines.push("• Clone & Enhance — Clone test cases across User Stories with context-aware adaptation");
      lines.push("• Configuration-Driven — All naming patterns, formats, and defaults live in conventions.config.json");
      lines.push("");

      lines.push("Setup Status");
      lines.push("------------");

      let allGood = true;

      if (credentialsFileExists()) {
        lines.push("Credentials file: EXISTS");
      } else {
        lines.push("Credentials file: MISSING — run setup_credentials first");
        allGood = false;
      }

      const creds = loadCredentials();
      if (creds) {
        lines.push("ADO PAT: Configured");
        lines.push(`ADO Org: ${creds.ado_org}`);
        lines.push(`ADO Project: ${creds.ado_project}`);
        const confluenceUrl =
          creds.confluence_base_url || process.env.CONFLUENCE_BASE_URL;
        if (confluenceUrl) {
          lines.push(`Confluence: Configured (${confluenceUrl})`);
        } else {
          lines.push("Confluence: Not configured (optional)");
        }
        const tcPath = getTcDraftsDir();
        lines.push(`TC Drafts: ${tcPath ?? "Use workspace (open folder) or set TC_DRAFTS_PATH"}`);
      } else if (credentialsFileExists()) {
        lines.push("Credentials: File exists but contains placeholder values — please edit it");
        allGood = false;
      } else {
        lines.push("Credentials: Not configured");
        allGood = false;
      }

      if (allGood) {
        lines.push("");
        lines.push("Status: READY — all tools and commands are available.");
        lines.push("");
        lines.push("Quick Start: Type /ado-testforge in the AI chat to see available commands.");
      } else {
        lines.push("");
        lines.push("Status: SETUP REQUIRED — run /ado-testforge/install to get started.");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
