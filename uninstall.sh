#!/bin/bash

# VortexADO MCP Server - Uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/badgujar-kavita/ado-mcp-server/main/uninstall.sh | bash

set -e

INSTALL_DIR="$HOME/.vortex-ado"
MCP_CONFIG="$HOME/.cursor/mcp.json"

echo "🗑️  Uninstalling VortexADO MCP Server..."
echo ""

# Remove from Cursor config
if [ -f "$MCP_CONFIG" ]; then
    node -e "
        const fs = require('fs');
        try {
            const config = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf-8'));
            if (config.mcpServers && config.mcpServers['vortex-ado']) {
                delete config.mcpServers['vortex-ado'];
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

# Credentials note: nothing to clean up here. PATs live in the OS
# keychain (service "vortex-ado", account "ado::{org}::{project}") and
# per-workspace config lives in each project's `.vortex-ado/` folder.
# Removing those is intentionally a manual decision — they may be
# shared with another tool or with a re-installed VortexADO.
echo ""
echo "ℹ️  Per-workspace configs at <project>/.vortex-ado/ and OS keychain"
echo "   entries (service: vortex-ado) were NOT removed. Delete them"
echo "   manually if you want a fully clean slate."

echo ""
echo "🎉 Uninstallation complete!"
echo "⚠️  Please restart Cursor IDE"
