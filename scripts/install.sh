#!/usr/bin/env bash
# Installer for fluss-hook OpenClaw plugin.
#
# Copies plugin source files into the OpenClaw plugins directory
# and prints the config snippet to add to openclaw.json.
#
# No native binaries required — the plugin uses Fluss Gateway REST API.
#
# Usage:
#   ./scripts/install.sh <openclaw-data-dir>
#   ./scripts/install.sh --gateway-url http://fluss-gateway:8080 ~/.openclaw
#
# Examples:
#   ./scripts/install.sh ~/.openclaw
#   ./scripts/install.sh --force ~/.openclaw
#   ./scripts/install.sh --gateway-url http://192.168.1.100:8080 ~/.openclaw
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────
GATEWAY_URL=""
FORCE=false
OPENCLAW_DATA_DIR=""

# Determine project root:
# - When running from repo: script is in scripts/, project root is ..
# - When running from release package: script is in root, project root is .
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/index.ts" ]; then
  PROJECT_ROOT="$SCRIPT_DIR"  # release package (script in root)
else
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"  # in repo (script in scripts/)
fi
PLUGIN_NAME="fluss-hook"

# ── Parse arguments ───────────────────────────────────────────
print_usage() {
  echo "Usage: $(basename "$0") [options] <openclaw-data-directory>"
  echo ""
  echo "Options:"
  echo "  --gateway-url <URL>        Fluss Gateway REST API URL for config snippet"
  echo "  --force                    Overwrite existing installation"
  echo "  -h, --help                 Show this help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gateway-url)
      GATEWAY_URL="$2"; shift 2 ;;
    --force)
      FORCE=true; shift ;;
    -h|--help)
      print_usage; exit 0 ;;
    -*)
      echo "ERROR: Unknown option: $1" >&2
      print_usage >&2; exit 1 ;;
    *)
      OPENCLAW_DATA_DIR="$1"; shift ;;
  esac
done

if [ -z "$OPENCLAW_DATA_DIR" ]; then
  echo "ERROR: OpenClaw data directory is required." >&2
  echo "" >&2
  print_usage >&2
  exit 1
fi

# ── Step 1: Validate target directory ─────────────────────────
if [ ! -d "$OPENCLAW_DATA_DIR" ]; then
  echo "ERROR: Directory does not exist: $OPENCLAW_DATA_DIR" >&2
  echo "Please provide the path to your OpenClaw data directory." >&2
  exit 1
fi

# Test write permission
if ! touch "$OPENCLAW_DATA_DIR/.install-test" 2>/dev/null; then
  echo "ERROR: No write permission to: $OPENCLAW_DATA_DIR" >&2
  exit 1
fi
rm -f "$OPENCLAW_DATA_DIR/.install-test"

PLUGIN_DIR="$OPENCLAW_DATA_DIR/extensions/$PLUGIN_NAME"

# ── Step 2: Check existing installation ───────────────────────
if [ -d "$PLUGIN_DIR" ] && [ -f "$PLUGIN_DIR/openclaw.plugin.json" ]; then
  if [ "$FORCE" != true ]; then
    echo "ERROR: Plugin already installed at: $PLUGIN_DIR" >&2
    echo "Use --force to overwrite." >&2
    exit 1
  fi
  echo "Existing installation found, will overwrite (--force)."
fi

# ── Step 3: Deploy plugin files ───────────────────────────────
echo "=== Installing plugin ==="
echo "  From: $PROJECT_ROOT"
echo "  To:   $PLUGIN_DIR"

mkdir -p "$PLUGIN_DIR/src"

# Copy plugin source files
cp "$PROJECT_ROOT/index.ts"              "$PLUGIN_DIR/"
cp "$PROJECT_ROOT/package.json"          "$PLUGIN_DIR/"
cp "$PROJECT_ROOT/tsconfig.json"         "$PLUGIN_DIR/"
cp "$PROJECT_ROOT/openclaw.plugin.json"  "$PLUGIN_DIR/"
cp "$PROJECT_ROOT/src/sink.ts"             "$PLUGIN_DIR/src/"
cp "$PROJECT_ROOT/src/config.ts"         "$PLUGIN_DIR/src/"
cp "$PROJECT_ROOT/src/event-mappers.ts"  "$PLUGIN_DIR/src/"
cp "$PROJECT_ROOT/src/fluss-client.ts"   "$PLUGIN_DIR/src/"
cp "$PROJECT_ROOT/src/message-buffer.ts" "$PLUGIN_DIR/src/"
cp "$PROJECT_ROOT/src/schema.ts"         "$PLUGIN_DIR/src/"
cp "$PROJECT_ROOT/src/types.ts"          "$PLUGIN_DIR/src/"

echo "  Plugin files copied."

# ── Step 4: Verify installation ───────────────────────────────
echo ""
echo "=== Verifying ==="

ERRORS=0
for f in index.ts openclaw.plugin.json package.json tsconfig.json \
         src/sink.ts src/config.ts src/types.ts src/schema.ts src/event-mappers.ts \
         src/fluss-client.ts src/message-buffer.ts; do
  if [ ! -f "$PLUGIN_DIR/$f" ]; then
    echo "  MISSING: $f" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo "" >&2
  echo "ERROR: Installation verification failed ($ERRORS missing files)." >&2
  exit 1
fi

echo "  All files verified."

# ── Step 5: Print config snippet ──────────────────────────────
echo ""
echo "============================================================"
echo "  Installation complete!"
echo "  Plugin: $PLUGIN_DIR"
echo "============================================================"
echo ""
echo "Add the following to your openclaw.json:"
echo ""
echo '  "plugins": {'
echo '    "entries": {'
echo '      "fluss-hook": {'
echo '        "enabled": true,'
echo '        "config": {'
if [ -n "$GATEWAY_URL" ]; then
  echo "          \"gatewayUrl\": \"$GATEWAY_URL\""
else
  echo "          \"gatewayUrl\": \"http://localhost:8080\""
fi
echo '        }'
echo '      }'
echo '    }'
echo '  }'
echo ""
echo "Then restart OpenClaw. You should see in the logs:"
echo "  [fluss-hook] Plugin registered (14 hooks)"
