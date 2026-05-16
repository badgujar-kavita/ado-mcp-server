#!/bin/bash
#
# Build a self-contained release zip ready to upload to Google Drive (or
# any other file-share) and hand to testers.
#
# Output:
#   releases/vortex-ado-v<version>-<YYYY-MM-DD>.zip
#
# Zip contents:
#   vortex-ado-v<version>-<YYYY-MM-DD>/
#     ├── README.md              ← tester-facing prerequisites + install/uninstall
#     ├── install.sh             ← installer (auto-detects vortex-ado.tar.gz)
#     ├── uninstall.sh           ← uninstaller (always confirms before deleting)
#     └── vortex-ado.tar.gz      ← compiled MCP bundle
#
# Usage:
#   bash scripts/release.sh           # full build + zip
#   bash scripts/release.sh --quiet   # suppress info banners (CI use)
#
# This is the FIRST step of every release. The SECOND step (upload zip
# to Drive, share the link) is manual until distribution is moved off
# Drive — see the printed next-steps block at the bottom.

set -euo pipefail

# ══ Paths ════════════════════════════════════════════════════════════════════

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_PACKAGE="$REPO_ROOT/dist-package"
RELEASES_DIR="$REPO_ROOT/releases"
SCRIPTS_DIR="$REPO_ROOT/scripts"

# ══ Colors ═══════════════════════════════════════════════════════════════════

if [[ "${1:-}" == "--quiet" ]]; then
  BOLD='' GREEN='' YELLOW='' CYAN='' RED='' NC=''
else
  BOLD='\033[1m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  RED='\033[0;31m'
  NC='\033[0m'
fi

info()    { printf "${CYAN}==>${NC} %s\n" "$1"; }
ok()      { printf "${GREEN}✓${NC}   %s\n" "$1"; }
warn()    { printf "${YELLOW}⚠${NC}   %s\n" "$1"; }
err()     { printf "${RED}✗${NC}   %s\n" "$1" >&2; }

# ══ Sanity checks ════════════════════════════════════════════════════════════

cd "$REPO_ROOT"

if ! command -v node >/dev/null 2>&1; then
  err "Node.js not found. Install Node 18+ before running this script."
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  err "zip not found. Install with 'brew install zip' (macOS) or 'apt install zip' (Linux)."
  exit 1
fi

if [[ ! -f package.json ]]; then
  err "Run from inside the repo (no package.json at $REPO_ROOT)."
  exit 1
fi

# Check the bundled scripts + readme exist before building anything.
for f in "$SCRIPTS_DIR/bundled-install.sh" "$SCRIPTS_DIR/bundled-uninstall.sh" "$SCRIPTS_DIR/bundled-readme.md"; do
  if [[ ! -f "$f" ]]; then
    err "Missing bundled asset: $f"
    err "These three files ship inside the release zip; add them and retry."
    exit 1
  fi
done

# ══ Read package metadata ════════════════════════════════════════════════════

VERSION="$(node -p "require('./package.json').version")"
DATE_STAMP="$(date +%Y-%m-%d)"
RELEASE_NAME="vortex-ado-v${VERSION}-${DATE_STAMP}"
ZIP_PATH="${RELEASES_DIR}/${RELEASE_NAME}.zip"
STAGE_DIR="${RELEASES_DIR}/${RELEASE_NAME}"

# ══ Step 1: build dist-package ═══════════════════════════════════════════════

info "Building distribution package (npm run build:dist)..."
npm run build:dist
ok "dist-package built at: $DIST_PACKAGE"

# ══ Step 2: stage the release folder ═════════════════════════════════════════

mkdir -p "$RELEASES_DIR"
rm -rf "$STAGE_DIR" "$ZIP_PATH"
mkdir -p "$STAGE_DIR"

info "Staging release folder $STAGE_DIR..."

# Tar the *contents* of dist-package (not the wrapper folder) so install.sh
# extracts files directly into ~/.vortex-ado/ without a nested layer.
tar -czf "$STAGE_DIR/vortex-ado.tar.gz" -C "$DIST_PACKAGE" .
ok "Bundled vortex-ado.tar.gz"

cp "$SCRIPTS_DIR/bundled-install.sh" "$STAGE_DIR/install.sh"
cp "$SCRIPTS_DIR/bundled-uninstall.sh" "$STAGE_DIR/uninstall.sh"
cp "$SCRIPTS_DIR/bundled-readme.md" "$STAGE_DIR/README.md"
chmod +x "$STAGE_DIR/install.sh" "$STAGE_DIR/uninstall.sh"
ok "Bundled install.sh, uninstall.sh, README.md"

# ══ Step 3: zip the staged folder ════════════════════════════════════════════

info "Creating $ZIP_PATH..."
# Quiet mode (-q), no extra metadata files. Run from RELEASES_DIR so the
# zip's top-level entry is RELEASE_NAME/ — extracts as a tidy single folder.
( cd "$RELEASES_DIR" && zip -qr "$(basename "$ZIP_PATH")" "$RELEASE_NAME" )
SIZE="$(du -h "$ZIP_PATH" | awk '{print $1}')"
ok "Zip ready: $ZIP_PATH ($SIZE)"

# ══ Step 4: cleanup the staging folder ═══════════════════════════════════════

# Keep the zip; remove the unzipped staging dir to avoid confusion (which is
# the artifact, the folder or the zip?).
rm -rf "$STAGE_DIR"
ok "Cleaned up staging folder"

# ══ Step 5: next-step prompt ═════════════════════════════════════════════════

printf "\n%bRelease built.%b\n\n" "$BOLD" "$NC"
printf "  File:   %s\n" "$ZIP_PATH"
printf "  Size:   %s\n" "$SIZE"
printf "  Source: %s v%s\n\n" "vortex-ado" "$VERSION"

printf "%bWhat's inside the zip:%b\n\n" "$BOLD" "$NC"
printf "  %s/\n" "$RELEASE_NAME"
printf "    ├── README.md              (tester-facing prerequisites + install steps)\n"
printf "    ├── install.sh             (run to install)\n"
printf "    ├── uninstall.sh           (run to remove; always asks for confirmation)\n"
printf "    └── vortex-ado.tar.gz      (the compiled MCP bundle)\n\n"

printf "%bNext steps (manual — Google Drive distribution):%b\n\n" "$BOLD" "$NC"
printf "  1. Upload %s to your Google Drive release folder.\n" "$(basename "$ZIP_PATH")"
printf "  2. Right-click → \"Get link\" → copy the share link.\n"
printf "  3. Send the link to your testers. They:\n"
printf "       • Download the zip\n"
printf "       • Extract it (double-click on macOS, or 'unzip' in terminal)\n"
printf "       • cd into the extracted folder and run: bash install.sh\n\n"

printf "%bTip — keep release notes alongside:%b\n\n" "$BOLD" "$NC"
printf "  Drop a CHANGES-%s.md next to the zip in Drive listing what's\n" "$VERSION"
printf "  changed since the previous version. Saves a lot of \"is this the latest?\"\n"
printf "  questions later.\n\n"
