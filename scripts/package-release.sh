#!/usr/bin/env bash
# ==========================================================================
# Package fluss-hook release archives for distribution.
# ==========================================================================
#
# Builds self-contained tar.gz packages for each platform, ready to upload
# to GitHub Releases. Each package includes the plugin source, the
# pre-compiled fluss-node binary, and a standalone install script.
#
# Prerequisites:
#   - Pre-compiled fluss-node zips in fluss-node-lib/ (bindings-*.zip)
#
# Usage:
#   ./scripts/package-release.sh                   # use version from package.json
#   ./scripts/package-release.sh --version 0.2.0   # override version
#
# Output:
#   dist/fluss-hook-v{version}-darwin-arm64.tar.gz
#   dist/fluss-hook-v{version}-linux-x64-gnu.tar.gz
#   dist/checksums.txt
# ==========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FLUSS_NODE_LIB="$PROJECT_ROOT/fluss-node-lib"
DIST_DIR="$PROJECT_ROOT/dist"

VERSION=""

# ── Parse arguments ───────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $(basename "$0") [--version <VER>]"
      echo ""
      echo "Packages fluss-hook release archives for each platform."
      echo "Output: dist/fluss-hook-v{version}-{platform}.tar.gz"
      echo ""
      echo "Options:"
      echo "  --version <VER>   Override version (default: read from package.json)"
      exit 0
      ;;
    *) echo "ERROR: Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Read version from package.json if not provided ────────────
if [ -z "$VERSION" ]; then
  VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null \
    || grep -o '"version":\s*"[^"]*"' "$PROJECT_ROOT/package.json" | head -1 | grep -o '[0-9][^"]*')
  if [ -z "$VERSION" ]; then
    echo "ERROR: Could not read version from package.json" >&2
    exit 1
  fi
fi

echo "=========================================="
echo "  Packaging fluss-hook v$VERSION"
echo "=========================================="
echo ""

# ── Verify prerequisites ──────────────────────────────────────
ZIPS=()
for zip in "$FLUSS_NODE_LIB"/bindings-*.zip; do
  if [ -f "$zip" ]; then
    ZIPS+=("$zip")
  fi
done

