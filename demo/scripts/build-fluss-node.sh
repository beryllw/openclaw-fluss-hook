#!/usr/bin/env bash
# Build fluss-node native addon for Linux and extract artifacts locally.
#
# Two-phase build:
#   1. Base image (fluss-node-base) — toolchain, built once and cached
#   2. Compile image — COPY source + napi build, runs each time
#
# Usage:
#   ./scripts/build-fluss-node.sh             # build everything
#   ./scripts/build-fluss-node.sh --base-only # rebuild base image only
set -euo pipefail

# Detect container runtime
if command -v podman &>/dev/null; then
  CONTAINER_CLI="podman"
elif command -v docker &>/dev/null; then
  CONTAINER_CLI="docker"
else
  echo "ERROR: Neither podman nor docker found in PATH." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$SCRIPT_DIR/.."
PROJECTS_ROOT="$(cd "$DEMO_DIR/../.." && pwd)"
FLUSS_RUST_DIR="$PROJECTS_ROOT/fluss-rust"
OUTPUT_DIR="$DEMO_DIR/fluss-node-lib"

BASE_IMAGE="fluss-node-base:latest"
BUILD_IMAGE="fluss-node-builder:latest"

if [ ! -d "$FLUSS_RUST_DIR" ]; then
  echo "ERROR: fluss-rust not found at $FLUSS_RUST_DIR" >&2
  exit 1
fi

# --- Phase 1: Base image (toolchain) ---
# Only rebuild if image doesn't exist or --base-only / --rebuild-base is passed
NEED_BASE=false
if ! $CONTAINER_CLI image exists "$BASE_IMAGE" 2>/dev/null; then
  NEED_BASE=true
fi
if [[ "${1:-}" == "--base-only" || "${1:-}" == "--rebuild-base" ]]; then
  NEED_BASE=true
fi

if [ "$NEED_BASE" = true ]; then
  echo "=== Phase 1: Building base toolchain image ($BASE_IMAGE) ==="
  $CONTAINER_CLI build \
    -t "$BASE_IMAGE" \
    -f "$DEMO_DIR/Dockerfile.fluss-node-base" \
    "$DEMO_DIR"
  echo ""
  if [[ "${1:-}" == "--base-only" ]]; then
    echo "Done! Base image: $BASE_IMAGE"
    exit 0
  fi
else
  echo "=== Phase 1: Base image ($BASE_IMAGE) already exists, skipping ==="
  echo "  (use --rebuild-base to force rebuild)"
  echo ""
fi

# --- Phase 2: Compile fluss-node ---
echo "=== Phase 2: Compiling fluss-node ==="
echo "  Source: $FLUSS_RUST_DIR"
echo "  Output: $OUTPUT_DIR"
echo ""

$CONTAINER_CLI build \
  -t "$BUILD_IMAGE" \
  -f "$DEMO_DIR/Dockerfile.fluss-node" \
  "$FLUSS_RUST_DIR"

# Extract artifacts from the image
mkdir -p "$OUTPUT_DIR"
CONTAINER_ID=$($CONTAINER_CLI create "$BUILD_IMAGE" 2>/dev/null)
$CONTAINER_CLI cp "$CONTAINER_ID:/fluss-node-lib/." "$OUTPUT_DIR/"
$CONTAINER_CLI rm "$CONTAINER_ID" >/dev/null

echo ""
echo "Done! Artifacts:"
ls -lh "$OUTPUT_DIR/"
echo ""
echo "These will be used by Dockerfile.openclaw during the next build."
