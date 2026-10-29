#!/usr/bin/env bash
set -euo pipefail

DISTRO="${WRANGLER_TUI_DISTRO:-debian}"
STATE="${WRANGLER_TUI_STATE_DIR:-${HOME}/.local/state/wrangler-tui}"
BRIDGE="${STATE}/url-bridge.sh"
PIDFILE="${STATE}/url-bridge.pid"

[ -f "$BRIDGE" ] || { echo "[wrangler-tui] missing $BRIDGE — run setup.sh" >&2; exit 1; }
mkdir -p "${STATE}/url-requests" "${STATE}/logs"

# ── timing setup ──────────────────────────────────────────────────
SHIM_START_MS=$(( $(date +%s%N) / 1000000 ))
TIMING_DIR="${STATE}/timing"
mkdir -p "$TIMING_DIR"
TIMING_FILE="${TIMING_DIR}/$(date +%Y%m%d-%H%M%S)-$$.tsv"
: > "$TIMING_FILE"
mark_shim() {
  local name="$1" detail="${2:-}"
  local ms=$(( $(date +%s%N) / 1000000 - SHIM_START_MS ))
  printf '%s\t%s\t%s\n' "$ms" "$name" "$detail" >> "$TIMING_FILE"
}
export WRANGLER_TUI_SHIM_START_MS="$SHIM_START_MS"
export WRANGLER_TUI_TIMING_FILE="$TIMING_FILE"
mark_shim "shim.start"

# ── bridge ────────────────────────────────────────────────────────
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  :
else
  nohup bash "$BRIDGE" >"${STATE}/logs/url-bridge.log" 2>&1 &
  echo $! > "$PIDFILE"
fi
mark_shim "shim.bridge.ready"

# ── bind strategy ─────────────────────────────────────────────────
# $HOME is auto-bound by proot-distro at the same absolute path.
# $PWD is bound only when outside $HOME.
# If --dir points outside both, its parent is bound.
BINDS=( --bind "${STATE}:${STATE}" )

case "$PWD" in
  "${HOME}"|"${HOME}"/*) ;;
  *) BINDS+=( --bind "${PWD}:${PWD}" ) ;;
esac

DIR_ARG=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--dir" ]; then DIR_ARG="$arg"; break; fi
  prev="$arg"
done

expand_tilde() {
  case "$1" in
    '~')      echo "${HOME}" ;;
    '~/'*)    echo "${HOME}/${1#\~/}" ;;
    *)        echo "$1" ;;
  esac
}

if [ -n "${DIR_ARG:-}" ]; then
  DIR_EXPANDED="$(expand_tilde "$DIR_ARG")"
  case "$DIR_EXPANDED" in
    /*) DIR_ABS="$DIR_EXPANDED" ;;
    *)  DIR_ABS="${PWD}/${DIR_EXPANDED}" ;;
  esac
  case "$DIR_ABS" in
    "${HOME}"|"${HOME}"/*) ;;
    *)
      BIND_DIR="$(dirname "$DIR_ABS")"
      case "$BIND_DIR" in
        "${PWD}"|"${PWD}"/*) ;;
        *) BINDS+=( --bind "${BIND_DIR}:${BIND_DIR}" ) ;;
      esac
      ;;
  esac
fi

printf '\033[2m[wrangler-tui] starting (PRoot + Node + Wrangler)…\033[0m\n' >&2

mark_shim "shim.handoff"
proot-distro login "$DISTRO" \
  "${BINDS[@]}" \
  --work-dir "${PWD}" \
  -- env \
       PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
       WRANGLER_TUI_STATE_DIR="$STATE" \
       WRANGLER_TUI_SHIM_START_MS="$WRANGLER_TUI_SHIM_START_MS" \
       WRANGLER_TUI_TIMING_FILE="$WRANGLER_TUI_TIMING_FILE" \
       wrangler-tui "$@"
RC=$?
mark_shim "shim.return" "rc=$RC"

if command -v stty >/dev/null 2>&1; then
  stty sane 2>/dev/null || true
fi

if [ -s "$TIMING_FILE" ]; then
  printf '\n\033[2mtiming (%s):\033[0m\n' "$(basename "$TIMING_FILE")" >&2
  awk -F'\t' '{ printf "  \033[2m%6dms  %-24s %s\033[0m\n", $1, $2, $3 }' "$TIMING_FILE" >&2
fi

exit $RC