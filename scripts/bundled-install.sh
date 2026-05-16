#!/bin/bash
#
# VortexADO MCP — installer (bundled with the release zip).
#
# Run this from inside the extracted release folder:
#
#   cd ~/Downloads/vortex-ado-vX.Y.Z-YYYY-MM-DD/
#   bash install.sh
#
# The script auto-detects the tarball sitting next to it (vortex-ado.tar.gz).
# You can also point at a tarball elsewhere by passing the path:
#
#   bash install.sh /path/to/vortex-ado.tar.gz
#
# After install, restart Cursor and run /vortex-ado/ado-connect to configure
# credentials per workspace.

set -euo pipefail

# ══ Resolve the tarball ══════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -ge 1 ]]; then
  TARBALL_SOURCE="$1"
else
  # Auto-detect: prefer the canonical name, fall back to any *.tar.gz next to
  # the script (handy if a user renames the file).
  if [[ -f "$SCRIPT_DIR/vortex-ado.tar.gz" ]]; then
    TARBALL_SOURCE="$SCRIPT_DIR/vortex-ado.tar.gz"
  else
    CANDIDATES=("$SCRIPT_DIR"/*.tar.gz)
    if [[ ${#CANDIDATES[@]} -eq 1 && -f "${CANDIDATES[0]}" ]]; then
      TARBALL_SOURCE="${CANDIDATES[0]}"
    else
      cat >&2 <<EOF
Could not find vortex-ado.tar.gz next to this script.

Options:
  1. Run from the extracted release folder (it contains both install.sh and
     vortex-ado.tar.gz):
       cd <extracted-folder> && bash install.sh
  2. Pass the tarball path explicitly:
       bash install.sh /path/to/vortex-ado.tar.gz
EOF
      exit 1
    fi
  fi
fi

# ══ Paths ════════════════════════════════════════════════════════════════════

INSTALL_DIR="$HOME/.vortex-ado"
CURSOR_DIR="$HOME/.cursor"
MCP_CONFIG="$CURSOR_DIR/mcp.json"
TMP_DIR="$(mktemp -d -t vortex-ado-install-XXXXXX)"
TMP_TARBALL="$TMP_DIR/vortex-ado.tar.gz"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# ══ Colors ═══════════════════════════════════════════════════════════════════

if [[ -t 1 ]]; then
  BOLD='\033[1m' GREEN='\033[0;32m' YELLOW='\033[0;33m' CYAN='\033[0;36m' RED='\033[0;31m' NC='\033[0m'
else
  BOLD='' GREEN='' YELLOW='' CYAN='' RED='' NC=''
fi

info() { printf "${CYAN}==>${NC} %s\n" "$1"; }
ok()   { printf "${GREEN}✓${NC}   %s\n" "$1"; }
warn() { printf "${YELLOW}⚠${NC}   %s\n" "$1"; }
err()  { printf "${RED}✗${NC}   %s\n" "$1" >&2; }

# ══ Step 1: prerequisites ═══════════════════════════════════════════════════

info "Checking prerequisites..."

if ! command -v node >/dev/null 2>&1; then
  err "Node.js not found. Install Node 18+ from https://nodejs.org/ before continuing."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if (( NODE_MAJOR < 18 )); then
  err "Node.js v18+ required. You have $(node -v). Update before continuing."
  exit 1
fi

NODE_BIN="$(command -v node)"
ok "Node.js $(node -v) at $NODE_BIN"

# ══ Step 2: locate / fetch tarball ═══════════════════════════════════════════

if [[ "$TARBALL_SOURCE" =~ ^https?:// ]]; then
  info "Downloading tarball from URL..."
  if ! curl -fsSL --output "$TMP_TARBALL" "$TARBALL_SOURCE"; then
    err "Download failed. Check the URL and your network."
    exit 1
  fi
  ok "Tarball downloaded"
elif [[ -f "$TARBALL_SOURCE" ]]; then
  info "Using local tarball: $TARBALL_SOURCE"
  cp "$TARBALL_SOURCE" "$TMP_TARBALL"
else
  err "Tarball not found: $TARBALL_SOURCE"
  exit 1
fi

# Sanity check — the file should be a valid gzipped tar.
if ! tar -tzf "$TMP_TARBALL" >/dev/null 2>&1; then
  err "File is not a valid gzipped tar archive: $TMP_TARBALL"
  err "If you got this from Google Drive, the download may have hit the"
  err "virus-scan interstitial — open the share link in a browser, click"
  err "'Download anyway', save the file locally, then re-run this script."
  exit 1
fi
ok "Tarball verified"

# ══ Step 3: install ══════════════════════════════════════════════════════════

# Detect upgrade vs fresh install. Per-workspace configs at
# <project>/.vortex-ado/config.json are NOT touched by this script — they
# live alongside user projects, not in INSTALL_DIR.
IS_UPGRADE=false
if [[ -d "$INSTALL_DIR" ]]; then
  IS_UPGRADE=true
  info "Existing install detected at $INSTALL_DIR — will replace runtime files."
  rm -rf "$INSTALL_DIR"
fi

info "Extracting tarball into $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
# release.sh tars contents-of-dist-package, so a flat extract is correct.
tar -xzf "$TMP_TARBALL" -C "$INSTALL_DIR"
ok "Files extracted"

# ══ Step 4: install runtime deps ═════════════════════════════════════════════

cd "$INSTALL_DIR"

info "Installing runtime dependencies (npm install)..."
if ! npm install --silent --no-fund --no-audit; then
  err "npm install failed. Run 'cd $INSTALL_DIR && npm install' to see why."
  exit 1
fi
ok "Dependencies installed"

# ══ Step 5: register MCP in Cursor ═══════════════════════════════════════════

info "Registering MCP in Cursor..."
mkdir -p "$CURSOR_DIR"
BOOTSTRAP_PATH="$INSTALL_DIR/bin/bootstrap.mjs"

if [[ -f "$MCP_CONFIG" ]]; then
  # Existing config — preserve other servers, upsert vortex-ado.
  node -e "
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf-8'));
    config.mcpServers = config.mcpServers || {};
    config.mcpServers['vortex-ado'] = {
      command: '$NODE_BIN',
      args: ['$BOOTSTRAP_PATH']
    };
    fs.writeFileSync('$MCP_CONFIG', JSON.stringify(config, null, 2) + '\n');
  "
else
  cat > "$MCP_CONFIG" <<EOF
{
  "mcpServers": {
    "vortex-ado": {
      "command": "$NODE_BIN",
      "args": ["$BOOTSTRAP_PATH"]
    }
  }
}
EOF
fi
ok "Registered in $MCP_CONFIG"

# ══ Step 6: success message ══════════════════════════════════════════════════

MODE="$([ "$IS_UPGRADE" = true ] && echo upgrade || echo "fresh install")"

printf "\n%b%b✨ VortexADO MCP installed.%b\n\n" "$BOLD" "$GREEN" "$NC"
printf "  Install dir: %s\n" "$INSTALL_DIR"
printf "  Cursor MCP:  %s\n" "$MCP_CONFIG"
printf "  Mode:        %s\n\n" "$MODE"

printf "%bNext steps:%b\n\n" "$BOLD" "$NC"
printf "  1. Restart Cursor IDE (Cmd+Q, then relaunch).\n"
printf "     Cursor doesn't auto-restart MCPs — closing the window isn't enough.\n\n"
printf "  2. Open your project folder in Cursor.\n\n"
printf "  3. In the AI chat, run:\n"
printf "       /vortex-ado/ado-connect\n\n"
printf "     The two-tab wizard saves connection details to\n"
printf "     <workspace>/.vortex-ado/config.json and stores your PAT + Confluence\n"
printf "     token in the OS keychain. Nothing in plaintext on disk.\n\n"
printf "  4. Verify with:\n"
printf "       /vortex-ado/ado-check\n\n"

printf "%bGot more than one ADO project?%b\n" "$BOLD" "$NC"
printf "  Open each project in its own Cursor window and run /vortex-ado/ado-connect\n"
printf "  per workspace. Configs and keychain entries stay isolated per project.\n\n"
