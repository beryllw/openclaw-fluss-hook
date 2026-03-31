#!/usr/bin/env bash
# Download pre-compiled fluss-node native addon for the current platform.
#
# Detects OS + arch automatically and downloads the matching binary
# from GitHub Releases (or a custom URL).
#
# Usage:
#   ./scripts/download-fluss-node.sh <target-dir>
#   ./scripts/download-fluss-node.sh --version 0.3.0 ./fluss-node-lib
#   ./scripts/download-fluss-node.sh --base-url https://my-mirror.com/releases ./lib
#
# Environment:
#   FLUSS_NODE_DOWNLOAD_URL   Override the full download URL (skip auto-detection)
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────
DEFAULT_VERSION="0.2.0"
# TODO: Replace with actual GitHub repo URL when releases are published
DEFAULT_BASE_URL="https://github.com/user/fluss-node/releases/download"

# ── Parse arguments ───────────────────────────────────────────
VERSION="$DEFAULT_VERSION"
BASE_URL="$DEFAULT_BASE_URL"
FORCE=false
TARGET_DIR=""

print_usage() {
  echo "Usage: $(basename "$0") [options] <target-directory>"
  echo ""
  echo "Options:"
  echo "  --version <VER>     fluss-node version (default: $DEFAULT_VERSION)"
  echo "  --base-url <URL>    Download base URL (default: GitHub Releases)"
  echo "  --force             Overwrite existing files"
  echo "  -h, --help          Show this help"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="$2"; shift 2 ;;
    --base-url)
      BASE_URL="$2"; shift 2 ;;
    --force)
      FORCE=true; shift ;;
    -h|--help)
      print_usage; exit 0 ;;
    -*)
      echo "ERROR: Unknown option: $1" >&2
      print_usage >&2; exit 1 ;;
    *)
      TARGET_DIR="$1"; shift ;;
  esac
done

if [ -z "$TARGET_DIR" ]; then
  echo "ERROR: Target directory is required." >&2
  echo "" >&2
  print_usage >&2
  exit 1
fi

# ── Detect download tool ─────────────────────────────────────
DOWNLOAD_CMD=""
if command -v curl &>/dev/null; then
  DOWNLOAD_CMD="curl"
elif command -v wget &>/dev/null; then
  DOWNLOAD_CMD="wget"
else
  echo "ERROR: Neither curl nor wget found. Please install one of them." >&2
  exit 1
fi

# ── Detect platform ──────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64)
        PLATFORM_SUFFIX="darwin-arm64"
        NODE_FILE="fluss.darwin-arm64.node"
        ;;
      x86_64)
        PLATFORM_SUFFIX="darwin-x64"
        NODE_FILE="fluss.darwin-x64.node"
        ;;
      *)
        echo "ERROR: Unsupported architecture on macOS: $ARCH" >&2
        echo "Supported: arm64 (Apple Silicon), x86_64 (Intel)" >&2
        exit 1
        ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64)
        PLATFORM_SUFFIX="linux-x64-gnu"
        NODE_FILE="fluss.linux-x64-gnu.node"
        ;;
      aarch64)
        PLATFORM_SUFFIX="linux-arm64-gnu"
        NODE_FILE="fluss.linux-arm64-gnu.node"
        ;;
      *)
        echo "ERROR: Unsupported architecture on Linux: $ARCH" >&2
        echo "Supported: x86_64, aarch64 (arm64)" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "ERROR: Unsupported operating system: $OS" >&2
    echo "Supported: Darwin (macOS), Linux" >&2
    exit 1
    ;;
esac

echo "Platform: $OS $ARCH -> $PLATFORM_SUFFIX"

# ── Check existing installation ───────────────────────────────
if [ -d "$TARGET_DIR" ] && [ -f "$TARGET_DIR/index.js" ] && [ "$FORCE" != true ]; then
  echo "ERROR: $TARGET_DIR already contains fluss-node files." >&2
  echo "Use --force to overwrite." >&2
  exit 1
fi

# ── Build download URL ────────────────────────────────────────
TARBALL="fluss-node-v${VERSION}-${PLATFORM_SUFFIX}.tar.gz"

if [ -n "${FLUSS_NODE_DOWNLOAD_URL:-}" ]; then
  DOWNLOAD_URL="$FLUSS_NODE_DOWNLOAD_URL"
  echo "Using custom URL: $DOWNLOAD_URL"
else
  DOWNLOAD_URL="${BASE_URL}/v${VERSION}/${TARBALL}"
fi

echo "Downloading: $DOWNLOAD_URL"

# ── Download ──────────────────────────────────────────────────
TMPFILE="$(mktemp "/tmp/fluss-node-XXXXXX.tar.gz")"
trap 'rm -f "$TMPFILE"' EXIT

if [ "$DOWNLOAD_CMD" = "curl" ]; then
  HTTP_CODE=$(curl -fSL -o "$TMPFILE" -w "%{http_code}" "$DOWNLOAD_URL" 2>/dev/null) || true
  if [ ! -s "$TMPFILE" ]; then
    echo "" >&2
    echo "ERROR: Download failed (HTTP ${HTTP_CODE:-???})." >&2
    echo "  URL: $DOWNLOAD_URL" >&2
    echo "" >&2
    echo "Possible causes:" >&2
    echo "  - Release v${VERSION} has not been published yet" >&2
    echo "  - No pre-compiled binary for ${PLATFORM_SUFFIX}" >&2
    echo "  - Network error" >&2
    echo "" >&2
    echo "Alternatives:" >&2
    echo "  - Check available releases at the repository" >&2
    echo "  - Download manually and use: install.sh --fluss-node-dir <dir>" >&2
    echo "  - Build from source: demo/scripts/build-fluss-node.sh" >&2
    exit 1
  fi
else
  if ! wget -q -O "$TMPFILE" "$DOWNLOAD_URL" 2>/dev/null; then
    echo "" >&2
    echo "ERROR: Download failed." >&2
    echo "  URL: $DOWNLOAD_URL" >&2
    echo "" >&2
    echo "Alternatives:" >&2
    echo "  - Download manually and use: install.sh --fluss-node-dir <dir>" >&2
    echo "  - Build from source: demo/scripts/build-fluss-node.sh" >&2
    exit 1
  fi
fi

# ── Extract ───────────────────────────────────────────────────
mkdir -p "$TARGET_DIR"
tar -xzf "$TMPFILE" -C "$TARGET_DIR" --strip-components=1

# ── Verify ────────────────────────────────────────────────────
if [ ! -f "$TARGET_DIR/index.js" ]; then
  echo "ERROR: Extraction failed — index.js not found in $TARGET_DIR" >&2
  exit 1
fi

if [ ! -f "$TARGET_DIR/$NODE_FILE" ]; then
  echo "ERROR: Native binary not found: $TARGET_DIR/$NODE_FILE" >&2
  echo "The downloaded package may not match your platform ($PLATFORM_SUFFIX)." >&2
  exit 1
fi

echo ""
echo "fluss-node v${VERSION} (${PLATFORM_SUFFIX}) downloaded to: $TARGET_DIR"
ls -lh "$TARGET_DIR/"
