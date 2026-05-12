import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCredentials, bootstrapCredentials, credentialsFileExists } from "./credentials.ts";
import { AdoClient } from "./ado-client.ts";
import { createConfluenceClient } from "./confluence-client.ts";
import { registerAllTools } from "./tools/index.ts";
import { registerSetupTools } from "./tools/setup.ts";
import { registerAllPrompts } from "./prompts/index.ts";
import { getCurrentVersion } from "./version.ts";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

async function main() {
  // Bootstrap credentials FIRST — must be async because keychain reads are
  // async, and we want subsequent loadCredentials() calls to be sync-cached.
  await bootstrapCredentials();

  // One-time migration warning: if legacy global files exist, tell the
  // user the new layout (without forcing migration). See Commit 6.
  emitLegacyMigrationWarning();

  const credentials = loadCredentials();
  
  // MODIFIED: Don't exit if credentials are missing.
  // Server starts anyway so all tools/prompts are visible.
  // Tools will return error messages if credentials are not configured.
  // With install.sh, credentials.json is created automatically - user just needs to fill it in.
  
  // ORIGINAL CODE (commented out for reference):
  // if (!credentials) {
  //   console.error("No valid credentials found. Run /vortex-ado/install first.");
  //   process.exit(1);
  // }

  // Create clients only if credentials exist
  const adoClient = credentials
    ? new AdoClient(credentials.ado_org, credentials.ado_project, credentials.ado_pat)
    : null;

  const confluenceBaseUrl =
    credentials?.confluence_base_url || process.env.CONFLUENCE_BASE_URL || "";
  const confluenceEmail =
    credentials?.confluence_email || process.env.CONFLUENCE_EMAIL || "";
  const confluenceApiToken =
    credentials?.confluence_api_token || process.env.CONFLUENCE_API_TOKEN || "";
  const confluenceClient =
    confluenceBaseUrl && confluenceEmail && confluenceApiToken
      ? createConfluenceClient(confluenceBaseUrl, confluenceEmail, confluenceApiToken)
      : null;

  const server = new McpServer({
    name: "vortex-ado",
    version: getCurrentVersion(),
  });

  // Note: Tools should handle null adoClient gracefully
  registerAllTools(server, adoClient as any, confluenceClient);
  registerSetupTools(server);
  registerAllPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Emit a one-line migration warning when legacy global credentials/config
 * files are detected. The legacy `conventions.config.json` is no longer
 * read by the server; this warning just nudges users to clean up.
 */
function emitLegacyMigrationWarning(): void {
  const legacyConventions = join(homedir(), ".vortex-ado", "conventions.config.json");
  const wsConfig = join(process.cwd(), ".vortex-ado", "config.json");

  const hasLegacy = existsSync(legacyConventions) || credentialsFileExists();
  const hasWorkspace = existsSync(wsConfig);
  if (hasLegacy && !hasWorkspace) {
    console.error(
      "[VortexADO] Legacy ~/.vortex-ado/ files detected but no workspace " +
        "config found in this folder. Run /vortex-ado/ado-connect to set up. " +
        "Note: ~/.vortex-ado/conventions.config.json is no longer read by " +
        "the server and can be safely deleted.",
    );
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
