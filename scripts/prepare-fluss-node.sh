#!/usr/bin/env bash
# Prepare fluss-node for Docker builds by extracting pre-compiled zip
# and generating Node.js wrapper files.
#
# Input:  fluss-node-lib/bindings-linux-x64-gnu.zip (pre-compiled native addon)
# Output: fluss-node-lib/linux-x64-gnu/  (ready-to-use Node.js package)
#
# Usage:
#   ./scripts/prepare-fluss-node.sh           # extract Linux x64 (default)
#   ./scripts/prepare-fluss-node.sh --force   # re-extract even if already exists
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FLUSS_NODE_LIB="$PROJECT_ROOT/fluss-node-lib"

FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=true; shift ;;
    -h|--help)
      echo "Usage: $(basename "$0") [--force]"
      echo ""
      echo "Extracts fluss-node from pre-compiled zip and generates Node.js wrapper."
      echo "Output: fluss-node-lib/linux-x64-gnu/"
      echo ""
      echo "Options:"
      echo "  --force   Re-extract even if already exists"
      exit 0
      ;;
    *) echo "ERROR: Unknown option: $1" >&2; exit 1 ;;
  esac
done

OUTPUT_DIR="$FLUSS_NODE_LIB/linux-x64-gnu"
ZIP_FILE="$FLUSS_NODE_LIB/bindings-linux-x64-gnu.zip"

# Check if already prepared
if [ -d "$OUTPUT_DIR" ] && ls "$OUTPUT_DIR/"*.node &>/dev/null && [ -f "$OUTPUT_DIR/index.js" ]; then
  if [ "$FORCE" != true ]; then
    echo "fluss-node already prepared at: $OUTPUT_DIR"
    echo "Use --force to re-extract."
    exit 0
  fi
fi

# Verify zip exists
if [ ! -f "$ZIP_FILE" ]; then
  echo "ERROR: Pre-compiled zip not found: $ZIP_FILE" >&2
  echo "" >&2
  echo "To obtain it:" >&2
  echo "  1. Download from GitHub Actions artifacts" >&2
  echo "  2. Or compile: ./scripts/build-fluss-node.sh --output-dir $OUTPUT_DIR" >&2
  exit 1
fi

# Verify unzip is available
if ! command -v unzip &>/dev/null; then
  echo "ERROR: unzip not found. Install: apt install unzip (or brew install unzip)" >&2
  exit 1
fi

# Extract
echo "Extracting fluss-node from: $ZIP_FILE"
mkdir -p "$OUTPUT_DIR"
unzip -o "$ZIP_FILE" -d "$OUTPUT_DIR"

# Generate index.js wrapper (napi-rs style loader)
if [ ! -f "$OUTPUT_DIR/index.js" ]; then
  cat > "$OUTPUT_DIR/index.js" <<'WRAPPER_JS'
const { join } = require('path');
const { readdirSync } = require('fs');

const nodeFile = readdirSync(__dirname).find(f => f.endsWith('.node'));
if (!nodeFile) {
  throw new Error('fluss-node: no .node binary found in ' + __dirname);
}

module.exports = require(join(__dirname, nodeFile));
WRAPPER_JS
  echo "Generated: index.js"
fi

# Generate package.json
if [ ! -f "$OUTPUT_DIR/package.json" ]; then
  cat > "$OUTPUT_DIR/package.json" <<'WRAPPER_PKG'
{
  "name": "fluss-node",
  "version": "0.0.0",
  "main": "index.js"
}
WRAPPER_PKG
  echo "Generated: package.json"
fi

# Verify
NODE_COUNT=$(ls "$OUTPUT_DIR/"*.node 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "Done! fluss-node prepared at: $OUTPUT_DIR"
echo "  Native binaries: $NODE_COUNT"
echo "  Files: $(ls "$OUTPUT_DIR/")"
