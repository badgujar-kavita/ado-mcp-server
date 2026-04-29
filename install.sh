#!/bin/bash

# ADO TestForge MCP Server - One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/badgujar-kavita/ado-mcp-server/main/install.sh | bash

set -e

# ══════════════════════════════════════════════════════════════
# Configuration
# ══════════════════════════════════════════════════════════════
INSTALL_DIR="$HOME/.ado-testforge-mcp"
REPO_URL="https://github.com/badgujar-kavita/ado-mcp-server.git"
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
    print_banner "${BOLD}🔄  Upgrading ADO TestForge MCP${NC}"
else
    print_banner "${BOLD}🚀  Installing ADO TestForge MCP${NC}"
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
print_tree_last "$(print_success "Node.js $(node -v)")"

# ══════════════════════════════════════════════════════════════
# Installation / Upgrade
# ══════════════════════════════════════════════════════════════
if [ "$IS_UPGRADE" = true ]; then
    # Check if existing folder is a git repo
    if [ -d "$INSTALL_DIR/.git" ]; then
        print_section "📥 Fetching Updates"
        print_tree_item "Pulling latest changes..."
        cd "$INSTALL_DIR"
        git pull --quiet
        print_tree_last "$(print_success "Source code updated")"
    else
        # Existing folder but not a git repo (old Google Drive install)
        print_section "📥 Migrating from Previous Installation"
        print_tree_item "Backing up credentials..."
        
        # Preserve credentials if they exist
        if [ -f "$INSTALL_DIR/credentials.json" ]; then
            cp "$INSTALL_DIR/credentials.json" "/tmp/ado-testforge-creds-backup.json"
            CREDS_BACKED_UP=true
        fi
        
        print_tree_item "Removing old installation..."
        rm -rf "$INSTALL_DIR"
        
        print_tree_item "Cloning fresh repository..."
        git clone --quiet "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
        
        # Restore credentials
        if [ "$CREDS_BACKED_UP" = true ]; then
            print_tree_item "Restoring credentials..."
            cp "/tmp/ado-testforge-creds-backup.json" "$INSTALL_DIR/credentials.json"
            rm -f "/tmp/ado-testforge-creds-backup.json"
        fi
        
        print_tree_last "$(print_success "Migration complete")"
    fi
else
    print_section "📥 Downloading"
    print_tree_item "Cloning repository..."
    git clone --quiet "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    print_tree_last "$(print_success "Repository cloned")"
fi

print_section "🔧 Building"
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
        config.mcpServers['ado-testforge'] = {
            command: 'node',
            args: ['$BOOTSTRAP_PATH']
        };
        fs.writeFileSync('$MCP_CONFIG', JSON.stringify(config, null, 2));
    "
else
    echo '{
  "mcpServers": {
    "ado-testforge": {
      "command": "node",
      "args": ["'"$BOOTSTRAP_PATH"'"]
    }
  }
}' > "$MCP_CONFIG"
fi
print_tree_last "$(print_success "Cursor configured")"

# ══════════════════════════════════════════════════════════════
# Credentials Setup
# ══════════════════════════════════════════════════════════════
CREDS_FILE="$INSTALL_DIR/credentials.json"

print_section "🔑 Credentials"
if [ ! -f "$CREDS_FILE" ]; then
    print_tree_item "Creating credentials template..."
    echo '{
  "ado_pat": "your-personal-access-token",
  "ado_org": "your-organization-name",
  "ado_project": "your-project-name",
  "confluence_base_url": "",
  "confluence_email": "",
  "confluence_api_token": ""
}' > "$CREDS_FILE"
    CREDS_CREATED=true
    print_tree_last "$(print_success "Template created")"
else
    print_tree_last "$(print_success "Existing credentials preserved")"
fi

# ══════════════════════════════════════════════════════════════
# Success Message
# ══════════════════════════════════════════════════════════════
echo ""
print_divider

if [ "$IS_UPGRADE" = true ]; then
    echo ""
    echo -e "  ${GREEN}${BOLD}✨ Upgrade Complete!${NC}"
    echo -e "  ${DIM}ADO TestForge MCP has been updated to the latest version.${NC}"
else
    echo ""
    echo -e "  ${GREEN}${BOLD}✨ Installation Complete!${NC}"
    echo -e "  ${DIM}ADO TestForge MCP has been installed successfully.${NC}"
fi

echo ""
print_divider
echo ""
echo -e "  ${BOLD}📍 Location:${NC} ${CYAN}${INSTALL_DIR}${NC}"

if [ "$CREDS_CREATED" = true ]; then
    echo ""
    print_divider
    echo ""
    echo -e "  ${YELLOW}${BOLD}⚠  Configure Credentials${NC}"
    echo ""
    echo -e "  ${BOLD}Option 1: Use the Configuration UI ${DIM}(Recommended)${NC}"
    echo -e "  ${DIM}└──${NC} Run ${CYAN}/ado-testforge/configure${NC} in Cursor's AI chat"
    echo -e "  ${DIM}   Opens a beautiful web UI with connection testing${NC}"
    echo ""
    echo -e "  ${BOLD}Option 2: Edit manually${NC}"
    echo -e "  ${DIM}└──${NC} Edit: ${CYAN}${CREDS_FILE}${NC}"
    echo ""
    echo -e "  ${DIM}Required fields:${NC}"
    echo -e "  ${DIM}├──${NC} ${BOLD}ado_pat${NC}      Azure DevOps Personal Access Token"
    echo -e "  ${DIM}├──${NC} ${BOLD}ado_org${NC}      Organization ${DIM}(dev.azure.com/{org})${NC}"
    echo -e "  ${DIM}└──${NC} ${BOLD}ado_project${NC}  Project name"
fi

echo ""
print_divider
echo ""
echo -e "  ${YELLOW}⚠  Restart Cursor IDE to activate${NC}"
echo ""
print_divider
echo ""
