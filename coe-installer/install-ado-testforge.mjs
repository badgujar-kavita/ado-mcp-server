#!/usr/bin/env node

/**
 * ADO TestForge MCP Installer
 * 
 * Run this script to install the ADO TestForge MCP server globally.
 * It will:
 * 1. Check prerequisites (Node.js, folder structure)
 * 2. Register ado-testforge in ~/.cursor/mcp.json with absolute path
 * 3. Create/migrate credentials template
 * 
 * Usage: node install-ado-testforge.mjs
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const MCP_SERVERS_DIR = join(__dirname, "MCP Servers");
const BOOTSTRAP_PATH = join(MCP_SERVERS_DIR, "bin", "bootstrap.mjs");
const DIST_PATH = join(MCP_SERVERS_DIR, "dist", "index.js");

const CREDENTIALS_DIR = join(homedir(), ".ado-testforge-mcp");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");
const OLD_CREDENTIALS_DIR = join(homedir(), ".mars-ado-mcp");
const OLD_CREDENTIALS_FILE = join(OLD_CREDENTIALS_DIR, "credentials.json");
const CURSOR_MCP_CONFIG = join(homedir(), ".cursor", "mcp.json");

// ── Helpers ──

function checkNodeVersion() {
  const match = process.version.match(/^v(\d+)/);
  const major = match ? parseInt(match[1], 10) : 0;
  return { ok: major >= 18, version: process.version, major };
}

function checkFolderStructure() {
  return {
    hasMcpServers: existsSync(MCP_SERVERS_DIR),
    hasBootstrap: existsSync(BOOTSTRAP_PATH),
    hasDist: existsSync(DIST_PATH),
  };
}

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

// ── Main ──

function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║          ADO TestForge MCP Installer                       ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("Checking prerequisites...");
  console.log("");

  let hasError = false;

  // 1. Node.js check
  const nodeCheck = checkNodeVersion();
  if (nodeCheck.ok) {
    console.log(`[PASS] Node.js ${nodeCheck.version} (v18+ required)`);
  } else {
    console.log(`[FAIL] Node.js v18+ required. Found: ${nodeCheck.version}`);
    console.log("       Install from https://nodejs.org (LTS recommended)");
    hasError = true;
  }

  // 2. Folder structure check
  const folderCheck = checkFolderStructure();
  if (folderCheck.hasMcpServers && folderCheck.hasBootstrap && folderCheck.hasDist) {
    console.log("[PASS] MCP Servers folder structure valid");
    console.log(`       Path: ${MCP_SERVERS_DIR}`);
  } else {
    console.log("[FAIL] Invalid folder structure");
    if (!folderCheck.hasMcpServers) console.log("       Missing: MCP Servers folder");
    if (!folderCheck.hasBootstrap) console.log("       Missing: MCP Servers/bin/bootstrap.mjs");
    if (!folderCheck.hasDist) console.log("       Missing: MCP Servers/dist/index.js");
    hasError = true;
  }

  console.log("");

  if (hasError) {
    console.log("Installation cannot proceed. Fix the issues above and try again.");
    process.exit(1);
  }

  console.log("Installing...");
  console.log("");

  // 3. Register globally
  try {
    const mcpPath = registerGlobally();
    console.log(`[DONE] ADO TestForge MCP registered globally`);
    console.log(`       Config: ${mcpPath}`);
    console.log(`       Bootstrap: ${BOOTSTRAP_PATH}`);
  } catch (err) {
    console.log(`[FAIL] Could not register globally: ${err.message}`);
    hasError = true;
  }

  // 4. Setup credentials
  if (!hasError) {
    const credResult = setupCredentials();
    if (credResult.migrated) {
      console.log(`[MIGRATED] Credentials migrated from ~/.mars-ado-mcp/`);
    }
    if (credResult.configured) {
      console.log(`[DONE] Credentials already configured`);
      console.log(`       Path: ${credResult.path}`);
    } else {
      console.log(`[DONE] Credentials template created`);
      console.log(`       Path: ${credResult.path}`);
      console.log("");
      console.log("NEXT: Open the credentials file and fill in:");
      console.log("  - ado_pat: Your Azure DevOps Personal Access Token");
      console.log("  - ado_org: Your ADO organization name");
      console.log("  - ado_project: Your ADO project name");
    }
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════════════════");
  
  if (!hasError) {
    console.log("Installation complete!");
    console.log("");
    console.log("RESTART CURSOR to apply changes.");
    console.log("After restart, ado-testforge will be available in all workspaces.");
    process.exit(0);
  } else {
    console.log("Installation failed. See errors above.");
    process.exit(1);
  }
}

main();
