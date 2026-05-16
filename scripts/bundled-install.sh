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
# You can also point at a tarball elsewhere by passing the path or URL:
#
#   bash install.sh /path/to/vortex-ado.tar.gz
#   bash install.sh https://example.com/vortex-ado.tar.gz
#
# After install, restart Cursor and run /vortex-ado/ado-connect to configure
# credentials per workspace.

set -euo pipefail

# ══════════════════════════════════════════════════════════════
# Configuration
# ══════════════════════════════════════════════════════════════
INSTALL_DIR="$HOME/.vortex-ado"
CURSOR_DIR="$HOME/.cursor"
MCP_CONFIG="$CURSOR_DIR/mcp.json"
IS_UPGRADE=false

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d -t vortex-ado-install-XXXXXX)"
TMP_TARBALL="$TMP_DIR/vortex-ado.tar.gz"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# ══════════════════════════════════════════════════════════════
# Colors & Formatting
# ══════════════════════════════════════════════════════════════
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# ══════════════════════════════════════════════════════════════
# Helper Functions
# ══════════════════════════════════════════════════════════════
print_banner() {
    local text="$1"
    echo ""
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo -e "   ${text}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo ""
}

print_section() {
    echo ""
    echo -e "${BOLD}$1${NC}"
}

print_tree_item() {
    echo -e "  ${DIM}├──${NC} $1"
}

print_tree_last() {
    echo -e "  ${DIM}└──${NC} $1"
}

print_success() {
    echo -e "${GREEN}✔${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC}  $1"
}

print_error() {
    echo -e "${RED}✖${NC} $1"
}

print_divider() {
    echo -e "${DIM}─────────────────────────────────────────────────────────────${NC}"
}

# ══════════════════════════════════════════════════════════════
# Banner — install vs upgrade
# ══════════════════════════════════════════════════════════════
if [ -d "$INSTALL_DIR" ]; then
    IS_UPGRADE=true
    print_banner "${BOLD}🔄  Upgrading VortexADO MCP${NC}"
else
    print_banner "${BOLD}🚀  Installing VortexADO MCP${NC}"
fi

# ══════════════════════════════════════════════════════════════
# Pre-flight Checks
# ══════════════════════════════════════════════════════════════
print_section "📋 Pre-flight Checks"

# Check Node.js
print_tree_item "Checking Node.js..."
if ! command -v node >/dev/null 2>&1; then
    print_tree_last "$(print_error "Node.js not found")"
    echo ""
    echo -e "  ${YELLOW}Node.js 18+ is required.${NC}"
    echo -e "  ${DIM}Download: https://nodejs.org${NC}"
    echo ""
    exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if (( NODE_MAJOR < 18 )); then
    print_tree_last "$(print_error "Node.js 18+ required. Found: $(node -v)")"
    exit 1
fi

# Resolve the absolute path to node so Cursor's GUI process (which has a
# stripped PATH and does NOT source ~/.zshrc / ~/.bashrc) can launch the
# MCP server. Without this, nvm / asdf / Volta / Apple-Silicon-Homebrew
# users hit `spawn node ENOENT` when Cursor tries to start vortex-ado.
NODE_BIN="$(command -v node)"
print_tree_item "$(print_success "Node.js $(node -v) at $NODE_BIN")"

# Locate the tarball
print_tree_item "Locating release tarball..."
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
            print_tree_last "$(print_error "Could not find vortex-ado.tar.gz next to this script")"
            echo ""
            echo -e "  ${YELLOW}Options:${NC}"
            echo -e "  ${DIM}├──${NC} Run from the extracted release folder:"
            echo -e "  ${DIM}│      ${NC}${CYAN}cd <extracted-folder> && bash install.sh${NC}"
            echo -e "  ${DIM}└──${NC} Pass the tarball path explicitly:"
            echo -e "         ${CYAN}bash install.sh /path/to/vortex-ado.tar.gz${NC}"
            echo ""
            exit 1
        fi
    fi
fi
print_tree_last "$(print_success "Tarball source: $TARBALL_SOURCE")"

# ══════════════════════════════════════════════════════════════
# Extracting
# ══════════════════════════════════════════════════════════════
print_section "📥 Extracting"

