#!/usr/bin/env bash
# ==========================================================================
# OpenClaw Local Deployment - Setup Script
# ==========================================================================
#
# One-command setup for OpenClaw with fluss-hook and DingTalk plugins.
# Installs everything locally in the deploy-local/ directory (no Docker).
#
# What this script does:
#   1. Check prerequisites (Node.js >= 22, npm, curl, unzip)
#   2. Install openclaw via npm (local to this directory)
#   3. Obtain fluss-node (download via curl or use local file)
#   4. Install fluss-hook plugin to ~/.openclaw/plugins/
#   5. Install DingTalk connector plugin
#   6. Generate ~/.openclaw/openclaw.json configuration
#   7. Create .env from .env.example
#
# Usage:
#   ./scripts/setup.sh --github-token ghp_xxxx
#   ./scripts/setup.sh --fluss-node-zip /path/to/artifact.zip
#   ./scripts/setup.sh --fluss-node-dir /path/to/fluss-node-lib
#   ./scripts/setup.sh --skip-dingtalk --registry https://registry.npmmirror.com
#
# Prerequisites:
#   - Node.js >= 22
#   - npm
#   - curl  (only if downloading artifact)
#   - unzip (only if downloading artifact or using --fluss-node-zip)
# ==========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"

# ── Defaults ──────────────────────────────────────────────────
OPENCLAW_DATA_DIR="$HOME/.openclaw"
FLUSS_NODE_ARTIFACT_URL="https://api.github.com/repos/beryllw/fluss-rust/actions/artifacts/6199122460/zip"
FLUSS_NODE_ZIP=""          # Path to pre-downloaded artifact zip
FLUSS_NODE_LOCAL_DIR=""    # Path to pre-extracted fluss-node directory
SKIP_DINGTALK=false
NPM_REGISTRY=""
FORCE=false

# GitHub token for artifact download. Can also set GITHUB_TOKEN env var.
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

# ── Parse arguments ───────────────────────────────────────────
print_usage() {
  cat <<'USAGE'
Usage: setup.sh [options]

Options:
  --github-token <TOKEN>   GitHub token for artifact download (or set GITHUB_TOKEN env)
  --fluss-node-zip <FILE>  Use a pre-downloaded artifact zip (skip download)
  --fluss-node-dir <DIR>   Use an existing fluss-node directory (skip download+extract)
  --skip-dingtalk          Skip DingTalk connector plugin installation
  --registry <URL>         Use custom npm registry (e.g. https://registry.npmmirror.com)
  --openclaw-dir <DIR>     OpenClaw data directory (default: ~/.openclaw)
  --force                  Overwrite existing installation
  -h, --help               Show this help

Examples:
  # Download artifact with GitHub token
  ./scripts/setup.sh --github-token ghp_xxxx

  # Use manually downloaded zip
  ./scripts/setup.sh --fluss-node-zip ~/Downloads/fluss-node.zip

  # Use already extracted directory
  ./scripts/setup.sh --fluss-node-dir ~/fluss-node-lib

  # Full options
  ./scripts/setup.sh --github-token ghp_xxxx --registry https://registry.npmmirror.com
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --github-token)     GITHUB_TOKEN="$2"; shift 2 ;;
    --fluss-node-zip)   FLUSS_NODE_ZIP="$2"; shift 2 ;;
    --fluss-node-dir)   FLUSS_NODE_LOCAL_DIR="$2"; shift 2 ;;
    --skip-dingtalk)    SKIP_DINGTALK=true; shift ;;
    --registry)         NPM_REGISTRY="$2"; shift 2 ;;
    --openclaw-dir)     OPENCLAW_DATA_DIR="$2"; shift 2 ;;
    --force)            FORCE=true; shift ;;
    -h|--help)          print_usage; exit 0 ;;
    *)                  echo "ERROR: Unknown option: $1" >&2; print_usage >&2; exit 1 ;;
  esac
done

NPM_ARGS=()
if [ -n "$NPM_REGISTRY" ]; then
  NPM_ARGS+=(--registry "$NPM_REGISTRY")
fi

# ── Color helpers ─────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Determine how fluss-node will be obtained
NEED_DOWNLOAD=true
if [ -n "$FLUSS_NODE_LOCAL_DIR" ] || [ -n "$FLUSS_NODE_ZIP" ]; then
  NEED_DOWNLOAD=false
fi