if [ ${#ZIPS[@]} -eq 0 ]; then
  echo "ERROR: No bindings-*.zip files found in $FLUSS_NODE_LIB" >&2
  echo "Expected files like: bindings-darwin-arm64.zip, bindings-linux-x64-gnu.zip" >&2
  exit 1
fi

echo "Found ${#ZIPS[@]} platform(s):"
for zip in "${ZIPS[@]}"; do
  echo "  $(basename "$zip")"
done
echo ""

# ── Verify plugin source files exist ──────────────────────────
PLUGIN_FILES=(
  "$PROJECT_ROOT/index.ts"
  "$PROJECT_ROOT/package.json"
  "$PROJECT_ROOT/tsconfig.json"
  "$PROJECT_ROOT/openclaw.plugin.json"
  "$PROJECT_ROOT/src/config.ts"
  "$PROJECT_ROOT/src/event-mappers.ts"
  "$PROJECT_ROOT/src/fluss-client.ts"
  "$PROJECT_ROOT/src/message-buffer.ts"
  "$PROJECT_ROOT/src/schema.ts"
  "$PROJECT_ROOT/src/types.ts"
)

for f in "${PLUGIN_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: Plugin source file not found: $f" >&2
    exit 1
  fi
done

# ── Verify release-install.sh exists ──────────────────────────
INSTALL_SCRIPT="$SCRIPT_DIR/release-install.sh"
if [ ! -f "$INSTALL_SCRIPT" ]; then
  echo "ERROR: $INSTALL_SCRIPT not found" >&2
  exit 1
fi

# ── Build packages ────────────────────────────────────────────
mkdir -p "$DIST_DIR"
TMPDIR="$(mktemp -d "/tmp/fluss-hook-release-XXXXXX")"
trap 'rm -rf "$TMPDIR"' EXIT

CHECKSUMS=""

for zip in "${ZIPS[@]}"; do
  # Extract platform from filename: bindings-darwin-arm64.zip -> darwin-arm64
  BASENAME="$(basename "$zip" .zip)"
  PLATFORM="${BASENAME#bindings-}"
  ARCHIVE_NAME="fluss-hook-v${VERSION}-${PLATFORM}.tar.gz"

  echo "--- Packaging: $PLATFORM ---"

  # Create package directory structure
  PKG_DIR="$TMPDIR/fluss-hook"
  rm -rf "$PKG_DIR"
  mkdir -p "$PKG_DIR/plugin/src" "$PKG_DIR/fluss-node"

  # Copy plugin source
  cp "$PROJECT_ROOT/index.ts"              "$PKG_DIR/plugin/"
  cp "$PROJECT_ROOT/package.json"          "$PKG_DIR/plugin/"
  cp "$PROJECT_ROOT/tsconfig.json"         "$PKG_DIR/plugin/"
  cp "$PROJECT_ROOT/openclaw.plugin.json"  "$PKG_DIR/plugin/"
  cp "$PROJECT_ROOT/src/"*.ts              "$PKG_DIR/plugin/src/"

  # Extract fluss-node binary from zip
  unzip -o "$zip" -d "$PKG_DIR/fluss-node" > /dev/null

  # Generate index.js wrapper
  cat > "$PKG_DIR/fluss-node/index.js" <<'WRAPPER_JS'
const { join } = require('path');
const { readdirSync } = require('fs');

const nodeFile = readdirSync(__dirname).find(f => f.endsWith('.node'));
if (!nodeFile) {
  throw new Error('fluss-node: no .node binary found in ' + __dirname);
}

module.exports = require(join(__dirname, nodeFile));
WRAPPER_JS

  # Generate package.json
  cat > "$PKG_DIR/fluss-node/package.json" <<WRAPPER_PKG
{
  "name": "fluss-node",
  "version": "$VERSION",
  "main": "index.js"
}
WRAPPER_PKG

  # Copy install script
  cp "$INSTALL_SCRIPT" "$PKG_DIR/install.sh"
  chmod +x "$PKG_DIR/install.sh"

  # Create tar.gz
  ARCHIVE_PATH="$DIST_DIR/$ARCHIVE_NAME"
  tar -czf "$ARCHIVE_PATH" -C "$TMPDIR" fluss-hook

  # Calculate checksum
  if command -v sha256sum &>/dev/null; then
    HASH=$(sha256sum "$ARCHIVE_PATH" | cut -d' ' -f1)
  elif command -v shasum &>/dev/null; then
    HASH=$(shasum -a 256 "$ARCHIVE_PATH" | cut -d' ' -f1)
  else
    HASH="(sha256sum/shasum not available)"
  fi

  SIZE=$(ls -lh "$ARCHIVE_PATH" | awk '{print $5}')
  echo "  Created: $ARCHIVE_NAME ($SIZE)"
  echo "  SHA256:  $HASH"
  echo ""

  CHECKSUMS="${CHECKSUMS}${HASH}  ${ARCHIVE_NAME}\n"
done

# ── Write checksums file ──────────────────────────────────────
echo -e "$CHECKSUMS" > "$DIST_DIR/checksums.txt"

# ── Summary ───────────────────────────────────────────────────
echo "=========================================="
echo "  Packaging complete!"
echo "=========================================="
echo ""
echo "  Output directory: $DIST_DIR"
ls -lh "$DIST_DIR/"
echo ""
echo "  Upload these files to a GitHub Release."
echo "  Users install with:"
echo "    tar xzf fluss-hook-v${VERSION}-{platform}.tar.gz"
echo "    cd fluss-hook"
echo "    ./install.sh ~/.openclaw"
