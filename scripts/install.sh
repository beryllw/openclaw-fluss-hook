#!/usr/bin/env bash
# One-command installer for fluss-hook OpenClaw plugin.
#
# Downloads fluss-node (or uses a local copy), copies plugin files
# into the OpenClaw plugins directory, and prints the config snippet
# to add to openclaw.json.
#
# Usage:
#   ./scripts/install.sh <openclaw-data-dir>
#   ./scripts/install.sh --fluss-node-dir ./my-fluss-node ~/.openclaw
#   ./scripts/install.sh --bootstrap-servers fluss.prod:9223 ~/.openclaw
#
# Examples:
#   ./scripts/install.sh ~/.openclaw
#   ./scripts/install.sh --force ~/.openclaw
#   ./scripts/install.sh --fluss-node-dir demo/fluss-node-lib ~/.openclaw
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────
FLUSS_NODE_DIR=""
FLUSS_NODE_VERSION=""
FLUSS_NODE_BASE_URL=""
BOOTSTRAP_SERVERS="localhost:9223"
FLUSS_USERNAME=""
FLUSS_PASSWORD=""
FORCE=false
OPENCLAW_DATA_DIR=""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_NAME="fluss-hook"

# ── Parse arguments ───────────────────────────────────────────
print_usage() {
  echo "Usage: $(basename "$0") [options] <openclaw-data-directory>"
  echo ""
  echo "Options:"
  echo "  --fluss-node-dir <DIR>       Use existing fluss-node directory (skip download)"
  echo "  --version <VER>              fluss-node version for download"
  echo "  --base-url <URL>             Download base URL"
  echo "  --bootstrap-servers <ADDR>   Fluss address for config snippet (default: localhost:9223)"
  echo "  --username <USER>            Fluss SASL username (optional)"
  echo "  --password <PASS>            Fluss SASL password (optional)"
  echo "  --force                      Overwrite existing installation"
  echo "  -h, --help                   Show this help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fluss-node-dir)
      FLUSS_NODE_DIR="$2"; shift 2 ;;
    --version)
      FLUSS_NODE_VERSION="$2"; shift 2 ;;
    --base-url)
      FLUSS_NODE_BASE_URL="$2"; shift 2 ;;
    --bootstrap-servers)
      BOOTSTRAP_SERVERS="$2"; shift 2 ;;
    --username)
      FLUSS_USERNAME="$2"; shift 2 ;;
    --password)
      FLUSS_PASSWORD="$2"; shift 2 ;;
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

PLUGIN_DIR="$OPENCLAW_DATA_DIR/plugins/$PLUGIN_NAME"

# ── Step 2: Check existing installation ───────────────────────
if [ -d "$PLUGIN_DIR" ] && [ -f "$PLUGIN_DIR/openclaw.plugin.json" ]; then
  if [ "$FORCE" != true ]; then
    echo "ERROR: Plugin already installed at: $PLUGIN_DIR" >&2
    echo "Use --force to overwrite." >&2
    exit 1
  fi
  echo "Existing installation found, will overwrite (--force)."
fi

# ── Step 3: Obtain fluss-node ─────────────────────────────────
CLEANUP_FLUSS_NODE=false

if [ -n "$FLUSS_NODE_DIR" ]; then
  # Use user-provided directory
  if [ ! -d "$FLUSS_NODE_DIR" ]; then
    echo "ERROR: fluss-node directory does not exist: $FLUSS_NODE_DIR" >&2
    exit 1
  fi
  if [ ! -f "$FLUSS_NODE_DIR/index.js" ]; then
    echo "ERROR: Invalid fluss-node directory (index.js not found): $FLUSS_NODE_DIR" >&2
    exit 1
  fi
  # Resolve to absolute path
  FLUSS_NODE_DIR="$(cd "$FLUSS_NODE_DIR" && pwd)"
  echo "Using local fluss-node: $FLUSS_NODE_DIR"
  USE_SYMLINK=true
