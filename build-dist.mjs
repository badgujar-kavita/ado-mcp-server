#!/usr/bin/env node
/**
 * Build a distribution package for the Vercel-hosted tarball.
 * Output: dist-package/ with compiled JS (no src/) — this is the folder
 * that `scripts/build-website.sh` tarballs and publishes as
 * https://ado-mcp.vercel.app/ado-testforge.tar.gz.
 */

import { build } from "esbuild";
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, cpSync } from "fs";
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
  // Deployment-only rule: warn users not to edit the installed copy (it's
  // overwritten on every tarball update).
  writeFileSync(
    join(OUT, ".cursor", "rules", "make-changes-in-main-project.mdc"),
    `---
description: Do not edit this folder. It is overwritten on every tarball update; restart MCP to pick up updates.
globs: "**/*"
alwaysApply: true
---

# Read-Only Installation — Do Not Edit

**Do not modify tools, rules, skills, or docs in this folder.**

- **Why:** This folder is populated by the Vercel-hosted tarball installer. Any edits here are untracked and will be overwritten the next time you run the install command.
- **How updates work:** Re-run the install command from the Vercel site to pull the latest tarball, then restart the MCP server to load the new code.
- **Need a change?** Open an issue / PR on the main ADO TestForge MCP project. Do not edit here.
`
  );
  // Copy skills (entire directory structure)
  const skillsSrc = join(ROOT, ".cursor", "skills");
  if (existsSync(skillsSrc)) {
    for (const skillDir of readdirSync(skillsSrc, { withFileTypes: true })) {
      if (skillDir.isDirectory()) {
        const destSkillDir = join(OUT, ".cursor", "skills", skillDir.name);
        cpSync(join(skillsSrc, skillDir.name), destSkillDir, { recursive: true });
      }
    }
  }
  if (existsSync(join(ROOT, "README.md"))) {
    copyFileSync(join(ROOT, "README.md"), join(OUT, "README.md"));
  }
  if (existsSync(join(ROOT, "conventions.config.json"))) {
    copyFileSync(join(ROOT, "conventions.config.json"), join(OUT, "conventions.config.json"));
  }

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
  console.log("Publish via scripts/build-website.sh (runs automatically on Vercel deploy).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