# ══════════════════════════════════════════════════════════════
# Step 1: Check prerequisites
# ══════════════════════════════════════════════════════════════
echo ""
echo "=========================================="
echo "  Step 1/7: Checking prerequisites"
echo "=========================================="

MISSING=0

# Node.js
if command -v node &>/dev/null; then
  NODE_VER_FULL="$(node -v)"
  NODE_VER_MAJOR="$(echo "$NODE_VER_FULL" | sed 's/v//' | cut -d. -f1)"
  if [ "$NODE_VER_MAJOR" -lt 22 ]; then
    err "Node.js >= 22 required, found $NODE_VER_FULL"
    MISSING=$((MISSING + 1))
  else
    ok "Node.js: $NODE_VER_FULL"
  fi
else
  err "Node.js not found. Please install Node.js >= 22."
  MISSING=$((MISSING + 1))
fi

# npm
if command -v npm &>/dev/null; then
  ok "npm: $(npm -v)"
else
  err "npm not found."
  MISSING=$((MISSING + 1))
fi

# curl (only required when downloading)
if [ "$NEED_DOWNLOAD" = true ]; then
  if command -v curl &>/dev/null; then
    ok "curl: available"
  else
    err "curl not found. Install: apt install curl"
    MISSING=$((MISSING + 1))
  fi
fi

# unzip (required when downloading or using --fluss-node-zip)
if [ "$NEED_DOWNLOAD" = true ] || [ -n "$FLUSS_NODE_ZIP" ]; then
  if command -v unzip &>/dev/null; then
    ok "unzip: available"
  else
    err "unzip not found. Install: apt install unzip"
    MISSING=$((MISSING + 1))
  fi
fi

if [ "$MISSING" -gt 0 ]; then
  echo ""
  err "$MISSING prerequisite(s) missing. Please install them and retry."
  exit 1
fi

# Validate fluss-node source options
if [ -n "$FLUSS_NODE_LOCAL_DIR" ]; then
  if [ ! -d "$FLUSS_NODE_LOCAL_DIR" ]; then
    err "fluss-node directory does not exist: $FLUSS_NODE_LOCAL_DIR"
    exit 1
  fi
  ok "fluss-node source: local directory ($FLUSS_NODE_LOCAL_DIR)"
elif [ -n "$FLUSS_NODE_ZIP" ]; then
  if [ ! -f "$FLUSS_NODE_ZIP" ]; then
    err "fluss-node zip file does not exist: $FLUSS_NODE_ZIP"
    exit 1
  fi
  ok "fluss-node source: local zip ($FLUSS_NODE_ZIP)"
else
  # Need to download — check GitHub token
  if [ -z "$GITHUB_TOKEN" ]; then
    err "GitHub token required for artifact download."
    echo ""
    echo "    Provide via --github-token or GITHUB_TOKEN environment variable."
    echo "    Generate a token at: https://github.com/settings/tokens"
    echo "    Required scope: (no scope needed for public repo artifacts)"
    echo ""
    echo "    Or provide fluss-node locally:"
    echo "      --fluss-node-zip <FILE>   Pre-downloaded artifact zip"
    echo "      --fluss-node-dir <DIR>    Pre-extracted directory"
    exit 1
  fi
  ok "fluss-node source: GitHub artifact (curl download)"
fi

# ══════════════════════════════════════════════════════════════
# Step 2: Install OpenClaw (local npm)
# ══════════════════════════════════════════════════════════════
echo ""
echo "=========================================="
echo "  Step 2/7: Installing OpenClaw"
echo "=========================================="

cd "$DEPLOY_DIR"

if [ -d "$DEPLOY_DIR/node_modules/openclaw" ] && [ "$FORCE" != true ]; then
  info "OpenClaw already installed, skipping. (use --force to reinstall)"
else
  info "Running npm install in $DEPLOY_DIR ..."
  npm install "${NPM_ARGS[@]+"${NPM_ARGS[@]}"}"
  ok "OpenClaw installed"
fi

# Verify openclaw CLI is available
OPENCLAW_CLI="$DEPLOY_DIR/node_modules/.bin/openclaw"
if [ -x "$OPENCLAW_CLI" ]; then
  OPENCLAW_VERSION=$("$OPENCLAW_CLI" --version 2>/dev/null || echo "unknown")
  ok "openclaw CLI: $OPENCLAW_VERSION"
