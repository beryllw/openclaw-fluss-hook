#!/usr/bin/env bash
# Build the OpenClaw + fluss-hook Docker image.
#
# This uses the official OpenClaw image as base and layers
# the fluss-hook plugin source on top.
# No native binaries needed — the plugin uses Fluss Gateway REST API.
#
# Usage:
#   ./scripts/build.sh              # default image name: demo-openclaw
#   ./scripts/build.sh my-image     # custom image name
#   ./scripts/build.sh --mirror docker.m.daocloud.io   # use China registry mirror
set -euo pipefail

# --- Parse arguments ---
IMAGE_NAME="demo-openclaw"
MIRROR=""
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mirror) MIRROR="$2"; shift 2 ;;
    -*)       PASSTHROUGH_ARGS+=("$1"); shift ;;
    *)        IMAGE_NAME="$1"; shift ;;
  esac
done

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
PROJECT_ROOT="$(cd "$DEMO_DIR/.." && pwd)"

# Build mirror args for openclaw base image
MIRROR_ARGS=""
if [ -n "$MIRROR" ]; then
  MIRROR_ARGS="--build-arg OPENCLAW_IMAGE=${MIRROR}/alpine/openclaw:latest"
  echo "Using registry mirror: $MIRROR"
fi

echo "Building image '$IMAGE_NAME' using $CONTAINER_CLI ..."
echo "  Base: alpine/openclaw:latest"
echo "  Context: $PROJECT_ROOT"
echo ""

$CONTAINER_CLI build \
  $MIRROR_ARGS \
  -t "$IMAGE_NAME" \
  -f "$DEMO_DIR/Dockerfile.openclaw" \
  "$PROJECT_ROOT"

echo ""
echo "Done! Image: $IMAGE_NAME"
echo "Run: cd demo && docker compose up -d"
