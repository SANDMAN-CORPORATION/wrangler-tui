#!/usr/bin/env bash
# M0 host entry. From Termux: hops into PRoot. From Linux: runs in place.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="${WRANGLER_TUI_STATE_DIR:-${HOME}/.local/state/wrangler-tui}"
SHARED="${STATE}/m0"
mkdir -p "$SHARED" "${STATE}/report" "${STATE}/logs"

LOG="${STATE}/logs/m0-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
RECORDS="${STATE}/report/records-m0-$(date +%Y%m%d-%H%M%S).tsv"
: > "$RECORDS"

echo "══ M0 Feasibility ══"
echo "   state:   $STATE"
echo "   log:     $LOG"
echo "   records: $RECORDS"

is_termux() { [ -n "${TERMUX_VERSION:-}" ] && [[ "${PREFIX:-}" == /data/data/com.termux* ]]; }

NODE_VER="$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt 2>/dev/null \
  | awk '/linux-arm64\.tar\.xz$/{print $2}' \
  | sed -E 's/^node-(v[0-9.]+)-linux.*/\1/' | head -n1)"
[ -n "$NODE_VER" ] || { echo "[fatal] cannot resolve Node LTS" >&2; exit 1; }
echo "   node.lts: $NODE_VER"

if is_termux; then
  cp -f "${here}/guest.sh" "${SHARED}/guest.sh"
  chmod 0755 "${SHARED}/guest.sh"
  proot-distro login debian \
    --bind "${STATE}:${STATE}" \
    --work-dir "${SHARED}" \
    -- env \
     PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
     WRANGLER_TUI_STATE_DIR="$STATE" \
     M0_NODE_VERSION="$NODE_VER" \
     M0_RECORDS="$RECORDS" \
     /bin/bash "${SHARED}/guest.sh"
  RC=$?
else
  M0_NODE_VERSION="$NODE_VER" WRANGLER_TUI_STATE_DIR="$STATE" M0_RECORDS="$RECORDS" \
    bash "${here}/guest.sh"
  RC=$?
fi

echo
echo "══ M0 Result: exit $RC ══"
echo "   records: $RECORDS"
P=$(grep -c $'\tPASS\t' "$RECORDS" || echo 0)
F=$(grep -c $'\tFAIL\t' "$RECORDS" || echo 0)
S=$(grep -c $'\tSKIP\t' "$RECORDS" || echo 0)
echo "   pass=$P fail=$F skip=$S"

if [ "$RC" -eq 0 ]; then echo "   VERDICT: deploy path viable"; else echo "   VERDICT: blocked"; fi
exit "$RC"