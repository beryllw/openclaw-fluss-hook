#!/bin/sh
# Auto-approve all pending device pairing requests (for demo/testing only).
# Runs as a background loop inside the OpenClaw container.

sleep 8  # wait for gateway to start

while true; do
  # List pending requests, extract request IDs, approve each one
  node dist/index.js devices list 2>/dev/null \
    | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
    | while read -r rid; do
        node dist/index.js devices approve "$rid" 2>/dev/null && \
          echo "[auto-approve] approved $rid"
      done
  sleep 3
done
