#!/usr/bin/env bash
# ==========================================================================
# OpenClaw Local Deployment - Start Script
# ==========================================================================
#
# Starts the OpenClaw gateway with fluss-hook and DingTalk plugins.
# Loads environment variables from .env file.
#
# Usage:
#   ./scripts/start.sh                 # Start in foreground
#   ./scripts/start.sh --background    # Start in background (nohup)
#   ./scripts/start.sh --stop          # Stop background process
# ==========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

OPENCLAW_CLI="$DEPLOY_DIR/node_modules/.bin/openclaw"
PID_FILE="$DEPLOY_DIR/.openclaw-gateway.pid"
LOG_FILE="$DEPLOY_DIR/openclaw-gateway.log"

BACKGROUND=false
STOP=false

# ── Parse arguments ───────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --background|-d) BACKGROUND=true; shift ;;
    --stop)          STOP=true; shift ;;
    -h|--help)
      echo "Usage: start.sh [--background|-d] [--stop]"
      echo ""
      echo "Options:"
      echo "  --background, -d   Run in background with nohup"
      echo "  --stop             Stop a previously started background process"
      echo "  -h, --help         Show this help"
      exit 0
      ;;
    *) echo "ERROR: Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Stop mode ─────────────────────────────────────────────────
if [ "$STOP" = true ]; then
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      echo "Stopping OpenClaw gateway (PID: $PID) ..."
      kill "$PID"
      rm -f "$PID_FILE"
      echo "Stopped."
    else
      echo "Process $PID is not running. Cleaning up PID file."
      rm -f "$PID_FILE"
    fi
  else
    echo "No PID file found. Gateway may not be running."
    echo "Try: ps aux | grep openclaw"
  fi
  exit 0
fi

# ── Verify prerequisites ─────────────────────────────────────
if [ ! -x "$OPENCLAW_CLI" ]; then
  echo "ERROR: openclaw CLI not found at $OPENCLAW_CLI" >&2
  echo "Run ./scripts/setup.sh first." >&2
  exit 1
fi

# ── Load .env ─────────────────────────────────────────────────
ENV_FILE="$DEPLOY_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  echo "Loading environment from: $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "WARNING: .env file not found at $ENV_FILE"
  echo "Using system environment variables only."
fi

# ── Validate required env vars ────────────────────────────────
MISSING=0

if [ -z "${BAILIAN_API_KEY:-}" ] || [ "$BAILIAN_API_KEY" = "sk-your-api-key-here" ]; then
  echo "ERROR: BAILIAN_API_KEY not configured in .env" >&2
  MISSING=$((MISSING + 1))
fi

if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ] || [ "$OPENCLAW_GATEWAY_TOKEN" = "your-gateway-token-here" ]; then
  echo "ERROR: OPENCLAW_GATEWAY_TOKEN not configured in .env" >&2
  MISSING=$((MISSING + 1))
fi

if [ -z "${FLUSS_BOOTSTRAP_SERVERS:-}" ]; then
  echo "ERROR: FLUSS_BOOTSTRAP_SERVERS not configured in .env" >&2
  MISSING=$((MISSING + 1))
fi

if [ "$MISSING" -gt 0 ]; then
  echo ""
  echo "Please edit .env first: vi $ENV_FILE"
  exit 1
fi

# ── Build gateway command ─────────────────────────────────────
BIND="${OPENCLAW_BIND:-lan}"

GATEWAY_CMD=(
  "$OPENCLAW_CLI" gateway
  --allow-unconfigured
  --auth token
  --token "$OPENCLAW_GATEWAY_TOKEN"
  --bind "$BIND"
)

echo ""
echo "Starting OpenClaw Gateway ..."
echo "  Bind: $BIND"
echo "  Fluss: $FLUSS_BOOTSTRAP_SERVERS"
echo "  DingTalk: $([ -n "${DINGTALK_CLIENT_ID:-}" ] && echo "enabled" || echo "disabled")"
echo ""

# ── Start ─────────────────────────────────────────────────────
if [ "$BACKGROUND" = true ]; then
  nohup "${GATEWAY_CMD[@]}" > "$LOG_FILE" 2>&1 &
  BG_PID=$!
  echo "$BG_PID" > "$PID_FILE"
  echo "Gateway started in background (PID: $BG_PID)"
  echo "  Log: $LOG_FILE"
  echo "  PID: $PID_FILE"
  echo ""
  echo "Commands:"
  echo "  View logs:  tail -f $LOG_FILE"
  echo "  Stop:       ./scripts/start.sh --stop"
else
  exec "${GATEWAY_CMD[@]}"
fi
