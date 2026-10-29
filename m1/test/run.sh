#!/usr/bin/env bash
# Test suite runner. From Termux: hops into PRoot. From Linux: runs in place.
#
# Usage:
#   bash m1/test/run.sh                 all suites
#   bash m1/test/run.sh syntax          one suite
#   bash m1/test/run.sh --list          list suites
#   bash m1/test/run.sh --trace         verbose (show every subprocess)
#   bash m1/test/run.sh --keep          keep temp dirs
#   bash m1/test/run.sh --only "project" filter by substring
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DISTRO="${WRANGLER_TUI_DISTRO:-debian}"

is_termux() { [ -n "${TERMUX_VERSION:-}" ] && [[ "${PREFIX:-}" == /data/data/com.termux* ]]; }

# Temp state — isolated from the user's real state
TEST_STATE="${TMPDIR:-/tmp}/wrangler-tui-test-$$"
mkdir -p "$TEST_STATE"

cleanup() {
  local keep=0
  for a in "$@"; do [ "$a" = "--keep" ] && keep=1; done
  if [ "$keep" -eq 0 ] && [ -d "$TEST_STATE" ]; then
    rm -rf "$TEST_STATE" 2>/dev/null || true
  fi
}
trap 'cleanup "$@"' EXIT

if is_termux; then
  # HOME is auto-bound by proot-distro. Only bind TEST_STATE when it lives outside HOME.
  BINDS=()
  case "$TEST_STATE" in
    "${HOME}"|"${HOME}"/*) ;;
    *) BINDS+=( --bind "$TEST_STATE:$TEST_STATE" ) ;;
  esac
  proot-distro login "$DISTRO" \
    "${BINDS[@]}" \
    --work-dir "$REPO/m1" \
    -- env \
         PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
         REPO="$REPO" \
         TEST_STATE="$TEST_STATE" \
         CLI="/usr/local/bin/wrangler-tui" \
         /bin/bash "$HERE/run-in-guest.sh" "$@"
  RC=$?
  command -v stty >/dev/null 2>&1 && stty sane 2>/dev/null || true
  exit "$RC"
else
  REPO="$REPO" TEST_STATE="$TEST_STATE" CLI="${CLI:-$(command -v wrangler-tui)}" \
    bash "$HERE/run-in-guest.sh" "$@"
fi