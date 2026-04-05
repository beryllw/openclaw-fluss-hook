#!/usr/bin/env bash
# ==========================================================================
# fluss-hook Plugin Installer (Self-Contained Release Package)
# ==========================================================================
#
# Installs the fluss-hook plugin into an existing OpenClaw instance.
# This script is bundled with the release package and does NOT require
# cloning the repository.
#
# Usage:
#   ./install.sh <openclaw-data-directory>
#   ./install.sh --bootstrap-servers fluss.prod:9123 ~/.openclaw
#   ./install.sh --force ~/.openclaw
#
# What this script does:
#   1. Copies plugin source files to <openclaw-data-dir>/plugins/fluss-hook/
#   2. Copies fluss-node native binary to the plugin's node_modules/
#   3. Prints the config snippet to add to openclaw.json
# ==========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_NAME="fluss-hook"

# ── Defaults ──────────────────────────────────────────────────
BOOTSTRAP_SERVERS="localhost:9123"
FLUSS_USERNAME=""
FLUSS_PASSWORD=""
FORCE=false
OPENCLAW_DATA_DIR=""

# ── Parse arguments ───────────────────────────────────────────
print_usage() {
  cat <<'USAGE'
Usage: install.sh [options] <openclaw-data-directory>

Installs the fluss-hook plugin into an existing OpenClaw instance.

Options:
  --bootstrap-servers <ADDR>   Fluss address for config snippet (default: localhost:9123)
  --username <USER>            Fluss SASL username (optional)
  --password <PASS>            Fluss SASL password (optional)
  --force                      Overwrite existing installation
  -h, --help                   Show this help

Examples:
  ./install.sh ~/.openclaw
  ./install.sh --bootstrap-servers 192.168.1.100:9123 ~/.openclaw
  ./install.sh --username admin --password secret --bootstrap-servers fluss.prod:9123 ~/.openclaw
  ./install.sh --force ~/.openclaw
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bootstrap-servers) BOOTSTRAP_SERVERS="$2"; shift 2 ;;
    --username)          FLUSS_USERNAME="$2"; shift 2 ;;
    --password)          FLUSS_PASSWORD="$2"; shift 2 ;;
    --force)             FORCE=true; shift ;;
    -h|--help)           print_usage; exit 0 ;;
    -*)                  echo "ERROR: Unknown option: $1" >&2; print_usage >&2; exit 1 ;;
    *)                   OPENCLAW_DATA_DIR="$1"; shift ;;
  esac
done

if [ -z "$OPENCLAW_DATA_DIR" ]; then
  echo "ERROR: OpenClaw data directory is required." >&2
  echo "" >&2
  print_usage >&2
  exit 1
fi

# ── Color helpers ─────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()   { echo -e "${GREEN}[ OK ]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Step 1: Verify package contents ──────────────────────────
echo ""
echo "=========================================="
echo "  fluss-hook Plugin Installer"
echo "=========================================="
echo ""

PLUGIN_SRC="$SCRIPT_DIR/plugin"
FLUSS_NODE_SRC="$SCRIPT_DIR/fluss-node"

ERRORS=0
if [ ! -d "$PLUGIN_SRC" ]; then
  err "plugin/ directory not found in package"
  ERRORS=$((ERRORS + 1))
fi
if [ ! -d "$FLUSS_NODE_SRC" ]; then
  err "fluss-node/ directory not found in package"
  ERRORS=$((ERRORS + 1))
fi
if [ ! -f "$PLUGIN_SRC/openclaw.plugin.json" ] 2>/dev/null; then
  err "plugin/openclaw.plugin.json not found"
  ERRORS=$((ERRORS + 1))
fi
if ! ls "$FLUSS_NODE_SRC/"*.node &>/dev/null 2>&1; then
  err "No .node binary found in fluss-node/"
  ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  err "Package appears incomplete. Please re-download from the Releases page."
  exit 1
fi
ok "Package contents verified"

# ── Step 2: Validate target directory ─────────────────────────
if [ ! -d "$OPENCLAW_DATA_DIR" ]; then
  # Auto-create if it looks like a reasonable path
  info "Directory does not exist, creating: $OPENCLAW_DATA_DIR"
  mkdir -p "$OPENCLAW_DATA_DIR"
fi

if ! touch "$OPENCLAW_DATA_DIR/.install-test" 2>/dev/null; then
  err "No write permission to: $OPENCLAW_DATA_DIR"
  exit 1
