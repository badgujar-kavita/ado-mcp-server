#!/bin/bash

# VortexADO MCP Server - One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/badgujar-kavita/ado-mcp-server/main/install.sh | bash

set -e

# ══════════════════════════════════════════════════════════════
# Configuration
# ══════════════════════════════════════════════════════════════
INSTALL_DIR="$HOME/.vortex-ado"
TARBALL_URL="https://github.com/badgujar-kavita/ado-mcp-server/archive/main.tar.gz"
IS_UPGRADE=false

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

print_pending() {
    echo -e "${BLUE}○${NC} $1"
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
# Pre-flight Checks
# ══════════════════════════════════════════════════════════════

# Detect install vs upgrade
if [ -d "$INSTALL_DIR" ]; then
    IS_UPGRADE=true
    print_banner "${BOLD}🔄  Upgrading VortexADO MCP${NC}"
else
    print_banner "${BOLD}🚀  Installing VortexADO MCP${NC}"
fi

print_section "📋 Pre-flight Checks"

# Check Node.js
print_tree_item "Checking Node.js..."
if ! command -v node &> /dev/null; then
    print_tree_last "$(print_error "Node.js not found")"
    echo ""
    echo -e "  ${YELLOW}Node.js 18+ is required.${NC}"
    echo -e "  ${DIM}Download: https://nodejs.org${NC}"
    echo ""
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_tree_last "$(print_error "Node.js 18+ required. Found: $(node -v)")"
    exit 1
fi

# Resolve the absolute path to node so Cursor's GUI process (which has a
# stripped PATH and does NOT source ~/.zshrc / ~/.bashrc) can launch the
# MCP server. Without this, nvm / asdf / Volta / Apple-Silicon-Homebrew
# users hit `spawn node ENOENT` when Cursor tries to start vortex-ado.
NODE_BIN="$(command -v node)"
print_tree_last "$(print_success "Node.js $(node -v) at $NODE_BIN")"

# ══════════════════════════════════════════════════════════════
# Installation / Upgrade
# ══════════════════════════════════════════════════════════════
print_section "📥 Downloading"

# On upgrade, blow away the old install — credentials live per-workspace
# (`<workspace>/.vortex-ado/config.json`) + OS keychain, so the installer
# directory has no user state to preserve. Any stale `credentials.json`
# placeholder gets cleaned up here too.
if [ "$IS_UPGRADE" = true ]; then
    print_tree_item "Removing old installation..."
    rm -rf "$INSTALL_DIR"
fi

# Download and extract tarball
print_tree_item "Downloading latest version..."
mkdir -p "$INSTALL_DIR"
curl -sL "$TARBALL_URL" | tar -xz --strip-components=1 -C "$INSTALL_DIR"

print_tree_last "$(print_success "Download complete")"

# ══════════════════════════════════════════════════════════════
# Building
# ══════════════════════════════════════════════════════════════
print_section "🔧 Building"
cd "$INSTALL_DIR"

print_tree_item "Installing dependencies..."
npm install --silent --no-fund --no-audit 2>/dev/null
print_tree_item "$(print_success "Dependencies installed")"

if [ -f "build-dist.mjs" ]; then
    print_tree_item "Compiling TypeScript..."
    npm run build:dist --silent > /dev/null 2>&1
    print_tree_last "$(print_success "Build complete")"
fi

# ══════════════════════════════════════════════════════════════
# Cursor Configuration
# ══════════════════════════════════════════════════════════════
print_section "⚙️  Configuring Cursor"
CURSOR_DIR="$HOME/.cursor"
MCP_CONFIG="$CURSOR_DIR/mcp.json"
BOOTSTRAP_PATH="$INSTALL_DIR/bin/bootstrap.mjs"

mkdir -p "$CURSOR_DIR"

print_tree_item "Updating MCP config..."
if [ -f "$MCP_CONFIG" ]; then
    node -e "
        const fs = require('fs');
        const config = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf-8'));
        config.mcpServers = config.mcpServers || {};
        config.mcpServers['vortex-ado'] = {
            command: '$NODE_BIN',
            args: ['$BOOTSTRAP_PATH']
        };
        fs.writeFileSync('$MCP_CONFIG', JSON.stringify(config, null, 2));
    "
else
    echo '{
  "mcpServers": {
    "vortex-ado": {
      "command": "'"$NODE_BIN"'",
      "args": ["'"$BOOTSTRAP_PATH"'"]
    }
  }
}' > "$MCP_CONFIG"
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
echo -e "  ${BOLD}📍 Location:${NC} ${CYAN}${INSTALL_DIR}${NC}"
echo ""
print_divider
echo ""
echo -e "  ${BOLD}🔑 Configure Credentials${NC}"
echo ""
echo -e "  ${DIM}└──${NC} Open your project folder in Cursor, then run ${CYAN}/vortex-ado/ado-connect${NC} in the AI chat."
echo -e "  ${DIM}   The wizard writes <workspace>/.vortex-ado/config.json and stores your PAT in the OS keychain.${NC}"
echo ""
print_divider
echo ""
echo -e "  ${YELLOW}⚠  Restart Cursor IDE to activate${NC}"
echo ""
print_divider
echo ""
