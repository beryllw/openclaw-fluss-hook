#!/usr/bin/env bash
# Initialize deploy-openclaw environment.
#
# - Creates .env from .env.example
# - Checks that fluss-node-lib/ exists (needed for Docker build)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_OPENCLAW_DIR="$SCRIPT_DIR/.."
PROJECT_ROOT="$(cd "$DEPLOY_OPENCLAW_DIR/.." && pwd)"

# Create .env from .env.example if not exists
if [ ! -f "$DEPLOY_OPENCLAW_DIR/.env" ]; then
  if [ -f "$DEPLOY_OPENCLAW_DIR/.env.example" ]; then
    cp "$DEPLOY_OPENCLAW_DIR/.env.example" "$DEPLOY_OPENCLAW_DIR/.env"
    echo "Created .env from .env.example"
  fi
else
  echo ".env already exists, skipping."
fi

# Check fluss-node-lib
FLUSS_NODE_LIB="$PROJECT_ROOT/fluss-node-lib/linux-x64-gnu"
if [ -d "$FLUSS_NODE_LIB" ] && ls "$FLUSS_NODE_LIB/"*.node &>/dev/null; then
  echo "fluss-node-lib: OK ($(ls "$FLUSS_NODE_LIB/"*.node | wc -l | tr -d ' ') binary/binaries found)"
else
  echo ""
  echo "WARNING: fluss-node-lib/linux-x64-gnu/ not found or missing .node binaries."
  echo "Prepare from pre-compiled zip: ./scripts/prepare-fluss-node.sh (from project root)"
  echo "Or they will be compiled automatically when you run ./scripts/build.sh"
fi

echo ""
echo "Setup complete! Next steps:"
echo "  1. Edit .env — set BAILIAN_API_KEY, FLUSS_BOOTSTRAP_SERVERS, OPENCLAW_GATEWAY_TOKEN"
echo "     Optional: set DINGTALK_CLIENT_ID and DINGTALK_CLIENT_SECRET for DingTalk robot"
echo "  2. Build image: ./scripts/build.sh"
echo "  3. Start: docker compose up -d"
echo "  4. Verify: docker compose logs -f openclaw"