fi
rm -f "$OPENCLAW_DATA_DIR/.install-test"

PLUGIN_DIR="$OPENCLAW_DATA_DIR/plugins/$PLUGIN_NAME"

# ── Step 3: Check existing installation ───────────────────────
if [ -d "$PLUGIN_DIR" ] && [ -f "$PLUGIN_DIR/openclaw.plugin.json" ]; then
  if [ "$FORCE" != true ]; then
    err "Plugin already installed at: $PLUGIN_DIR"
    echo "    Use --force to overwrite."
    exit 1
  fi
  info "Existing installation found, will overwrite (--force)"
fi

# ── Step 4: Install plugin files ──────────────────────────────
info "Installing plugin to: $PLUGIN_DIR"

mkdir -p "$PLUGIN_DIR/src"

# Copy plugin source
cp "$PLUGIN_SRC/index.ts"              "$PLUGIN_DIR/"
cp "$PLUGIN_SRC/package.json"          "$PLUGIN_DIR/"
cp "$PLUGIN_SRC/tsconfig.json"         "$PLUGIN_DIR/"
cp "$PLUGIN_SRC/openclaw.plugin.json"  "$PLUGIN_DIR/"
cp "$PLUGIN_SRC/src/"*.ts              "$PLUGIN_DIR/src/"

ok "Plugin files copied"

# ── Step 5: Install fluss-node ────────────────────────────────
FLUSS_NODE_TARGET="$PLUGIN_DIR/node_modules/fluss-node"
mkdir -p "$PLUGIN_DIR/node_modules"

# Remove old installation
rm -rf "$FLUSS_NODE_TARGET"

# Copy (not symlink — package dir may be deleted after install)
cp -r "$FLUSS_NODE_SRC" "$FLUSS_NODE_TARGET"

ok "fluss-node installed"

# ── Step 6: Verify ────────────────────────────────────────────
echo ""
info "Verifying installation ..."

VERIFY_ERRORS=0
for f in index.ts openclaw.plugin.json package.json tsconfig.json \
         src/config.ts src/types.ts src/schema.ts src/event-mappers.ts \
         src/fluss-client.ts src/message-buffer.ts \
         node_modules/fluss-node/index.js; do
  if [ ! -f "$PLUGIN_DIR/$f" ]; then
    err "MISSING: $f"
    VERIFY_ERRORS=$((VERIFY_ERRORS + 1))
  fi
done

if ! ls "$FLUSS_NODE_TARGET/"*.node &>/dev/null; then
  err "MISSING: No .node native binary in node_modules/fluss-node/"
  VERIFY_ERRORS=$((VERIFY_ERRORS + 1))
fi

if [ "$VERIFY_ERRORS" -gt 0 ]; then
  echo ""
  err "Installation verification failed ($VERIFY_ERRORS missing files)."
  exit 1
fi

ok "All files verified"

# ── Step 7: Print config snippet ──────────────────────────────
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Installation complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "  Plugin installed to: $PLUGIN_DIR"
echo ""
echo "  Add the following to your openclaw.json"
echo "  (usually at $OPENCLAW_DATA_DIR/openclaw.json):"
echo ""
echo '  "plugins": {'
echo '    "load": {'
echo "      \"paths\": [\"$PLUGIN_DIR\"]"
echo '    },'
echo '    "entries": {'
echo '      "fluss-hook": {'
echo '        "enabled": true,'
echo '        "config": {'
echo "          \"bootstrapServers\": \"$BOOTSTRAP_SERVERS\""
if [ -n "$FLUSS_USERNAME" ] && [ -n "$FLUSS_PASSWORD" ]; then
  echo ",          \"username\": \"$FLUSS_USERNAME\""
  echo ",          \"password\": \"$FLUSS_PASSWORD\""
fi
echo '        }'
echo '      }'
echo '    }'
echo '  }'
echo ""
echo "  Then restart OpenClaw. You should see in the logs:"
echo '    [fluss-hook] Plugin registered (14 hooks)'
if [ -n "$FLUSS_USERNAME" ] && [ -n "$FLUSS_PASSWORD" ]; then
  echo "    [fluss-hook] Connected to Fluss at $BOOTSTRAP_SERVERS (SASL)"
else
  echo "    [fluss-hook] Connected to Fluss at $BOOTSTRAP_SERVERS"
fi
echo ""
