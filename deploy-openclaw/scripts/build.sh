#!/usr/bin/env bash
# Build the OpenClaw + fluss-hook + DingTalk Docker image.
#
# This uses the official OpenClaw image as base and layers:
#   - @dingtalk-real-ai/dingtalk-connector plugin
#   - fluss-node binary + fluss-hook plugin
#
# Prerequisites:
#   fluss-node-lib/ will be compiled automatically if missing
#
# Usage:
#   ./scripts/build.sh              # default image name: deploy-openclaw
#   ./scripts/build.sh my-image     # custom image name
#   ./scripts/build.sh --mirror docker.m.daocloud.io   # use China registry mirror
set -euo pipefail

# --- Parse arguments ---
IMAGE_NAME="deploy-openclaw"
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
DEPLOY_OPENCLAW_DIR="$SCRIPT_DIR/.."
PROJECT_ROOT="$(cd "$DEPLOY_OPENCLAW_DIR/.." && pwd)"

# Check that fluss-node has been prepared; auto-prepare from zip or compile if missing
FLUSS_NODE_LIB="$PROJECT_ROOT/fluss-node-lib/linux-x64-gnu"
if [ ! -d "$FLUSS_NODE_LIB" ] || [ -z "$(ls "$FLUSS_NODE_LIB/"*.node 2>/dev/null)" ]; then
  echo "fluss-node-lib/linux-x64-gnu/ not found or missing .node binaries ..."
  echo ""
  if [ -f "$PROJECT_ROOT/fluss-node-lib/bindings-linux-x64-gnu.zip" ]; then
    echo "Extracting from pre-compiled zip ..."
    "$PROJECT_ROOT/scripts/prepare-fluss-node.sh" --force
  else
    echo "No pre-compiled zip found — compiling from source ..."
    FLUSS_BUILD_ARGS=(--output-dir "$FLUSS_NODE_LIB")
    [ -n "$MIRROR" ] && FLUSS_BUILD_ARGS+=(--mirror "$MIRROR")
    "$PROJECT_ROOT/scripts/build-fluss-node.sh" "${FLUSS_BUILD_ARGS[@]}"
  fi
  echo ""
fi

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
  -f "$DEPLOY_OPENCLAW_DIR/Dockerfile.openclaw" \
  "$PROJECT_ROOT"

echo ""
echo "Done! Image: $IMAGE_NAME"
echo "Run: cd deploy-openclaw && docker compose up -d"
