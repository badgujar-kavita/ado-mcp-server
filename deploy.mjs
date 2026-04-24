#!/usr/bin/env node
/**
 * Build distribution and deploy to Google Drive folder.
 * Run after ANY changes to commands, tools, or enhancements.
 *
 * Requires: GDRIVE_DEPLOY_PATH env var or .deploy-path file
 * Example: /Users/you/Library/CloudStorage/GoogleDrive-.../My Drive/Center of Excellence (CoE)/MCP Servers
 */

import { execSync } from "child_process";
import { copyFileSync, mkdirSync, existsSync, readFileSync, readdirSync, cpSync } from "fs";
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

function getDeployedVersion(deployPath) {
  const deployedPackage = join(deployPath, "package.json");
  if (!existsSync(deployedPackage)) return null;

  try {
    const pkg = JSON.parse(readFileSync(deployedPackage, "utf-8"));
    return pkg.version || null;
  } catch {
    return null;
  }
}

function buildBackupPath(deployPath, version) {
  const parent = dirname(deployPath);
  const base = join(parent, `dist-package-v${version}-backup`);
  if (!existsSync(base)) return base;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${base}-${timestamp}`;
}

function main() {
  const deployPath = getDeployPath();
  console.log("Building distribution...");
  execSync("npm run build:dist", { cwd: ROOT, stdio: "inherit" });

  console.log("Deploying to:", deployPath);
  mkdirSync(deployPath, { recursive: true });

  const previousVersion = getDeployedVersion(deployPath);
  if (previousVersion) {
    const backupPath = buildBackupPath(deployPath, previousVersion);
    cpSync(deployPath, backupPath, { recursive: true });
    console.log(`Backup created at: ${backupPath}`);
    console.log(`Rollback note: restore by replacing ${basename(deployPath)} with ${basename(backupPath)} if needed.`);
  }

  for (const entry of readdirSync(DIST, { withFileTypes: true })) {
    const srcPath = join(DIST, entry.name);
    const destPath = join(deployPath, entry.name);
    if (entry.isDirectory()) {
      execSync(`rm -rf "${destPath}" 2>/dev/null; cp -R "${srcPath}" "${destPath}"`, { stdio: "inherit" });
    } else {
      copyFileSync(srcPath, destPath);
    }
  }

  console.log("Deploy complete. Google Drive folder updated.");
}

main();
