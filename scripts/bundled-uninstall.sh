#!/bin/bash
#
# VortexADO MCP — uninstaller (bundled with the release zip).
#
# Removes the MCP from your machine. Always asks for confirmation before
# touching anything. Per-workspace configs at <your-project>/.vortex-ado/
# are NEVER touched — those live alongside your projects and the
# uninstaller has no way to know where they are.
#
# Usage:
#   bash uninstall.sh

set -euo pipefail

# ══ Paths ════════════════════════════════════════════════════════════════════

INSTALL_DIR="$HOME/.vortex-ado"
CURSOR_DIR="$HOME/.cursor"
MCP_CONFIG="$CURSOR_DIR/mcp.json"

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

# Read a y/n answer, defaulting to "no". Returns 0 for yes, 1 for no.
ask_yes_no() {
  local prompt="$1"
  local default="${2:-N}"
  local hint
  if [[ "$default" == "Y" ]]; then hint="[Y/n]"; else hint="[y/N]"; fi

  local reply
  printf "%s %s " "$prompt" "$hint"
  read -r reply </dev/tty
  reply="${reply:-$default}"
  case "$reply" in
    [Yy]|[Yy][Ee][Ss]) return 0 ;;
    *) return 1 ;;
  esac
}

# ══ Step 1: top-level confirmation ═══════════════════════════════════════════

printf "%bVortexADO MCP — Uninstaller%b\n\n" "$BOLD" "$NC"
printf "This will remove:\n"
printf "  - %s (the MCP install dir)\n" "$INSTALL_DIR"
printf "  - The vortex-ado entry in %s\n" "$MCP_CONFIG"
printf "\n"
printf "It will NOT touch:\n"
printf "  - <your-project>/.vortex-ado/config.json files in your workspaces\n"
printf "    (delete those manually if you no longer want them)\n"
printf "\n"

if ! ask_yes_no "Proceed with uninstall?" "N"; then
  echo "Cancelled."
  exit 0
fi

# ══ Step 2: remove the MCP install dir ═══════════════════════════════════════

if [[ -d "$INSTALL_DIR" ]]; then
  info "Removing $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR"
  ok "Install dir removed"
else
  warn "Install dir not found at $INSTALL_DIR (already gone — skipping)"
fi

# ══ Step 3: remove the Cursor MCP entry ══════════════════════════════════════

if [[ -f "$MCP_CONFIG" ]]; then
  if grep -q '"vortex-ado"' "$MCP_CONFIG"; then
    info "Removing vortex-ado entry from $MCP_CONFIG..."
    # Use node to do the edit safely — preserves other MCP entries (jira, etc.)
    # and won't truncate the file if the JSON is non-trivial.
    node -e "
      const fs = require('fs');
      try {
        const config = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf-8'));
        if (config.mcpServers && config.mcpServers['vortex-ado']) {
          delete config.mcpServers['vortex-ado'];
          fs.writeFileSync('$MCP_CONFIG', JSON.stringify(config, null, 2) + '\n');
          process.exit(0);
        }
        process.exit(2);
      } catch (e) {
        console.error('Failed to update MCP config:', e.message);
        process.exit(1);
      }
    " && ok "Cursor MCP entry removed" || warn "Could not edit $MCP_CONFIG cleanly (file may be malformed). Open it and remove the vortex-ado key manually."
  else
    warn "No vortex-ado entry in $MCP_CONFIG (already gone — skipping)"
  fi
else
  warn "Cursor MCP config not found at $MCP_CONFIG (skipping)"
fi

# ══ Step 4: optional — keychain cleanup (interactive prompt) ═════════════════

printf "\n"
printf "%bKeychain entries%b\n" "$BOLD" "$NC"
printf "Your stored ADO PAT and Confluence API token live in the OS keychain\n"
printf "under the service name 'vortex-ado'. Removing them is optional —\n"
printf "they don't take up meaningful space and can't be used by anything\n"
printf "without the MCP. They DO contain real credentials, though.\n\n"

# Detect macOS for the security command path. Linux/Windows users get a
# manual instruction since libsecret / Credential Manager don't have a
# uniform CLI.
PLATFORM="$(uname)"

if ask_yes_no "Also delete vortex-ado keychain entries?" "N"; then
  case "$PLATFORM" in
    Darwin)
      info "Searching macOS Keychain for vortex-ado entries..."
      # The `security` CLI deletes one entry per call. Loop until none remain.
      DELETED=0
      while security find-generic-password -s vortex-ado >/dev/null 2>&1; do
        if security delete-generic-password -s vortex-ado >/dev/null 2>&1; then
          DELETED=$((DELETED + 1))
        else
          break
        fi
      done
      if [[ $DELETED -gt 0 ]]; then
        ok "Removed $DELETED keychain entries"
      else
        warn "No vortex-ado entries found in keychain"
      fi
      ;;
    Linux)
      warn "Automated keychain cleanup is not implemented for Linux."
      printf "Open Seahorse / GNOME Keyring or KWallet and search for 'vortex-ado'.\n"
      ;;
    *)
      warn "Automated keychain cleanup is not implemented for $PLATFORM."
      printf "Open Windows Credential Manager and search for 'vortex-ado'.\n"
      ;;
  esac
else
  printf "  Keychain entries left in place. To remove later (macOS):\n"
  printf "    security delete-generic-password -s vortex-ado\n"
  printf "  Run repeatedly until 'SecKeychainSearchCopyNext' reports none found.\n"
fi

# ══ Step 5: done ═════════════════════════════════════════════════════════════

printf "\n%b%b✓ Uninstall complete.%b\n" "$BOLD" "$GREEN" "$NC"
printf "Restart Cursor (Cmd+Q + relaunch) to drop the MCP from its server list.\n\n"
