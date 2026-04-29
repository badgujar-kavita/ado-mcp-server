#!/bin/bash

# ADO TestForge MCP Server - One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/badgujar-kavita/ado-mcp-server/main/install.sh | bash

set -e

INSTALL_DIR="$HOME/.ado-testforge-mcp"
REPO_URL="https://github.com/badgujar-kavita/ado-mcp-server.git"

echo "🚀 Installing ADO TestForge MCP Server..."
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Remove old installation if exists
if [ -d "$INSTALL_DIR" ]; then
    echo "📦 Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull --quiet
else
    echo "📦 Downloading ADO TestForge MCP..."
    git clone --quiet "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install --silent --no-fund --no-audit

# Build distribution (uses esbuild)
if [ -f "build-dist.mjs" ]; then
    echo "🔨 Building distribution..."
    npm run build:dist --silent
fi

# Configure Cursor MCP
echo "⚙️  Configuring Cursor..."
CURSOR_DIR="$HOME/.cursor"
MCP_CONFIG="$CURSOR_DIR/mcp.json"
BOOTSTRAP_PATH="$INSTALL_DIR/bin/bootstrap.mjs"

mkdir -p "$CURSOR_DIR"

if [ -f "$MCP_CONFIG" ]; then
    # Update existing config using Node.js
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
    # Create new config
    echo '{
  "mcpServers": {
    "ado-testforge": {
      "command": "node",
      "args": ["'"$BOOTSTRAP_PATH"'"]
    }
  }
}' > "$MCP_CONFIG"
fi

# Create credentials directory
CREDS_DIR="$HOME/.ado-testforge-mcp"
CREDS_FILE="$CREDS_DIR/credentials.json"
mkdir -p "$CREDS_DIR"

if [ ! -f "$CREDS_FILE" ]; then
    echo '{
  "ado_pat": "your-personal-access-token",
  "ado_org": "your-organization-name",
  "ado_project": "your-project-name"
}' > "$CREDS_FILE"
    CREDS_CREATED=true
fi

echo ""
echo "══════════════════════════════════════════════════"
echo "🎉 Installation Complete!"
echo ""
echo "📍 Installed to: $INSTALL_DIR"
echo ""
if [ "$CREDS_CREATED" = true ]; then
    echo "⚠️  NEXT STEP: Configure your credentials"
    echo "   Edit: $CREDS_FILE"
    echo ""
    echo "   Fill in:"
    echo "   - ado_pat: Your Azure DevOps Personal Access Token"
    echo "   - ado_org: Your organization (from dev.azure.com/{org})"
    echo "   - ado_project: Your project name"
    echo ""
fi
echo "⚠️  Restart Cursor IDE to activate"
echo "══════════════════════════════════════════════════"
