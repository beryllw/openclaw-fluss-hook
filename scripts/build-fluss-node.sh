#!/usr/bin/env bash
# Build fluss-node native addon for Linux inside Docker.
#
# Clones fluss-rust from GitHub and compiles for the container's architecture,
# ensuring the binary always matches the target platform.
#
# Two-phase build:
#   1. Base image (fluss-node-base) — toolchain, built once and cached
#   2. Compile image — git clone + napi build, runs each time source changes
#
# Usage:
#   scripts/build-fluss-node.sh --output-dir <DIR>
#   scripts/build-fluss-node.sh --output-dir <DIR> --ref v1.0.3
#   scripts/build-fluss-node.sh --output-dir <DIR> --repo <URL> --ref <TAG>
#   scripts/build-fluss-node.sh --output-dir <DIR> --mirror docker.m.daocloud.io
#   scripts/build-fluss-node.sh --output-dir <DIR> --base-only
#   scripts/build-fluss-node.sh --output-dir <DIR> --rebuild-base
#   scripts/build-fluss-node.sh --output-dir <DIR> --no-cache
set -euo pipefail

# Defaults
DEFAULT_REPO="https://github.com/beryllw/fluss-rust.git"
DEFAULT_REF="v1.0.2"
BASE_IMAGE="fluss-node-base:latest"
BUILD_IMAGE="fluss-node-builder:latest"

# --- Parse arguments ---
OUTPUT_DIR=""
REPO="$DEFAULT_REPO"
REF="$DEFAULT_REF"
BASE_ONLY=false
REBUILD_BASE=false
NO_CACHE=""
MIRROR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)   OUTPUT_DIR="$2"; shift 2 ;;
    --repo)         REPO="$2"; shift 2 ;;
    --ref)          REF="$2"; shift 2 ;;
    --mirror)       MIRROR="$2"; shift 2 ;;
    --base-only)    BASE_ONLY=true; REBUILD_BASE=true; shift ;;
    --rebuild-base) REBUILD_BASE=true; shift ;;
    --no-cache)     NO_CACHE="--no-cache"; shift ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 --output-dir <DIR> [--repo <URL>] [--ref <TAG>] [--mirror <REGISTRY>] [--base-only] [--rebuild-base] [--no-cache]" >&2
      exit 1
      ;;
  esac
done

if [ -z "$OUTPUT_DIR" ]; then
  echo "ERROR: --output-dir is required." >&2
  echo "Usage: $0 --output-dir <DIR> [--repo <URL>] [--ref <TAG>] [--mirror <REGISTRY>]" >&2
  exit 1
fi

# Build mirror args for Dockerfile ARGs
MIRROR_ARGS=""
if [ -n "$MIRROR" ]; then
  MIRROR_ARGS="--build-arg NODE_IMAGE=${MIRROR}/library/node:22-bookworm-slim --build-arg RUST_IMAGE=${MIRROR}/library/rust:bookworm"
  echo "Using registry mirror: $MIRROR"
fi

# Detect container runtime
if command -v podman &>/dev/null; then
  CONTAINER_CLI="podman"
elif command -v docker &>/dev/null; then
  CONTAINER_CLI="docker"
else
  echo "ERROR: Neither podman nor docker found in PATH." >&2
  exit 1
fi

# Locate docker/ directory (contains Dockerfiles)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_DIR="$PROJECT_ROOT/docker"

if [ ! -f "$DOCKER_DIR/Dockerfile.fluss-node-base" ]; then
  echo "ERROR: docker/Dockerfile.fluss-node-base not found at $DOCKER_DIR" >&2
  exit 1
fi

# --- Phase 1: Base image (toolchain) ---
NEED_BASE=false
if ! $CONTAINER_CLI image exists "$BASE_IMAGE" 2>/dev/null; then
  NEED_BASE=true
fi
if [ "$REBUILD_BASE" = true ]; then
  NEED_BASE=true
fi

if [ "$NEED_BASE" = true ]; then
  echo "=== Phase 1: Building base toolchain image ($BASE_IMAGE) ==="
  $CONTAINER_CLI build \
    $NO_CACHE \
    $MIRROR_ARGS \
    -t "$BASE_IMAGE" \
    -f "$DOCKER_DIR/Dockerfile.fluss-node-base" \
    "$DOCKER_DIR"
  echo ""
  if [ "$BASE_ONLY" = true ]; then
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
echo "  Source: $REPO @ $REF"
echo "  Output: $OUTPUT_DIR"
echo ""

$CONTAINER_CLI build \
  $NO_CACHE \
  --build-arg "FLUSS_RUST_REPO=$REPO" \
  --build-arg "FLUSS_RUST_REF=$REF" \
  -t "$BUILD_IMAGE" \
  -f "$DOCKER_DIR/Dockerfile.fluss-node" \
  "$DOCKER_DIR"

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
