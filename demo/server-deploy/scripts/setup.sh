#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$SCRIPT_DIR/.."
FLINK_LIB_DIR="$DEPLOY_DIR/flink-lib"
JAR_NAME="fluss-flink-1.20-0.9.0-incubating.jar"

mkdir -p "$FLINK_LIB_DIR"

if [ -f "$FLINK_LIB_DIR/$JAR_NAME" ]; then
  echo "JAR already exists: $FLINK_LIB_DIR/$JAR_NAME"
else
  # Try copying from demo/flink-lib first
  DEMO_JAR="$DEPLOY_DIR/../demo/flink-lib/$JAR_NAME"
  if [ -f "$DEMO_JAR" ]; then
    echo "Copying from demo/flink-lib..."
    cp "$DEMO_JAR" "$FLINK_LIB_DIR/"
    echo "Done: $FLINK_LIB_DIR/$JAR_NAME"
  else
    # Download from Maven Central
    MAVEN_URL="https://repo1.maven.org/maven2/org/apache/fluss/fluss-connector-flink/0.9.0-incubating/$JAR_NAME"
    echo "Downloading from Maven Central..."
    echo "URL: $MAVEN_URL"
    curl -fSL -o "$FLINK_LIB_DIR/$JAR_NAME" "$MAVEN_URL"
    echo "Done: $FLINK_LIB_DIR/$JAR_NAME"
  fi
fi

# Create .env from .env.example if not exists
if [ ! -f "$DEPLOY_DIR/.env" ]; then
  if [ -f "$DEPLOY_DIR/.env.example" ]; then
    cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
    echo ""
    echo "Created .env from .env.example"
    echo "IMPORTANT: Edit .env and set HOST_IP to your server's external IP address"
  fi
fi

echo ""
echo "Setup complete! Next steps:"
echo "  1. Edit .env and set HOST_IP to your server's IP (for external access)"
echo "  2. Run: docker compose up -d"
echo "  3. Flink UI: http://<HOST_IP>:8081"
echo "  4. Fluss bootstrap server: <HOST_IP>:9123"
