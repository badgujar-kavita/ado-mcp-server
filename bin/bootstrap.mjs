#!/usr/bin/env node

/**
 * VortexADO MCP Bootstrap
 *
 * Two modes based on system state:
 *
 *   (ready)    : Proxy stdio to the full MCP server (dist/index.js or npx tsx src/index.ts).
 *   (NOT ready): Run installer MCP server with /vortex-ado/install command.
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

const CURSOR_MCP_CONFIG = join(homedir(), ".cursor", "mcp.json");
const PACKAGE_JSON = join(PROJECT_ROOT, "package.json");

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
    "VortexADO MCP — Setup Incomplete",
    "",
    "Your ADO credentials are missing or invalid, or installation is incomplete. Core ADO tools will not work until this is resolved.",
    "",
    "Details:",
    ...details.map((detail) => `- ${detail}`),
    "",
    "Run /vortex-ado/install or follow the setup guide: docs/setup-guide.md",
  ];
}

// ── Readiness checks ──

function hasNodeModules() {
  return existsSync(join(PROJECT_ROOT, "node_modules"));
}

function hasDist() {
  return existsSync(join(PROJECT_ROOT, "dist", "index.js"));
}

// ── Prerequisite checks ──

function checkNodeVersion() {
  const match = process.version.match(/^v(\d+)/);
  const major = match ? parseInt(match[1], 10) : 0;
  return { ok: major >= 18, version: process.version, major };
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
  // Use the absolute path of the running Node binary, NOT the literal
  // string "node". Cursor (launched from the Dock/Finder on macOS) does
  // NOT source ~/.zshrc / ~/.bashrc, so node managers like nvm / asdf /
  // Volta / Homebrew on Apple Silicon are invisible to its child-process
  // PATH. Writing the literal "node" here would produce `spawn node ENOENT`
  // when Cursor tries to start the MCP. process.execPath is always
  // absolute and always points at the same Node that's running us — no
  // PATH lookup, no shell quoting risk, works on Windows too.
  const adoTestforgeServers = {
    "vortex-ado": {
      command: process.execPath,
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

  // Set `cwd: PROJECT_ROOT` so the MCP child can resolve sibling files
  // (package.json, docs/changelog.md) via standard relative reads from
  // `import.meta.url`-derived ROOT. The MCP server NO LONGER reads
  // `process.cwd()` for credential or config resolution — every tool
  // resolves credentials per-call from the active CallContext (MCP
  // `roots/list` + agent-supplied `workspaceRoot`). So setting cwd to
  // the installer dir is safe and actually preferred.
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

  const installTool = {
    name: "install",
    description:
      "Check prerequisites (Node.js, folder structure), create credentials template, " +
      "and register VortexADO MCP globally. Run this for first-time setup.",
    inputSchema: { type: "object", properties: {} },
  };

  const checkStatusTool = {
    name: "check_setup_status",
    description: "Check what is needed to complete VortexADO MCP setup",
    inputSchema: { type: "object", properties: {} },
  };

  const installPrompt = {
    name: "install",
    title: "Install VortexADO MCP",
    description: "Check prerequisites, create credentials, and register VortexADO MCP globally",
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
        serverInfo: { name: "vortex-ado", version: getCurrentVersion() },
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
        // Credentials are stored in the OS keychain by /vortex-ado/ado-connect
        // — the bootstrap can't introspect them from outside the MCP runtime.
        // Once the user runs ado-connect, /vortex-ado/ado-check from inside
        // Cursor reports the real credential state. Skip the legacy file check.

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

        // 1. Node.js check
        const nodeCheck = checkNodeVersion();
        if (nodeCheck.ok) {
          steps.push(`[PASS] Node.js ${nodeCheck.version} (v18+ required)`);
        } else {
          steps.push(`[FAIL] Node.js v18+ required. Found: ${nodeCheck.version}`);
          steps.push("       Install from https://nodejs.org (LTS recommended)");
          hasErr = true;
        }

        // 2. Folder structure check
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
          steps.push("       Ensure the installation directory is complete.");
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

        // 5. Credentials are configured via /ado-connect (writes to OS keychain
        // + per-workspace .vortex-ado/config.json). The installer no longer
        // creates a placeholder credentials.json — that was dead surface area
        // from the pre-wizard era and confused users who saw a JSON file with
        // their PAT-shaped fields sitting in ~/.vortex-ado/.
        if (!hasErr) {
          steps.push("");
          steps.push("NEXT: Open your project folder in Cursor and run /vortex-ado/ado-connect");
          steps.push("  - The wizard saves connection details to <workspace>/.vortex-ado/config.json");
          steps.push("  - Your PAT goes to the OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret)");
          steps.push("  - Never written to disk in plaintext");
        }

        // 6. Register globally
        if (!hasErr) {
          try {
            const mcpPath = addToGlobalMcpConfig();
            steps.push("");
            steps.push(`VortexADO MCP registered globally at: ${mcpPath}`);
            steps.push("The vortex-ado server will now appear in all workspaces.");
          } catch (err) {
            steps.push("");
            steps.push(`Warning: Could not update global MCP config: ${err.message}`);
            steps.push("You may need to add vortex-ado manually to ~/.cursor/mcp.json");
          }
        }

        if (!hasErr) {
          steps.push("");
          steps.push("─────────────────────────────────────────────────────");
          steps.push("Installation complete!");
          steps.push("");
          steps.push("Restart Cursor (or reload MCP in Settings > MCP), then run /vortex-ado/ado-connect to configure credentials.");
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
        description: "Install and set up the VortexADO MCP server",
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: [
              "I want to install the VortexADO MCP server.",
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

// Always launch the full MCP server so all tools/prompts are visible.
// Credentials are read from the OS keychain via /vortex-ado/ado-connect at
// runtime; tools that need them surface a clear error if the user hasn't
// configured them yet. The previous "installer mode" (where bootstrap ran a
// stripped-down MCP exposing only /vortex-ado/install while credentials.json
// was placeholder) is gone — Phase 4 deleted the legacy file flow entirely.
launchFullServer();
