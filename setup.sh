#!/usr/bin/env bash
# One-time installer. Run from Termux, in the repo root.
set -euo pipefail

DISTRO="${WRANGLER_TUI_DISTRO:-debian}"
STATE="${WRANGLER_TUI_STATE_DIR:-${HOME}/.local/state/wrangler-tui}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "══ wrangler-tui setup ══"
echo "   repo:  $REPO"
echo "   state: $STATE"
echo "   distro: $DISTRO"

# ── Termux prerequisites ────────────────────────────────────────
command -v proot-distro   >/dev/null 2>&1 || pkg install -y proot-distro
command -v termux-open-url >/dev/null 2>&1 || pkg install -y termux-tools

# ── Debian rootfs ───────────────────────────────────────────────
ROOTFS="${PREFIX}/var/lib/proot-distro/installed-rootfs/${DISTRO}"
if [ ! -d "$ROOTFS" ]; then
  echo "[setup] installing ${DISTRO} rootfs"
  proot-distro install "$DISTRO"
fi

# ── Install shim and bridge (Termux side) ───────────────────────
mkdir -p "${STATE}/url-requests" "${STATE}/logs"
install -m 0755 "${REPO}/m1/host/url-bridge.sh" "${STATE}/url-bridge.sh"
install -m 0755 "${REPO}/m1/host/launcher.sh"   "${PREFIX}/bin/wrangler-tui"
echo "[setup] installed ${PREFIX}/bin/wrangler-tui"
echo "[setup] installed ${STATE}/url-bridge.sh"

# ── Guest-side install ──────────────────────────────────────────
install -m 0755 "${REPO}/m1/host/install-guest.sh" "${STATE}/install-guest.sh"

echo "[setup] running guest install (this may take a few minutes)"
proot-distro login "$DISTRO" \
  --bind "${REPO}:${REPO}" \
  --bind "${STATE}:${STATE}" \
  --work-dir "${REPO}/m1" \
  -- env M1_REPO="$REPO" WRANGLER_TUI_STATE_DIR="$STATE" \
       /bin/bash "${STATE}/install-guest.sh"

echo
echo "══ done ══"
echo "   run: wrangler-tui            (from any Wrangler project directory)"
echo "   or:  wrangler-tui auth"
echo "   or:  wrangler-tui deploy"
echo "   or:  wrangler-tui tail"