else
  # Download fluss-node
  echo "=== Downloading fluss-node ==="
  DOWNLOAD_DIR="$(mktemp -d "/tmp/fluss-node-install-XXXXXX")"
  CLEANUP_FLUSS_NODE=true
  trap 'if [ "$CLEANUP_FLUSS_NODE" = true ]; then rm -rf "$DOWNLOAD_DIR"; fi' EXIT

  DOWNLOAD_ARGS=()
  if [ -n "$FLUSS_NODE_VERSION" ]; then
    DOWNLOAD_ARGS+=(--version "$FLUSS_NODE_VERSION")
  fi
  if [ -n "$FLUSS_NODE_BASE_URL" ]; then
    DOWNLOAD_ARGS+=(--base-url "$FLUSS_NODE_BASE_URL")
  fi
  DOWNLOAD_ARGS+=(--force)

  "$SCRIPT_DIR/download-fluss-node.sh" "${DOWNLOAD_ARGS[@]}" "$DOWNLOAD_DIR"
  FLUSS_NODE_DIR="$DOWNLOAD_DIR"
  USE_SYMLINK=false
  echo ""
fi

# ── Step 4: Deploy plugin files ───────────────────────────────
echo "=== Installing plugin ==="
echo "  From: $PROJECT_ROOT"
echo "  To:   $PLUGIN_DIR"

mkdir -p "$PLUGIN_DIR/src"

# Copy plugin source files
cp "$PROJECT_ROOT/index.ts"              "$PLUGIN_DIR/"
cp "$PROJECT_ROOT/package.json"          "$PLUGIN_DIR/"
cp "$PROJECT_ROOT/tsconfig.json"         "$PLUGIN_DIR/"
cp "$PROJECT_ROOT/openclaw.plugin.json"  "$PLUGIN_DIR/"
cp "$PROJECT_ROOT/src/config.ts"         "$PLUGIN_DIR/src/"
cp "$PROJECT_ROOT/src/event-mappers.ts"  "$PLUGIN_DIR/src/"
cp "$PROJECT_ROOT/src/fluss-client.ts"   "$PLUGIN_DIR/src/"
cp "$PROJECT_ROOT/src/message-buffer.ts" "$PLUGIN_DIR/src/"
cp "$PROJECT_ROOT/src/schema.ts"         "$PLUGIN_DIR/src/"
cp "$PROJECT_ROOT/src/types.ts"          "$PLUGIN_DIR/src/"

echo "  Plugin files copied."

# ── Step 5: Install fluss-node ────────────────────────────────
FLUSS_NODE_TARGET="$PLUGIN_DIR/node_modules/fluss-node"
mkdir -p "$PLUGIN_DIR/node_modules"

# Remove old installation/symlink
rm -rf "$FLUSS_NODE_TARGET"

if [ "$USE_SYMLINK" = true ]; then
  # Create symlink to user-provided directory
  ln -s "$FLUSS_NODE_DIR" "$FLUSS_NODE_TARGET"
  echo "  fluss-node linked: $FLUSS_NODE_TARGET -> $FLUSS_NODE_DIR"
else
  # Move downloaded files directly
  mv "$FLUSS_NODE_DIR" "$FLUSS_NODE_TARGET"
  CLEANUP_FLUSS_NODE=false  # Don't clean up, it's been moved
  echo "  fluss-node installed to: $FLUSS_NODE_TARGET"
fi

# ── Step 6: Verify installation ───────────────────────────────
echo ""
echo "=== Verifying ==="

ERRORS=0
for f in index.ts openclaw.plugin.json package.json tsconfig.json \
         src/config.ts src/types.ts src/schema.ts src/event-mappers.ts \
         src/fluss-client.ts src/message-buffer.ts \
         node_modules/fluss-node/index.js; do
  if [ ! -f "$PLUGIN_DIR/$f" ]; then
    echo "  MISSING: $f" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

# Check for at least one .node binary
if ! ls "$FLUSS_NODE_TARGET/"*.node &>/dev/null; then
  echo "  MISSING: No .node native binary found in node_modules/fluss-node/" >&2
  ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "" >&2
  echo "ERROR: Installation verification failed ($ERRORS missing files)." >&2
  exit 1
fi

echo "  All files verified."

# ── Step 7: Print config snippet ──────────────────────────────
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
echo "Then restart OpenClaw. You should see in the logs:"
echo '  [fluss-hook] Plugin registered (14 hooks)'
if [ -n "$FLUSS_USERNAME" ] && [ -n "$FLUSS_PASSWORD" ]; then
  echo "  [fluss-hook] Connected to Fluss at $BOOTSTRAP_SERVERS (SASL)"
else
  echo "  [fluss-hook] Connected to Fluss at $BOOTSTRAP_SERVERS"
fi
