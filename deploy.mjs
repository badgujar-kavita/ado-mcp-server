#!/usr/bin/env node
/**
 * Build distribution and deploy to Google Drive folder.
 * Run after ANY changes to commands, tools, or enhancements.
 *
 * Requires: GDRIVE_DEPLOY_PATH env var or .deploy-path file
 * Example: /Users/you/Library/CloudStorage/GoogleDrive-.../My Drive/Center of Excellence (CoE)/MCP Servers
 */

import { execSync } from "child_process";
import { copyFileSync, mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname);
const DIST = join(ROOT, "dist-package");

function getDeployPath() {
  const envPath = process.env.GDRIVE_DEPLOY_PATH;
  if (envPath) return envPath;

  const configPath = join(ROOT, ".deploy-path");
  if (existsSync(configPath)) {
    return readFileSync(configPath, "utf-8").trim();
  }

  console.error("ERROR: Deploy path not configured.");
  console.error("Set GDRIVE_DEPLOY_PATH env var, or create .deploy-path with the target folder path.");
  process.exit(1);
}

function main() {
  const deployPath = getDeployPath();
  console.log("Building distribution...");
  execSync("npm run build:dist", { cwd: ROOT, stdio: "inherit" });

  console.log("Deploying to:", deployPath);
  mkdirSync(deployPath, { recursive: true });

  for (const entry of readdirSync(DIST, { withFileTypes: true })) {
    const srcPath = join(DIST, entry.name);
    const destPath = join(deployPath, entry.name);
    if (entry.isDirectory()) {
      execSync(`rm -rf "${destPath}" 2>/dev/null; cp -R "${srcPath}" "${destPath}"`, { stdio: "inherit" });
    } else {
      copyFileSync(srcPath, destPath);
    }
  }

  // Create .cursor/mcp.json at parent CoE folder level so MCP is available
  // when users add the CoE folder (not just MCP Servers subfolder) to workspace
  const parentFolder = dirname(deployPath);
  const mcpServersFolderName = basename(deployPath);
  const parentCursorDir = join(parentFolder, ".cursor");
  mkdirSync(parentCursorDir, { recursive: true });

  const parentMcpConfig = {
    mcpServers: {
      "ado-testforge": {
        command: "node",
        args: [join(mcpServersFolderName, "bin", "bootstrap.mjs")],
      },
    },
  };
  writeFileSync(
    join(parentCursorDir, "mcp.json"),
    JSON.stringify(parentMcpConfig, null, 2) + "\n",
    "utf-8"
  );
  console.log("Created parent folder MCP config at:", join(parentCursorDir, "mcp.json"));

  console.log("Deploy complete. Google Drive folder updated.");
}

main();
