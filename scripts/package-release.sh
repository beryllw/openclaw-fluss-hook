#!/usr/bin/env bash
# Package fluss-hook plugin for release distribution.
#
# Creates a tarball containing all plugin files + install.sh.
# Since the plugin uses Fluss Gateway REST API (no native binaries),
# a single universal package is produced.
#
# Usage:
#   ./scripts/package-release.sh              # uses version from package.json
#   ./scripts/package-release.sh v1.2.3       # specify version tag
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Version ───────────────────────────────────────────────────
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION="v$(node -p "require('$PROJECT_ROOT/package.json').version")"
fi
# Strip leading 'v' if present for directory naming
VERSION_CLEAN="${VERSION#v}"
PACKAGE_NAME="fluss-hook-${VERSION}"

echo "=== Packaging fluss-hook ${VERSION} ==="

# ── Create staging directory ──────────────────────────────────
BUILD_DIR="$PROJECT_ROOT/build"
STAGING="$BUILD_DIR/$PACKAGE_NAME"
rm -rf "$STAGING"
mkdir -p "$STAGING"

# ── Copy plugin files ────────────────────────────────────────
# Core files
cp "$PROJECT_ROOT/index.ts"              "$STAGING/"
cp "$PROJECT_ROOT/package.json"          "$STAGING/"
cp "$PROJECT_ROOT/tsconfig.json"         "$STAGING/"
cp "$PROJECT_ROOT/openclaw.plugin.json"  "$STAGING/"

# Source files
mkdir -p "$STAGING/src"
cp "$PROJECT_ROOT/src/config.ts"         "$STAGING/src/"
cp "$PROJECT_ROOT/src/event-mappers.ts"  "$STAGING/src/"
cp "$PROJECT_ROOT/src/fluss-client.ts"   "$STAGING/src/"
cp "$PROJECT_ROOT/src/message-buffer.ts" "$STAGING/src/"
cp "$PROJECT_ROOT/src/schema.ts"         "$STAGING/src/"
cp "$PROJECT_ROOT/src/types.ts"          "$STAGING/src/"

# Installer
cp "$SCRIPT_DIR/install.sh"              "$STAGING/install.sh"
chmod +x "$STAGING/install.sh"

# README
cp "$PROJECT_ROOT/README.md"             "$STAGING/README.md"

# ── Create tarball ────────────────────────────────────────────
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
tar czf "${PACKAGE_NAME}.tar.gz" "$PACKAGE_NAME/"

# ── Verify ────────────────────────────────────────────────────
echo ""
echo "=== Contents ==="
tar tzf "${PACKAGE_NAME}.tar.gz"

echo ""
echo "=== Package ready ==="
echo "  File: $BUILD_DIR/${PACKAGE_NAME}.tar.gz"
echo "  Size: $(du -h "$BUILD_DIR/${PACKAGE_NAME}.tar.gz" | cut -f1)"
echo ""
echo "Install:"
echo "  tar xzf ${PACKAGE_NAME}.tar.gz"
echo "  cd ${PACKAGE_NAME}"
echo "  ./install.sh ~/.openclaw --gateway-url http://your-gateway:8080"