# Fetch (or copy) the tarball into the temp dir.
if [[ "$TARBALL_SOURCE" =~ ^https?:// ]]; then
    print_tree_item "Downloading tarball from URL..."
    if ! curl -fsSL --output "$TMP_TARBALL" "$TARBALL_SOURCE"; then
        print_tree_last "$(print_error "Download failed. Check the URL and your network.")"
        exit 1
    fi
elif [[ -f "$TARBALL_SOURCE" ]]; then
    print_tree_item "Copying local tarball to temp dir..."
    cp "$TARBALL_SOURCE" "$TMP_TARBALL"
else
    print_tree_last "$(print_error "Tarball not found: $TARBALL_SOURCE")"
    exit 1
fi

# Sanity check — the file should be a valid gzipped tar.
print_tree_item "Verifying archive..."
if ! tar -tzf "$TMP_TARBALL" >/dev/null 2>&1; then
    print_tree_last "$(print_error "Not a valid gzipped tar archive")"
    echo ""
    echo -e "  ${YELLOW}If you got this from Google Drive, the download may have hit the${NC}"
    echo -e "  ${YELLOW}virus-scan interstitial. Open the share link in a browser, click${NC}"
    echo -e "  ${YELLOW}'Download anyway', save the file locally, then re-run this script.${NC}"
    echo ""
    exit 1
fi

# Per-workspace configs at <project>/.vortex-ado/config.json are NOT touched
# by this script — they live alongside user projects, not in INSTALL_DIR.
if [ "$IS_UPGRADE" = true ]; then
    print_tree_item "Removing old installation..."
    rm -rf "$INSTALL_DIR"
fi

print_tree_item "Extracting into $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
# release.sh tars contents-of-dist-package, so a flat extract is correct.
tar -xzf "$TMP_TARBALL" -C "$INSTALL_DIR"
print_tree_last "$(print_success "Files extracted")"

# ══════════════════════════════════════════════════════════════
# Building
# ══════════════════════════════════════════════════════════════
print_section "🔧 Building"
cd "$INSTALL_DIR"

print_tree_item "Installing dependencies..."
if ! npm install --silent --no-fund --no-audit; then
    print_tree_last "$(print_error "npm install failed")"
    echo ""
    echo -e "  ${YELLOW}Run the following to see the full error:${NC}"
    echo -e "  ${CYAN}cd $INSTALL_DIR && npm install${NC}"
    echo ""
    exit 1
fi
print_tree_last "$(print_success "Dependencies installed")"

# ══════════════════════════════════════════════════════════════
# Cursor Configuration
# ══════════════════════════════════════════════════════════════
print_section "⚙️  Configuring Cursor"
BOOTSTRAP_PATH="$INSTALL_DIR/bin/bootstrap.mjs"

mkdir -p "$CURSOR_DIR"

print_tree_item "Updating MCP config..."
if [ -f "$MCP_CONFIG" ]; then
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
print_tree_last "$(print_success "Cursor configured")"

# ══════════════════════════════════════════════════════════════
# Success Message
# ══════════════════════════════════════════════════════════════
echo ""
print_divider

if [ "$IS_UPGRADE" = true ]; then
    echo ""
    echo -e "  ${GREEN}${BOLD}✨ Upgrade Complete!${NC}"
    echo -e "  ${DIM}VortexADO MCP has been updated to the latest version.${NC}"
else
    echo ""
    echo -e "  ${GREEN}${BOLD}✨ Installation Complete!${NC}"
    echo -e "  ${DIM}VortexADO MCP has been installed successfully.${NC}"
fi

echo ""
print_divider
echo ""
echo -e "  ${BOLD}📍 Install dir:${NC} ${CYAN}${INSTALL_DIR}${NC}"
echo -e "  ${BOLD}🛠  Cursor MCP:${NC}  ${CYAN}${MCP_CONFIG}${NC}"

echo ""
print_divider
echo ""
echo -e "  ${BOLD}Next steps${NC}"
echo ""
echo -e "  ${DIM}1.${NC} ${BOLD}Restart Cursor IDE${NC} ${DIM}(Cmd+Q, then relaunch)${NC}"
echo -e "     ${DIM}Cursor doesn't auto-restart MCPs — closing the window isn't enough.${NC}"
echo ""
echo -e "  ${DIM}2.${NC} Open your project folder in Cursor."
echo ""
echo -e "  ${DIM}3.${NC} In the AI chat, run:"
echo -e "       ${CYAN}/vortex-ado/ado-connect${NC}"
echo -e "     ${DIM}The two-tab wizard saves connection details to${NC}"
echo -e "     ${DIM}<workspace>/.vortex-ado/config.json and stores your PAT + Confluence${NC}"
echo -e "     ${DIM}token in the OS keychain. Nothing in plaintext on disk.${NC}"
echo ""
echo -e "  ${DIM}4.${NC} Verify with:"
echo -e "       ${CYAN}/vortex-ado/ado-check${NC}"

echo ""
print_divider
echo ""
echo -e "  ${BOLD}💡 Got more than one ADO project?${NC}"
echo -e "  ${DIM}Open each project in its own Cursor window and run /vortex-ado/ado-connect${NC}"
echo -e "  ${DIM}per workspace. Configs and keychain entries stay isolated per project.${NC}"
echo ""
print_divider
echo ""
