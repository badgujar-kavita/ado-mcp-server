#!/bin/bash
#
# Build a versioned tarball ready to upload to Google Drive (or any other
# file-share) and hand to testers.
#
# Output:
#   dist-package/      — the staged install tree (built by build-dist.mjs)
#   releases/vortex-mcp-ado-v<version>-<YYYY-MM-DD>.tar.gz  — what users download
#
# Usage:
#   bash scripts/release.sh           # build + tar, no upload
#   bash scripts/release.sh --quiet   # same, but suppress info banners (CI use)
#
# This script is the FIRST step of every release. The SECOND step (upload to
# Drive) is manual until distribution is moved off Drive — see the printed
# next-steps block at the bottom.

set -euo pipefail

# ══ Paths ═════════════════════════════════════════════════════════════════════

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_PACKAGE="$REPO_ROOT/dist-package"
RELEASES_DIR="$REPO_ROOT/releases"

# ══ Colors ════════════════════════════════════════════════════════════════════

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

# ══ Sanity checks ═════════════════════════════════════════════════════════════

cd "$REPO_ROOT"

if ! command -v node >/dev/null 2>&1; then
  err "Node.js not found. Install Node 18+ before running this script."
  exit 1
fi

if [[ ! -f package.json ]]; then
  err "Run this script from inside the repo (no package.json found at $REPO_ROOT)."
  exit 1
fi

# Read version from package.json (one-line node script — no jq dependency).
VERSION="$(node -p "require('./package.json').version")"
PACKAGE_NAME="$(node -p "require('./package.json').name")"
DATE_STAMP="$(date +%Y-%m-%d)"
TARBALL_NAME="${PACKAGE_NAME}-v${VERSION}-${DATE_STAMP}.tar.gz"
TARBALL_PATH="${RELEASES_DIR}/${TARBALL_NAME}"

# ══ Step 1: build dist-package ═══════════════════════════════════════════════

info "Building distribution package (npm run build:dist)..."
npm run build:dist
ok "dist-package built at: $DIST_PACKAGE"

# ══ Step 2: tarball ═══════════════════════════════════════════════════════════

mkdir -p "$RELEASES_DIR"

info "Creating tarball $TARBALL_NAME..."
# -C dist-package + . means: contents of dist-package/ become the top-level
# entries in the tarball (no nested 'dist-package/' directory). Matches the
# install-from-tarball script's expectation that tar -xz lands files directly
# in ~/.vortex-ado/.
tar -czf "$TARBALL_PATH" -C "$DIST_PACKAGE" .
SIZE="$(du -h "$TARBALL_PATH" | awk '{print $1}')"
ok "Tarball ready: $TARBALL_PATH ($SIZE)"

# ══ Step 3: next-step prompt ══════════════════════════════════════════════════

printf "\n%bRelease built.%b\n\n" "$BOLD" "$NC"
printf "  File:   %s\n" "$TARBALL_PATH"
printf "  Size:   %s\n" "$SIZE"
printf "  Source: %s v%s\n\n" "$PACKAGE_NAME" "$VERSION"

printf "%bNext steps (manual — Google Drive distribution):%b\n\n" "$BOLD" "$NC"
printf "  1. Upload %s to your Google Drive release folder.\n" "$TARBALL_NAME"
printf "  2. Right-click → \"Get link\" → copy the share link.\n"
printf "  3. Send the link to your testers along with the install instructions.\n"
printf "     See docs/install-from-tarball.md or scripts/install-from-tarball.sh\n"
printf "     for the user-facing one-liner.\n\n"

printf "%bTip — keep release notes alongside:%b\n\n" "$BOLD" "$NC"
printf "  Drop a CHANGES-%s.md next to the tarball in Drive listing what's\n" "$VERSION"
printf "  changed since the previous version. Saves a lot of \"is this the latest?\"\n"
printf "  questions later.\n\n"