else
  err "openclaw CLI not found at $OPENCLAW_CLI"
  exit 1
fi

# ══════════════════════════════════════════════════════════════
# Step 3: Obtain fluss-node
# ══════════════════════════════════════════════════════════════
echo ""
echo "=========================================="
echo "  Step 3/7: Obtaining fluss-node"
echo "=========================================="

FLUSS_NODE_DIR="$DEPLOY_DIR/fluss-node-lib"

if [ -n "$FLUSS_NODE_LOCAL_DIR" ]; then
  # ── Option A: Use existing directory directly ──
  FLUSS_NODE_DIR="$(cd "$FLUSS_NODE_LOCAL_DIR" && pwd)"
  ok "Using existing fluss-node directory: $FLUSS_NODE_DIR"

elif [ -d "$FLUSS_NODE_DIR" ] && [ -f "$FLUSS_NODE_DIR/index.js" ] && [ "$FORCE" != true ]; then
  info "fluss-node-lib/ already exists, skipping. (use --force to re-download)"

else
  # ── Option B: Extract from local zip ──
  # ── Option C: Download from GitHub and extract ──
  mkdir -p "$FLUSS_NODE_DIR"
  ZIPFILE=""
  TMPZIP=""

  if [ -n "$FLUSS_NODE_ZIP" ]; then
    ZIPFILE="$FLUSS_NODE_ZIP"
    info "Using local zip: $ZIPFILE"
  else
    TMPZIP="$(mktemp /tmp/fluss-node-artifact-XXXXXX.zip)"
    ZIPFILE="$TMPZIP"

    info "Downloading artifact from GitHub ..."
    info "  URL: $FLUSS_NODE_ARTIFACT_URL"

    HTTP_CODE=$(curl -fSL \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      -o "$TMPZIP" \
      -w "%{http_code}" \
      "$FLUSS_NODE_ARTIFACT_URL" 2>/dev/null) || true

    if [ ! -s "$TMPZIP" ]; then
      err "Download failed (HTTP ${HTTP_CODE:-???})."
      echo ""
      echo "    Possible causes:"
      echo "      - Invalid or expired GitHub token"
      echo "      - Artifact has expired (GitHub retains artifacts for 90 days)"
      echo "      - Network error"
      echo ""
      echo "    Alternatives:"
      echo "      - Download manually from the browser and use --fluss-node-zip"
      echo "      - Provide an extracted directory with --fluss-node-dir"
      rm -f "$TMPZIP"
      exit 1
    fi
    ok "Downloaded (HTTP $HTTP_CODE)"
  fi

  info "Extracting to $FLUSS_NODE_DIR ..."
  unzip -o "$ZIPFILE" -d "$FLUSS_NODE_DIR"

  # Clean up temp file if we downloaded it
  [ -n "$TMPZIP" ] && rm -f "$TMPZIP"

  # If files are nested in a subdirectory, flatten them
  if [ ! -f "$FLUSS_NODE_DIR/index.js" ]; then
    NESTED=$(find "$FLUSS_NODE_DIR" -maxdepth 2 -name "index.js" -type f | head -1)
    if [ -n "$NESTED" ]; then
      NESTED_DIR="$(dirname "$NESTED")"
      if [ "$NESTED_DIR" != "$FLUSS_NODE_DIR" ]; then
        info "Flattening nested directory structure ..."
        mv "$NESTED_DIR"/* "$FLUSS_NODE_DIR/" 2>/dev/null || true
        rm -rf "$NESTED_DIR"
      fi
    fi
  fi

  # Final verification
  if [ -f "$FLUSS_NODE_DIR/index.js" ]; then
    ok "fluss-node ready at: $FLUSS_NODE_DIR"
    NODE_FILES=$(ls "$FLUSS_NODE_DIR/"*.node 2>/dev/null | wc -l | tr -d ' ')
    info "Native binaries found: $NODE_FILES"
  else
    warn "index.js not found in artifact — generating napi-rs wrapper ..."
    ls -la "$FLUSS_NODE_DIR/"
  fi
fi

# ── Generate JS wrapper files if missing (artifact-only builds) ──
if [ ! -f "$FLUSS_NODE_DIR/index.js" ] && ls "$FLUSS_NODE_DIR/"*.node &>/dev/null; then
  info "Generating index.js / package.json for fluss-node-lib ..."
  cat > "$FLUSS_NODE_DIR/index.js" <<'WRAPPER_JS'
const { join } = require('path');
const { readdirSync } = require('fs');

const nodeFile = readdirSync(__dirname).find(f => f.endsWith('.node'));
if (!nodeFile) {
  throw new Error('fluss-node: no .node binary found in ' + __dirname);
}

module.exports = require(join(__dirname, nodeFile));
WRAPPER_JS

  cat > "$FLUSS_NODE_DIR/package.json" <<'WRAPPER_PKG'
{
  "name": "fluss-node",
  "version": "0.0.0",
  "main": "index.js"
}
WRAPPER_PKG

  ok "Generated wrapper files in $FLUSS_NODE_DIR"
fi

# ══════════════════════════════════════════════════════════════
# Step 4: Install fluss-hook plugin
# ══════════════════════════════════════════════════════════════
echo ""
echo "=========================================="
echo "  Step 4/7: Installing fluss-hook plugin"
echo "=========================================="

PLUGIN_DIR="$OPENCLAW_DATA_DIR/plugins/fluss-hook"

if [ -d "$PLUGIN_DIR" ] && [ -f "$PLUGIN_DIR/openclaw.plugin.json" ] && [ "$FORCE" != true ]; then
  info "fluss-hook plugin already installed, skipping. (use --force to reinstall)"
else
  info "Installing plugin to: $PLUGIN_DIR"
  mkdir -p "$PLUGIN_DIR/src" "$PLUGIN_DIR/node_modules"

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

  # Link fluss-node into plugin's node_modules
  rm -rf "$PLUGIN_DIR/node_modules/fluss-node"
  ln -s "$FLUSS_NODE_DIR" "$PLUGIN_DIR/node_modules/fluss-node"

  ok "fluss-hook plugin installed"
  info "  Source: $PROJECT_ROOT"
  info "  Target: $PLUGIN_DIR"
  info "  fluss-node: $FLUSS_NODE_DIR (symlinked)"
fi

# ══════════════════════════════════════════════════════════════
# Step 5: Install DingTalk connector plugin
# ══════════════════════════════════════════════════════════════
echo ""
echo "=========================================="
echo "  Step 5/7: Installing DingTalk plugin"
echo "=========================================="

DINGTALK_PLUGIN_DIR="$OPENCLAW_DATA_DIR/plugins/dingtalk-connector"

if [ "$SKIP_DINGTALK" = true ]; then
  info "Skipped (--skip-dingtalk)"
elif [ -d "$DINGTALK_PLUGIN_DIR" ] && [ -f "$DINGTALK_PLUGIN_DIR/openclaw.plugin.json" ] && [ "$FORCE" != true ]; then
  info "DingTalk plugin already installed, skipping. (use --force to reinstall)"
else
  # Install via npm directly (bypasses ClawHub which may rate-limit)
  info "Installing @dingtalk-real-ai/dingtalk-connector via npm ..."
  mkdir -p "$DINGTALK_PLUGIN_DIR"
  (
    cd "$DINGTALK_PLUGIN_DIR"
    npm init -y --silent 2>/dev/null || true
    npm install @dingtalk-real-ai/dingtalk-connector "${NPM_ARGS[@]+"${NPM_ARGS[@]}"}" 2>&1
  ) && {
    # Move package contents from node_modules to plugin root
    if [ -d "$DINGTALK_PLUGIN_DIR/node_modules/@dingtalk-real-ai/dingtalk-connector" ]; then
      DINGTALK_SRC="$DINGTALK_PLUGIN_DIR/node_modules/@dingtalk-real-ai/dingtalk-connector"
      # Copy plugin manifest and source files to plugin root
      cp "$DINGTALK_SRC/openclaw.plugin.json" "$DINGTALK_PLUGIN_DIR/" 2>/dev/null || true
      cp "$DINGTALK_SRC/package.json" "$DINGTALK_PLUGIN_DIR/pkg.json.bak" 2>/dev/null || true
      cp "$DINGTALK_SRC/index.ts" "$DINGTALK_PLUGIN_DIR/" 2>/dev/null || true
      cp -r "$DINGTALK_SRC/src" "$DINGTALK_PLUGIN_DIR/" 2>/dev/null || true
      # Keep node_modules for dependencies (dingtalk-stream, axios, etc.)
    fi
    ok "DingTalk plugin installed to: $DINGTALK_PLUGIN_DIR"
  } || {
    warn "DingTalk plugin installation failed. You can install it later:"
    warn "  cd $DINGTALK_PLUGIN_DIR && npm install @dingtalk-real-ai/dingtalk-connector"
  }
fi

# ══════════════════════════════════════════════════════════════
# Step 6: Generate openclaw.json configuration
# ══════════════════════════════════════════════════════════════
echo ""
echo "=========================================="
echo "  Step 6/7: Generating configuration"
echo "=========================================="

mkdir -p "$OPENCLAW_DATA_DIR"

# Generate openclaw.json with correct plugin path
CONFIG_SRC="$DEPLOY_DIR/config/openclaw.json"
CONFIG_DST="$OPENCLAW_DATA_DIR/openclaw.json"

if [ -f "$CONFIG_DST" ] && [ "$FORCE" != true ]; then
  warn "openclaw.json already exists at $CONFIG_DST"
  warn "Skipping to avoid overwriting your changes. (use --force to overwrite)"
  warn "Template available at: $CONFIG_SRC"
else
  # Replace placeholders with actual plugin paths
  DINGTALK_PLUGIN_DIR="${DINGTALK_PLUGIN_DIR:-$OPENCLAW_DATA_DIR/plugins/dingtalk-connector}"
  if [ "$SKIP_DINGTALK" = true ] || [ ! -d "$DINGTALK_PLUGIN_DIR" ]; then
    # Remove DingTalk plugin path and channel config when skipped/missing
    sed -e "s|__PLUGIN_DIR__|$PLUGIN_DIR|g" \
        -e 's|, "__DINGTALK_PLUGIN_DIR__"||g' \
        "$CONFIG_SRC" > "$CONFIG_DST"
    # Remove the dingtalk-connector channel block from generated config
    python3 -c "
import json, sys
with open('$CONFIG_DST') as f: cfg = json.load(f)
cfg.get('channels', {}).pop('dingtalk-connector', None)
with open('$CONFIG_DST', 'w') as f: json.dump(cfg, f, indent=2)
" 2>/dev/null || info "Could not remove DingTalk channel config (python3 not available)"
  else
    sed -e "s|__PLUGIN_DIR__|$PLUGIN_DIR|g" \
        -e "s|__DINGTALK_PLUGIN_DIR__|$DINGTALK_PLUGIN_DIR|g" \
        "$CONFIG_SRC" > "$CONFIG_DST"
  fi
  ok "Generated: $CONFIG_DST"
fi

# ══════════════════════════════════════════════════════════════
# Step 7: Create .env file
# ══════════════════════════════════════════════════════════════
echo ""
echo "=========================================="
echo "  Step 7/7: Creating .env file"
echo "=========================================="

if [ -f "$DEPLOY_DIR/.env" ] && [ "$FORCE" != true ]; then
  info ".env already exists, skipping."
else
  cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
  ok "Created .env from .env.example"
fi

# ══════════════════════════════════════════════════════════════
# Done!
# ══════════════════════════════════════════════════════════════
echo ""
echo "=========================================="
echo -e "  ${GREEN}Setup complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit .env — configure your credentials:"
echo "     vi $DEPLOY_DIR/.env"
echo ""
echo "     Required:"
echo "       BAILIAN_API_KEY=sk-your-api-key"
echo "       OPENCLAW_GATEWAY_TOKEN=your-token"
echo "       FLUSS_BOOTSTRAP_SERVERS=192.168.1.100:9123"
echo ""
echo "     Optional (DingTalk):"
echo "       DINGTALK_CLIENT_ID=dingxxxxxxxxx"
echo "       DINGTALK_CLIENT_SECRET=your-app-secret"
echo ""
echo "  2. Start the gateway:"
echo "     ./scripts/start.sh"
echo ""
echo "  3. Verify in logs:"
echo "     [fluss-hook] Plugin registered (14 hooks)"
echo "     [fluss-hook] Connected to Fluss at <FLUSS_BOOTSTRAP_SERVERS>"
echo ""
echo "File locations:"
echo "  OpenClaw CLI:    $OPENCLAW_CLI"
echo "  Config:          $CONFIG_DST"
echo "  Plugin:          $PLUGIN_DIR"
echo "  fluss-node:      $FLUSS_NODE_DIR"
echo "  Environment:     $DEPLOY_DIR/.env"
