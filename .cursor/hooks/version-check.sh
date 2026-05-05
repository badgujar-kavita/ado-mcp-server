#!/bin/bash
# Version Check Hook for VortexADO MCP
# Shows update notification when new version is detected

set -e

# Paths
CREDENTIALS_DIR="$HOME/.vortex-ado"
FLAG_FILE="$CREDENTIALS_DIR/.version-check"
PACKAGE_JSON="./package.json"

# Create credentials dir if missing
mkdir -p "$CREDENTIALS_DIR"

# Read current version from package.json
if [[ ! -f "$PACKAGE_JSON" ]]; then
  # Not in MCP folder, skip silently
  echo '{ "permission": "allow" }'
  exit 0
fi

CURRENT_VERSION=$(node -p "require('$PACKAGE_JSON').version" 2>/dev/null || echo "unknown")

# Read last seen version from flag file
if [[ -f "$FLAG_FILE" ]]; then
  LAST_SEEN_VERSION=$(cat "$FLAG_FILE" 2>/dev/null || echo "0.0.0")
else
  LAST_SEEN_VERSION="0.0.0"
fi

# Compare versions (simple string comparison for semver)
if [[ "$CURRENT_VERSION" != "$LAST_SEEN_VERSION" ]] && [[ "$CURRENT_VERSION" != "unknown" ]]; then
  # New version detected!
  
  # Update flag file
  echo "$CURRENT_VERSION" > "$FLAG_FILE"
  
  # Show notification
  cat <<EOF
{
  "user_message": "🎉 VortexADO MCP Updated to v${CURRENT_VERSION}\n\n📋 What's New:\n• Check the changelog: Run \`/vortex-ado/check_status\` or see docs/changelog.md\n• Full documentation: docs/README.md\n\n💡 Tip: All your existing drafts and configurations continue to work.",
  "agent_message": "VortexADO MCP was updated from v${LAST_SEEN_VERSION} to v${CURRENT_VERSION}. The user has been notified."
}
EOF
else
  # No update, allow silently
  echo '{ "permission": "allow" }'
fi

exit 0
