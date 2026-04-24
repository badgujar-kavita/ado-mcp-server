import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SRC_DIR, "..");
const PACKAGE_JSON = join(ROOT, "package.json");
const CHANGELOG_MD = join(ROOT, "docs", "changelog.md");

export function getCurrentVersion(): string {
  try {
    const raw = readFileSync(PACKAGE_JSON, "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function isNewerVersion(previous: string, current: string): boolean {
  const prev = parseVersion(previous);
  const next = parseVersion(current);

  for (let i = 0; i < 3; i++) {
    if (next[i] > prev[i]) return true;
    if (next[i] < prev[i]) return false;
  }

  return false;
}

export function getLatestChangelogHighlights(limit = 5): string[] {
  if (!existsSync(CHANGELOG_MD)) return [];

  try {
    const raw = readFileSync(CHANGELOG_MD, "utf-8");
    const lines = raw.split(/\r?\n/);
    const highlights: string[] = [];
    let inFirstSection = false;

    for (const line of lines) {
      if (!inFirstSection) {
        if (line.startsWith("## ")) {
          inFirstSection = true;
        }
        continue;
      }

      if (line.startsWith("## ")) break;
      if (line.startsWith("---")) break;

      if (line.startsWith("- ")) {
        highlights.push(line.slice(2).trim());
        if (highlights.length >= limit) break;
      }
    }

    return highlights;
  } catch {
    return [];
  }
}

function parseVersion(value: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = value.split(".");
  return [parseInt(major, 10) || 0, parseInt(minor, 10) || 0, parseInt(patch, 10) || 0];
}
