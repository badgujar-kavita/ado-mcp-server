#!/usr/bin/env node

/**
 * ADO TestForge Setup MCP Server
 * 
 * Lightweight MCP server that exposes /setup-ado-testforge/install command.
 * Place this at the CoE folder level so users can run the install command
 * by just adding the CoE folder to their workspace.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { createInterface } from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths - relative to this script's location
const MCP_SERVERS_DIR = join(__dirname, "MCP Servers");
const BOOTSTRAP_PATH = join(MCP_SERVERS_DIR, "bin", "bootstrap.mjs");
const DIST_PATH = join(MCP_SERVERS_DIR, "dist", "index.js");

const CREDENTIALS_DIR = join(homedir(), ".ado-testforge-mcp");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");
const OLD_CREDENTIALS_FILE = join(homedir(), ".mars-ado-mcp", "credentials.json");
const CURSOR_MCP_CONFIG = join(homedir(), ".cursor", "mcp.json");

// ── JSON-RPC helpers ──

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function makeResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function makeError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// ── Prerequisite checks ──

function checkNodeVersion() {
  const match = process.version.match(/^v(\d+)/);
  const major = match ? parseInt(match[1], 10) : 0;
  return { ok: major >= 18, version: process.version, major };
}

function checkGoogleDrive() {
  const pathLower = __dirname.toLowerCase();
  const hasGoogleDrive =
    pathLower.includes("cloudstorage/googledrive") ||
    pathLower.includes("google drive") ||
    pathLower.includes("googledrive");
  return { ok: hasGoogleDrive, path: __dirname };
}

function checkFolderStructure() {
  return {
    hasMcpServers: existsSync(MCP_SERVERS_DIR),
    hasBootstrap: existsSync(BOOTSTRAP_PATH),
    hasDist: existsSync(DIST_PATH),
  };
}

// ── Installation functions ──

function registerGlobally() {
  const cursorDir = join(homedir(), ".cursor");
  if (!existsSync(cursorDir)) {
    mkdirSync(cursorDir, { recursive: true });
  }

  let config = { mcpServers: {} };
  if (existsSync(CURSOR_MCP_CONFIG)) {
    try {
      config = JSON.parse(readFileSync(CURSOR_MCP_CONFIG, "utf-8"));
      if (!config.mcpServers) config.mcpServers = {};
    } catch {
      config = { mcpServers: {} };
    }
  }

  config.mcpServers["ado-testforge"] = {
    command: "node",
    args: [BOOTSTRAP_PATH],
  };

  writeFileSync(CURSOR_MCP_CONFIG, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return CURSOR_MCP_CONFIG;
}

function setupCredentials() {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }

  let migrated = false;

  // Migrate from old path if exists
  if (!existsSync(CREDENTIALS_FILE) && existsSync(OLD_CREDENTIALS_FILE)) {
    try {
      const oldCreds = readFileSync(OLD_CREDENTIALS_FILE, "utf-8");
      writeFileSync(CREDENTIALS_FILE, oldCreds, "utf-8");
      migrated = true;
    } catch {
      // Fall through to create template
    }
  }

  // Create template if doesn't exist
  if (!existsSync(CREDENTIALS_FILE)) {
    const template = {
      ado_pat: "your-personal-access-token",
      ado_org: "your-organization-name",
      ado_project: "your-project-name",
      confluence_base_url: "",
      confluence_email: "",
      confluence_api_token: "",
      tc_drafts_path: "",
    };
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(template, null, 2) + "\n", "utf-8");
  }

  // Check if credentials are configured
  let configured = false;
  try {
    const creds = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
    configured = creds.ado_pat && 
                 creds.ado_pat !== "your-personal-access-token" &&
                 creds.ado_org &&
                 creds.ado_org !== "your-organization-name";
  } catch {
    configured = false;
  }

  return { path: CREDENTIALS_FILE, migrated, configured };
}

// ── MCP Server ──

function runServer() {
  const rl = createInterface({ input: process.stdin, terminal: false });

  const installTool = {
    name: "install",
    description:
      "Install ADO TestForge MCP globally. Checks prerequisites, registers the server, and creates credentials template.",
    inputSchema: { type: "object", properties: {} },
  };

  const installPrompt = {
    name: "install",
    title: "Install ADO TestForge MCP",
    description: "Install ADO TestForge MCP server globally so it works in all workspaces",
  };

  rl.on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    const { id, method, params } = msg;

    if (method === "initialize") {
      send(makeResponse(id, {
        protocolVersion: "2025-03-26",
        capabilities: {
          tools: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: { name: "setup-ado-testforge", version: "1.0.0" },
      }));
      return;
    }

    if (method === "notifications/initialized") return;
    if (method === "ping") { send(makeResponse(id, {})); return; }

    if (method === "tools/list") {
      send(makeResponse(id, { tools: [installTool] }));
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      if (toolName !== "install") {
        send(makeError(id, -32602, `Unknown tool: ${toolName}`));
        return;
      }

      const steps = [];
      let hasErr = false;

      steps.push("╔════════════════════════════════════════════════════════════╗");
      steps.push("║          ADO TestForge MCP Installer                       ║");
      steps.push("╚════════════════════════════════════════════════════════════╝");
      steps.push("");
      steps.push("Checking prerequisites...");
      steps.push("");

      // 1. Google Drive check
      const gdriveCheck = checkGoogleDrive();
      if (gdriveCheck.ok) {
        steps.push("[PASS] Google Drive desktop app detected");
      } else {
        steps.push("[WARN] Google Drive path not detected");
        steps.push("       (Continuing anyway - this is just a warning)");
      }

      // 2. Node.js check
      const nodeCheck = checkNodeVersion();
      if (nodeCheck.ok) {
        steps.push(`[PASS] Node.js ${nodeCheck.version} (v18+ required)`);
      } else {
        steps.push(`[FAIL] Node.js v18+ required. Found: ${nodeCheck.version}`);
        steps.push("       Install from https://nodejs.org (LTS recommended)");
        hasErr = true;
      }

      // 3. Folder structure check
      const folderCheck = checkFolderStructure();
      if (folderCheck.hasMcpServers && folderCheck.hasBootstrap && folderCheck.hasDist) {
        steps.push("[PASS] MCP Servers folder structure valid");
        steps.push(`       Path: ${MCP_SERVERS_DIR}`);
      } else {
        steps.push("[FAIL] Invalid folder structure");
        if (!folderCheck.hasMcpServers) steps.push("       Missing: MCP Servers folder");
        if (!folderCheck.hasBootstrap) steps.push("       Missing: MCP Servers/bin/bootstrap.mjs");
        if (!folderCheck.hasDist) steps.push("       Missing: MCP Servers/dist/index.js");
        hasErr = true;
      }

      steps.push("");

      if (hasErr) {
        steps.push("Installation cannot proceed. Fix the issues above and try again.");
        send(makeResponse(id, {
          content: [{ type: "text", text: steps.join("\n") }],
          isError: true,
        }));
        return;
      }

      steps.push("Installing...");
      steps.push("");

      // 4. Register globally
      try {
        const mcpPath = registerGlobally();
        steps.push("[DONE] ADO TestForge MCP registered globally");
        steps.push(`       Config: ${mcpPath}`);
        steps.push(`       Bootstrap: ${BOOTSTRAP_PATH}`);
      } catch (err) {
        steps.push(`[FAIL] Could not register globally: ${err.message}`);
        hasErr = true;
      }

      // 5. Setup credentials
      if (!hasErr) {
        const credResult = setupCredentials();
        if (credResult.migrated) {
          steps.push("[MIGRATED] Credentials migrated from ~/.mars-ado-mcp/");
        }
        if (credResult.configured) {
          steps.push("[DONE] Credentials already configured");
          steps.push(`       Path: ${credResult.path}`);
        } else {
          steps.push("[DONE] Credentials template created");
          steps.push(`       Path: ${credResult.path}`);
          steps.push("");
          steps.push("NEXT: Open the credentials file and fill in:");
          steps.push("  - ado_pat: Your Azure DevOps Personal Access Token");
          steps.push("  - ado_org: Your ADO organization name");
          steps.push("  - ado_project: Your ADO project name");
        }
      }

      steps.push("");
      steps.push("═══════════════════════════════════════════════════════════════");

      if (!hasErr) {
        steps.push("Installation complete!");
        steps.push("");
        steps.push("RESTART CURSOR to apply changes.");
        steps.push("After restart, ado-testforge will be available in all workspaces.");
      }

      send(makeResponse(id, {
        content: [{ type: "text", text: steps.join("\n") }],
        isError: hasErr,
      }));
      return;
    }

    if (method === "prompts/list") {
      send(makeResponse(id, { prompts: [installPrompt] }));
      return;
    }

    if (method === "prompts/get") {
      if (params?.name !== "install") {
        send(makeError(id, -32602, `Unknown prompt: ${params?.name}`));
        return;
      }
      send(makeResponse(id, {
        description: "Install ADO TestForge MCP server globally",
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: [
              "I want to install the ADO TestForge MCP server.",
              "",
              "Please call the install tool to check prerequisites, register the server globally, and set up credentials.",
            ].join("\n"),
          },
        }],
      }));
      return;
    }

    if (id !== undefined) {
      send(makeError(id, -32601, `Method not found: ${method}`));
    }
  });

  rl.on("close", () => process.exit(0));
}

runServer();
