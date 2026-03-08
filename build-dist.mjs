#!/usr/bin/env node
/**
 * Build a distribution package for Google Drive share.
 * Output: dist-package/ with compiled JS (no src/) so code is hidden.
 */

import { build } from "esbuild";
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname);
const OUT = join(ROOT, "dist-package");

function copyDirContents(srcDir, destDir, extFilter) {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const srcPath = join(srcDir, name);
    if (statSync(srcPath).isDirectory()) continue;
    if (extFilter && !name.endsWith(extFilter)) continue;
    copyFileSync(srcPath, join(destDir, name));
  }
}

async function main() {
  console.log("Building distribution package...");

  mkdirSync(OUT, { recursive: true });
  mkdirSync(join(OUT, "bin"), { recursive: true });
  mkdirSync(join(OUT, "dist"), { recursive: true });
  mkdirSync(join(OUT, ".cursor"), { recursive: true });
  mkdirSync(join(OUT, "docs"), { recursive: true });
  mkdirSync(join(OUT, ".cursor", "rules"), { recursive: true });
  mkdirSync(join(OUT, ".cursor", "skills"), { recursive: true });

  await build({
    entryPoints: [join(ROOT, "src", "index.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(OUT, "dist", "index.js"),
    target: "node18",
  });

  copyFileSync(join(ROOT, "bin", "bootstrap.mjs"), join(OUT, "bin", "bootstrap.mjs"));
  copyFileSync(join(ROOT, ".cursor", "mcp.json"), join(OUT, ".cursor", "mcp.json"));
  copyDirContents(join(ROOT, "docs"), join(OUT, "docs"), ".md");
  copyDirContents(join(ROOT, ".cursor", "rules"), join(OUT, ".cursor", "rules"), ".mdc");
  // Deployment-only rule: block edits in deployed folder (one-way flow, no tracking)
  writeFileSync(
    join(OUT, ".cursor", "rules", "make-changes-in-main-project.mdc"),
    `---
description: Do not edit this folder. Changes are pushed from main project; restart MCP to pick up updates.
globs: "**/*"
alwaysApply: true
---

# Read-Only Deployment — Do Not Edit

**Do not modify tools, rules, skills, or docs in this folder.**

- **Why:** Edits here are untracked, undocumented, and overwrite each other. No way to know who changed what.
- **How updates work:** Changes are pushed from the main project (ADO TestForge MCP). When you receive updates (e.g. via Google Drive sync), **restart the MCP server** to pick them up.
- **Need a change?** Ask the main project owner. Do not edit here.
`
  );
  // Copy skills (entire directory structure)
  const skillsSrc = join(ROOT, ".cursor", "skills");
  if (existsSync(skillsSrc)) {
    for (const skillDir of readdirSync(skillsSrc, { withFileTypes: true })) {
      if (skillDir.isDirectory()) {
        const destSkillDir = join(OUT, ".cursor", "skills", skillDir.name);
        mkdirSync(destSkillDir, { recursive: true });
        for (const f of readdirSync(join(skillsSrc, skillDir.name))) {
          copyFileSync(join(skillsSrc, skillDir.name, f), join(destSkillDir, f));
        }
      }
    }
  }
  if (existsSync(join(ROOT, "README.md"))) {
    copyFileSync(join(ROOT, "README.md"), join(OUT, "README.md"));
  }
  if (existsSync(join(ROOT, "conventions.config.json"))) {
    copyFileSync(join(ROOT, "conventions.config.json"), join(OUT, "conventions.config.json"));
  }

  // Deploy blocking script: prevents back-deploy from deployment folder to main project
  mkdirSync(join(OUT, "scripts"), { recursive: true });
  copyFileSync(join(ROOT, "scripts", "deploy-block.mjs"), join(OUT, "scripts", "deploy.mjs"));

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const distPkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: "module",
    dependencies: {},
  };
  writeFileSync(join(OUT, "package.json"), JSON.stringify(distPkg, null, 2) + "\n");


  console.log("Done. Distribution package at: dist-package/");
  console.log("Share the dist-package/ folder on Google Drive.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
