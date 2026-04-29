#!/bin/bash

# ADO TestForge MCP Server - Uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/badgujar-kavita/ado-mcp-server/main/uninstall.sh | bash

set -e

INSTALL_DIR="$HOME/.ado-testforge-mcp"
CREDS_DIR="$HOME/.ado-testforge-mcp"
MCP_CONFIG="$HOME/.cursor/mcp.json"

echo "🗑️  Uninstalling ADO TestForge MCP Server..."
echo ""

# Remove from Cursor config
if [ -f "$MCP_CONFIG" ]; then
    node -e "
        const fs = require('fs');
        try {
            const config = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf-8'));
            if (config.mcpServers && config.mcpServers['ado-testforge']) {
                delete config.mcpServers['ado-testforge'];
                fs.writeFileSync('$MCP_CONFIG', JSON.stringify(config, null, 2));
                console.log('✅ Removed from Cursor MCP config');
            }
        } catch (e) {
            console.log('⚠️  Could not update mcp.json');
        }
    "
fi

# Remove installation directory
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    echo "✅ Removed installation directory"
else
    echo "ℹ️  Installation directory not found"
fi

# Ask about credentials
echo ""
read -p "Remove credentials file ($CREDS_DIR/credentials.json)? [y/N] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$CREDS_DIR"
    echo "✅ Removed credentials"
else
    echo "ℹ️  Credentials preserved at $CREDS_DIR"
fi

echo ""
echo "🎉 Uninstallation complete!"
echo "⚠️  Please restart Cursor IDE"
