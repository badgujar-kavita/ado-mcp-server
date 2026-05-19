import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.ts";
import { registerSetupTools } from "./tools/setup.ts";
import { registerAllPrompts } from "./prompts/index.ts";
import { getCurrentVersion } from "./version.ts";
import { instrumentServerWithCallContext } from "./workspace/instrument-server.ts";
import { createAdoClientProxy } from "./workspace/ado-client-proxy.ts";

async function main() {
  // No boot-time credential resolution. Cursor launches MCPs with `cwd`
  // set to $HOME (for global servers in ~/.cursor/mcp.json), so trying to
  // load credentials from `process.cwd()/.vortex-ado/config.json` at boot
  // would always miss the user's open workspace. Instead, every tool
  // handler resolves credentials per-call from the active CallContext —
  // populated from the MCP `roots/list` protocol (which runs over a live
  // client connection, after boot) and any `workspaceRoot` arg the agent
  // passed.
  //
  // See `src/workspace/{call-context,ado-client-proxy,confluence-client-proxy,instrument-server}.ts`
  // for the per-call machinery.
  const adoClient = createAdoClientProxy();

  const server = new McpServer({
    name: "vortex-ado",
    version: getCurrentVersion(),
  });

  // Wrap server.registerTool so every handler runs inside a CallContext
  // scope AND pre-warms the AdoClient proxy's per-context cache before
  // the handler body runs. Must be called BEFORE any tool registration
  // so the wrapper catches every handler, including setup tools.
  instrumentServerWithCallContext(server);

  // Confluence is also resolved per-call (see confluence-client-proxy.ts).
  // We pass `null` here as the boot fallback — there is no boot client.
  // Tools that need Confluence call `resolveConfluenceClientForActiveCall(null)`.
  registerAllTools(server, adoClient, null);
  registerSetupTools(server);
  registerAllPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
