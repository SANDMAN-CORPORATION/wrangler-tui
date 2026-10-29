#!/usr/bin/env bash
# Runs in Termux. Started by the launcher. Watches queue and opens URLs.
set -uo pipefail

STATE="${WRANGLER_TUI_STATE_DIR:-${HOME}/.local/state/wrangler-tui}"
QUEUE="${STATE}/url-requests"
mkdir -p "$QUEUE"

log() { printf '[url-bridge %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

if command -v termux-open-url >/dev/null 2>&1; then
  log "termux-open-url available"
else
  log "WARN termux-open-url missing — install termux-tools"
fi

log "watching $QUEUE"

while true; do
  shopt -s nullglob
  for f in "$QUEUE"/*.url; do
    url="$(head -n1 "$f" 2>/dev/null || true)"
    [ -z "$url" ] && { rm -f "$f"; continue; }
    log "opening ${url:0:70}…"
    command -v termux-open-url >/dev/null 2>&1 && termux-open-url "$url" >/dev/null 2>&1
    mv "$f" "${f%.url}.opened" 2>/dev/null || rm -f "$f"
  done
  shopt -u nullglob
  sleep 0.5
done