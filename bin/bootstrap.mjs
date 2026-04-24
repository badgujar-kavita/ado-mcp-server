#!/usr/bin/env node

/**
 * ADO TestForge MCP Bootstrap
 *
 * Two modes based on system state:
 *
 *   (ready)    : Proxy stdio to the full MCP server (dist/index.js or npx tsx src/index.ts).
 *   (NOT ready): Run installer MCP server with /ado-testforge/install command.
 *                Checks prerequisites, creates credentials template, registers globally.
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

const CREDENTIALS_DIR = join(homedir(), ".ado-testforge-mcp");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");
const CURSOR_MCP_CONFIG = join(homedir(), ".cursor", "mcp.json");
const PACKAGE_JSON = join(PROJECT_ROOT, "package.json");

const PLACEHOLDER_VALUES = [
  "your-personal-access-token",
  "your-organization-name",
  "your-project-name",
];

function getCurrentVersion() {
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function buildSetupIncompleteMessage(details) {
  return [
    "ADO TestForge MCP — Setup Incomplete",
    "",
    "Your ADO credentials are missing or invalid, or installation is incomplete. Core ADO tools will not work until this is resolved.",
    "",
    "Details:",
    ...details.map((detail) => `- ${detail}`),
    "",
    "Run /ado-testforge/install or follow the setup guide: docs/setup-guide.md",
  ];
}

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

function checkGoogleDrive() {
  const pathLower = PROJECT_ROOT.toLowerCase();
  const hasGoogleDrive =
    pathLower.includes("cloudstorage/googledrive") ||
    pathLower.includes("google drive") ||
    pathLower.includes("googledrive");
  return {
    ok: hasGoogleDrive,
    path: PROJECT_ROOT,
  };
}

function checkFolderStructure() {
  const hasBootstrap = existsSync(join(PROJECT_ROOT, "bin", "bootstrap.mjs"));
  const hasDistOrSrc = hasDist() || existsSync(join(PROJECT_ROOT, "src", "index.ts"));
  return {
    ok: hasBootstrap && hasDistOrSrc,
    hasBootstrap,
    hasDist: hasDist(),
    hasSrc: existsSync(join(PROJECT_ROOT, "src", "index.ts")),
  };
}

// ── Global MCP config registration ──

function addToGlobalMcpConfig() {
  const bootstrapPath = join(PROJECT_ROOT, "bin", "bootstrap.mjs");
  const adoTestforgeServers = {
    "ado-testforge": {
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

  const merged = { ...config.mcpServers, ...adoTestforgeServers };
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

// ── Installer MCP server (shown when not ready) ──

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

    // Migrate from old mars-ado-mcp path if it exists
    const oldCredentialsDir = join(homedir(), ".mars-ado-mcp");
    const oldCredentialsFile = join(oldCredentialsDir, "credentials.json");
    let migrated = false;

    if (!existsSync(CREDENTIALS_FILE) && existsSync(oldCredentialsFile)) {
      try {
        const oldCreds = readFileSync(oldCredentialsFile, "utf-8");
        writeFileSync(CREDENTIALS_FILE, oldCreds, "utf-8");
        migrated = true;
      } catch {
        // Fall through to create template
      }
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

    return { path: CREDENTIALS_FILE, migrated };
  }

  const installTool = {
    name: "install",
    description:
      "Check prerequisites (Google Drive, Node.js, folder structure), create credentials template, " +
      "and register ADO TestForge MCP globally. Run this for first-time setup.",
    inputSchema: { type: "object", properties: {} },
  };

  const checkStatusTool = {
    name: "check_setup_status",
    description: "Check what is needed to complete ADO TestForge MCP setup",
    inputSchema: { type: "object", properties: {} },
  };

  const installPrompt = {
    name: "install",
    title: "Install ADO TestForge MCP",
    description: "Check prerequisites, create credentials, and register ADO TestForge MCP globally",
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
        serverInfo: { name: "ado-testforge", version: getCurrentVersion() },
      }));
      return;
    }

    if (method === "notifications/initialized") return;
    if (method === "ping") { send(makeResponse(id, {})); return; }

    if (method === "tools/list") {
      send(makeResponse(id, { tools: [installTool, checkStatusTool] }));
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name;

      // ── check_setup_status tool ──
      if (toolName === "check_setup_status") {
        const missing = [];
        if (!hasNodeModules() && !hasDist()) {
          missing.push("Distribution package or node_modules not found.");
        }
        if (!existsSync(CREDENTIALS_FILE)) {
          missing.push(`Credentials file not found at ${CREDENTIALS_FILE}.`);
        } else if (!hasValidCredentials()) {
          missing.push(`Credentials file exists at ${CREDENTIALS_FILE} but still contains placeholders or missing required values.`);
        }

        const lines = buildSetupIncompleteMessage(
          missing.length > 0 ? missing : ["Installation is incomplete. Restart Cursor after setup finishes."]
        );

        send(makeResponse(id, {
          content: [{ type: "text", text: lines.join("\n") }],
        }));
        return;
      }

      // ── install tool ──
      if (toolName === "install") {
        const steps = [];
        let hasErr = false;

        steps.push("Checking prerequisites...");
        steps.push("");

        // 1. Google Drive check
        const gdriveCheck = checkGoogleDrive();
        if (gdriveCheck.ok) {
          steps.push("[PASS] Google Drive desktop app detected");
        } else {
          steps.push("[WARN] Google Drive path not detected");
          steps.push("       Path: " + gdriveCheck.path);
          steps.push("       If using Google Drive, ensure the desktop app is installed.");
          steps.push("       Download: https://www.google.com/drive/download/");
          steps.push("       (Continuing anyway - this is a warning, not an error)");
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
        if (folderCheck.ok) {
          if (folderCheck.hasDist) {
            steps.push("[PASS] Distribution package found (dist/index.js)");
          } else {
            steps.push("[PASS] Source files found (src/index.ts)");
          }
        } else {
          steps.push("[FAIL] Invalid folder structure");
          steps.push("       Missing: " + (!folderCheck.hasBootstrap ? "bin/bootstrap.mjs " : "") +
            (!folderCheck.hasDist && !folderCheck.hasSrc ? "dist/index.js or src/index.ts" : ""));
          steps.push("       Ensure you're using the CoE/MCP Servers folder.");
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

        steps.push("Proceeding with installation...");
        steps.push("");

        // 4. npm install (skip if using pre-built dist)
        if (!hasDist() && !hasNodeModules()) {
          try {
            steps.push("Installing npm dependencies... this may take a minute.");
            runNpmInstall();
            steps.push("npm install completed successfully.");
          } catch (err) {
            steps.push(`npm install failed: ${err.message}`);
            steps.push("Check your internet connection and try again.");
            hasErr = true;
          }
        } else if (hasDist()) {
          steps.push("Using pre-built distribution. No npm install needed.");
        } else {
          steps.push("npm dependencies already installed.");
        }

        // 5. Credentials template (with migration from old mars-ado-mcp path)
        if (!hasErr) {
          const credResult = createCredentialsTemplate();
          if (credResult.migrated) {
            steps.push(`[MIGRATED] Credentials migrated from ~/.mars-ado-mcp/ to: ${credResult.path}`);
          }
          if (hasValidCredentials()) {
            steps.push(`Credentials configured at: ${credResult.path}`);
          } else {
            steps.push(`Credentials template created at: ${credResult.path}`);
            steps.push("");
            steps.push("NEXT: Open the file above and fill in:");
            steps.push("  - ado_pat: Your Azure DevOps Personal Access Token");
            steps.push("  - ado_org: Your ADO organization name (from https://dev.azure.com/{org})");
            steps.push("  - ado_project: Your ADO project name");
          }
        }

        // 6. Register globally
        if (!hasErr) {
          try {
            const mcpPath = addToGlobalMcpConfig();
            steps.push("");
            steps.push(`ADO TestForge MCP registered globally at: ${mcpPath}`);
            steps.push("The ado-testforge server will now appear in all workspaces.");
          } catch (err) {
            steps.push("");
            steps.push(`Warning: Could not update global MCP config: ${err.message}`);
            steps.push("You may need to add ado-testforge manually to ~/.cursor/mcp.json");
          }
        }

        if (!hasErr) {
          steps.push("");
          steps.push("─────────────────────────────────────────────────────");
          steps.push("Installation complete!");
          steps.push("");
          steps.push("Restart Cursor (or reload MCP in Settings > MCP) to apply changes.");
          if (!hasValidCredentials()) {
            steps.push("After filling in credentials, restart to activate all tools.");
          }
        }

        send(makeResponse(id, {
          content: [{ type: "text", text: steps.join("\n") }],
          isError: hasErr,
        }));
        return;
      }

      send(makeError(id, -32602, `Unknown tool: ${toolName}`));
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
        description: "Install and set up the ADO TestForge MCP server",
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: [
              "I want to install the ADO TestForge MCP server.",
              "",
              "Please call the install tool to check prerequisites and complete the setup.",
              "Then guide me through filling in my credentials.",
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

// ── Entry point ──

if (isReady()) {
  launchFullServer();
} else {
  runInstallerServer();
}
