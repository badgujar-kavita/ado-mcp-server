#!/usr/bin/env node

/**
 * MARS ADO MCP Bootstrap
 *
 * Three modes driven by CLI flags and system state:
 *
 *   --installer  : Always run the zero-dep INSTALLER MCP server
 *                  (used by the "setup-mars-ado" entry in mcp.json).
 *                  Exposes only the "install" prompt and "install_and_setup" tool.
 *
 *   (no flag, ready)    : Proxy stdio to the full MCP server (npx tsx src/index.ts).
 *   (no flag, NOT ready): Run a tiny "not ready" MCP server that tells the user
 *                          to run /setup-mars-ado/install first.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { spawn, execSync } from "child_process";
import { createInterface } from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

const CREDENTIALS_DIR = join(homedir(), ".mars-ado-mcp");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");
const CURSOR_MCP_CONFIG = join(homedir(), ".cursor", "mcp.json");

const PLACEHOLDER_VALUES = [
  "your-personal-access-token",
  "your-organization-name",
  "your-project-name",
];

// ── Readiness checks ──

function hasNodeModules() {
  return existsSync(join(PROJECT_ROOT, "node_modules"));
}

function hasDist() {
  return existsSync(join(PROJECT_ROOT, "dist", "index.js"));
}

function hasValidCredentials() {
  if (!existsSync(CREDENTIALS_FILE)) return false;
  try {
    const data = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
    const { ado_pat, ado_org, ado_project } = data;
    if (!ado_pat || !ado_org || !ado_project) return false;
    if (PLACEHOLDER_VALUES.includes(ado_pat)) return false;
    if (PLACEHOLDER_VALUES.includes(ado_org)) return false;
    if (PLACEHOLDER_VALUES.includes(ado_project)) return false;
    return true;
  } catch {
    return false;
  }
}

function isReady() {
  return (hasNodeModules() || hasDist()) && hasValidCredentials();
}

// ── Prerequisite checks ──

function checkNodeVersion() {
  const match = process.version.match(/^v(\d+)/);
  const major = match ? parseInt(match[1], 10) : 0;
  return { ok: major >= 18, version: process.version, major };
}

// ── Global MCP config registration ──

function addToGlobalMcpConfig() {
  const bootstrapPath = join(PROJECT_ROOT, "bin", "bootstrap.mjs");
  const marsAdoServers = {
    "mars-ado": {
      command: "node",
      args: [bootstrapPath],
    },
  };

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

  const merged = { ...config.mcpServers, ...marsAdoServers };
  delete merged["setup-mars-ado"];
  config.mcpServers = merged;
  writeFileSync(CURSOR_MCP_CONFIG, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return CURSOR_MCP_CONFIG;
}

// ── Shared JSON-RPC helpers ──

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function makeResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function makeError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// ── Full server proxy ──

function launchFullServer() {
  const isWindows = process.platform === "win32";
  const distEntry = join(PROJECT_ROOT, "dist", "index.js");
  const useDist = existsSync(distEntry);

  const nodeCmd = isWindows ? "node.exe" : "node";

  if (!useDist) {
    const npxCmd = isWindows ? "npx.cmd" : "npx";
    const child = spawn(npxCmd, ["tsx", "src/index.ts"], {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env },
    });
    process.stdin.pipe(child.stdin);
    child.stdout.pipe(process.stdout);
    child.on("exit", (code) => process.exit(code ?? 1));
    process.on("SIGINT", () => child.kill("SIGINT"));
    process.on("SIGTERM", () => child.kill("SIGTERM"));
    return;
  }

  const child = spawn(nodeCmd, [distEntry], {
    cwd: PROJECT_ROOT,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env },
  });

  process.stdin.pipe(child.stdin);
  child.stdout.pipe(process.stdout);

  child.on("exit", (code) => process.exit(code ?? 1));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

// ── Installer MCP server (zero npm dependencies) ──

function runInstallerServer() {
  const rl = createInterface({ input: process.stdin, terminal: false });

  function runNpmInstall() {
    const isWindows = process.platform === "win32";
    const npmCmd = isWindows ? "npm.cmd" : "npm";
    execSync(`${npmCmd} install`, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
  }

  function createCredentialsTemplate() {
    if (!existsSync(CREDENTIALS_DIR)) {
      mkdirSync(CREDENTIALS_DIR, { recursive: true });
    }
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
    return CREDENTIALS_FILE;
  }

  const toolDef = {
    name: "install_and_setup",
    description:
      "Check prerequisites, install npm dependencies, create credentials template, " +
      "and register MARS ADO MCP globally so it works in any workspace. Run this for first-time setup.",
    inputSchema: { type: "object", properties: {} },
  };

  const promptDef = {
    name: "install",
    title: "Install MARS ADO MCP",
    description: "Install dependencies and configure credentials for the MARS ADO MCP server",
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
        serverInfo: { name: "setup-mars-ado", version: "1.0.0" },
      }));
      return;
    }

    if (method === "notifications/initialized") return;
    if (method === "ping") { send(makeResponse(id, {})); return; }

    if (method === "tools/list") {
      send(makeResponse(id, { tools: [toolDef] }));
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      if (toolName !== "install_and_setup") {
        send(makeError(id, -32602, `Unknown tool: ${toolName}`));
        return;
      }

      const steps = [];
      let hasErr = false;

      // 1. Check prerequisites
      const nodeCheck = checkNodeVersion();
      if (!nodeCheck.ok) {
        steps.push(`Node.js v18+ is required. Found: ${nodeCheck.version}`);
        steps.push("Install from https://nodejs.org (LTS recommended), then run this command again.");
        hasErr = true;
      } else {
        steps.push(`Prerequisites OK (Node.js ${nodeCheck.version})`);
      }

      // 2. npm install (skip if using pre-built dist - no deps needed)
      if (!hasErr && !hasDist() && !hasNodeModules()) {
        try {
          steps.push("Installing npm dependencies... this may take a minute.");
          runNpmInstall();
          steps.push("npm install completed successfully.");
        } catch (err) {
          steps.push(`npm install failed: ${err.message}`);
          steps.push("Check your internet connection and try again.");
          hasErr = true;
        }
      } else if (!hasErr) {
        steps.push(hasDist() ? "Using pre-built distribution. Skipping npm install." : "npm dependencies already installed. Skipping.");
      }

      // 3. Credentials template
      if (!hasErr) {
        const credPath = createCredentialsTemplate();
        if (hasValidCredentials()) {
          steps.push(`Credentials already configured at: ${credPath}`);
        } else {
          steps.push(`Credentials template created at: ${credPath}`);
          steps.push("");
          steps.push("NEXT: Open the file above and fill in:");
          steps.push("  - ado_pat: Your Azure DevOps Personal Access Token");
          steps.push("  - ado_org: Your ADO organization name (from https://dev.azure.com/{org})");
          steps.push("  - ado_project: Your ADO project name");
        }
      }

      // 4. Register globally so MCP works in any workspace
      if (!hasErr) {
        try {
          const mcpPath = addToGlobalMcpConfig();
          steps.push("");
          steps.push(`MARS ADO MCP registered globally at: ${mcpPath}`);
          steps.push("The mars-ado server will now appear in all workspaces.");
        } catch (err) {
          steps.push("");
          steps.push(`Warning: Could not update global MCP config: ${err.message}`);
          steps.push("You may need to add the servers manually to ~/.cursor/mcp.json");
        }
      }

      if (!hasErr) {
        steps.push("");
        steps.push("Restart Cursor (or reload MCP in Settings > MCP) to apply changes.");
        if (!hasValidCredentials()) {
          steps.push("After filling in credentials, restart the mars-ado server to activate all tools.");
        }
      }

      send(makeResponse(id, {
        content: [{ type: "text", text: steps.join("\n") }],
        isError: hasErr,
      }));
      return;
    }

    if (method === "prompts/list") {
      send(makeResponse(id, { prompts: [promptDef] }));
      return;
    }

    if (method === "prompts/get") {
      if (params?.name !== "install") {
        send(makeError(id, -32602, `Unknown prompt: ${params?.name}`));
        return;
      }
      send(makeResponse(id, {
        description: "Install and set up the MARS ADO MCP server",
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: [
              "I want to set up the MARS ADO MCP server.",
              "",
              "Please call the install_and_setup tool to install dependencies and create the credentials file.",
              "Then guide me through the remaining steps.",
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

// ── "Not ready" MCP server (mars-ado before setup is done) ──

function runNotReadyServer() {
  const rl = createInterface({ input: process.stdin, terminal: false });

  const missing = [];
  if (!hasNodeModules() && !hasDist()) missing.push("npm dependencies not installed (or use pre-built dist)");
  if (!hasValidCredentials()) missing.push("credentials not configured");

  const statusTool = {
    name: "check_setup_status",
    description: "Check what is needed to complete MARS ADO MCP setup",
    inputSchema: { type: "object", properties: {} },
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
        serverInfo: { name: "mars-ado", version: "1.0.0" },
      }));
      return;
    }

    if (method === "notifications/initialized") return;
    if (method === "ping") { send(makeResponse(id, {})); return; }

    if (method === "tools/list") {
      send(makeResponse(id, { tools: [statusTool] }));
      return;
    }

    if (method === "tools/call") {
      if (params?.name !== "check_setup_status") {
        send(makeError(id, -32602, `Unknown tool: ${params?.name}`));
        return;
      }

      const lines = [
        "MARS ADO MCP is not fully set up yet.",
        "",
        "Missing:",
        ...missing.map((m) => `  - ${m}`),
        "",
        "To complete setup, run the /setup-mars-ado/install command.",
        "After setup, restart the mars-ado MCP server in Cursor Settings > MCP.",
      ];

      send(makeResponse(id, {
        content: [{ type: "text", text: lines.join("\n") }],
      }));
      return;
    }

    if (method === "prompts/list") {
      send(makeResponse(id, { prompts: [] }));
      return;
    }

    if (method === "prompts/get") {
      send(makeError(id, -32602, `Unknown prompt: ${params?.name}`));
      return;
    }

    if (id !== undefined) {
      send(makeError(id, -32601, `Method not found: ${method}`));
    }
  });

  rl.on("close", () => process.exit(0));
}

// ── Entry point ──

const isInstallerMode = process.argv.includes("--installer");

if (isInstallerMode) {
  runInstallerServer();
} else if (isReady()) {
  launchFullServer();
} else {
  runNotReadyServer();
}
