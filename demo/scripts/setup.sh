#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FLINK_LIB_DIR="$SCRIPT_DIR/../flink-lib"
JAR_NAME="fluss-flink-1.20-0.9.0-incubating.jar"

mkdir -p "$FLINK_LIB_DIR"

if [ -f "$FLINK_LIB_DIR/$JAR_NAME" ]; then
  echo "JAR already exists: $FLINK_LIB_DIR/$JAR_NAME"
  exit 0
fi

# Try copying from local fluss-playground first
LOCAL_JAR="$SCRIPT_DIR/../../../fluss-playground/paimon/lib/$JAR_NAME"
if [ -f "$LOCAL_JAR" ]; then
  echo "Copying from local fluss-playground..."
  cp "$LOCAL_JAR" "$FLINK_LIB_DIR/"
  echo "Done: $FLINK_LIB_DIR/$JAR_NAME"
  exit 0
fi

# Fall back to Maven Central download
MAVEN_URL="https://repo1.maven.org/maven2/org/apache/fluss/fluss-connector-flink/0.9.0-incubating/$JAR_NAME"
echo "Downloading from Maven Central..."
echo "URL: $MAVEN_URL"
curl -fSL -o "$FLINK_LIB_DIR/$JAR_NAME" "$MAVEN_URL"
echo "Done: $FLINK_LIB_DIR/$JAR_NAME"
