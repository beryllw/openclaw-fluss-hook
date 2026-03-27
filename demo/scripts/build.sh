#!/usr/bin/env bash
# Build the OpenClaw + fluss-hook Docker image.
#
# This uses the official OpenClaw image as base and layers
# fluss-node binary + fluss-hook plugin on top.
#
# Prerequisites:
#   ./scripts/build-fluss-node.sh   (only needed once)
#
# Usage:
#   ./scripts/build.sh              # default image name: demo-openclaw
#   ./scripts/build.sh my-image     # custom image name
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

IMAGE_NAME="${1:-demo-openclaw}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$SCRIPT_DIR/.."
PROJECT_ROOT="$(cd "$DEMO_DIR/.." && pwd)"

# Check that fluss-node has been built
if [ ! -d "$DEMO_DIR/fluss-node-lib" ] || [ -z "$(ls "$DEMO_DIR/fluss-node-lib/"*.node 2>/dev/null)" ]; then
  echo "ERROR: fluss-node-lib/ not found. Run ./scripts/build-fluss-node.sh first." >&2
  exit 1
fi

echo "Building image '$IMAGE_NAME' using $CONTAINER_CLI ..."
echo "  Base: ghcr.io/openclaw/openclaw:main"
echo "  Context: $PROJECT_ROOT"
echo ""

$CONTAINER_CLI build \
  -t "$IMAGE_NAME" \
  -f "$DEMO_DIR/Dockerfile.openclaw" \
  "$PROJECT_ROOT"

echo ""
echo "Done! Image: $IMAGE_NAME"
echo "Run: cd demo && docker compose up -d"
