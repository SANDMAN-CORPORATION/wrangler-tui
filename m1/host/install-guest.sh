#!/usr/bin/env bash
# Runs inside PRoot Debian. Installs Node, Wrangler, links the M1 package.
set -euo pipefail

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export DEBIAN_FRONTEND=noninteractive

REPO="${M1_REPO:?M1_REPO required}"
STATE="${WRANGLER_TUI_STATE_DIR:?state dir required}"

echo "[guest-install] repo:  $REPO"
echo "[guest-install] state: $STATE"

# ── base packages ────────────────────────────────────────────────
apt-get update -qq
apt-get install -y --no-install-recommends \
  curl ca-certificates xz-utils procps tar coreutils >/dev/null

# ── node (official tarball, LTS version resolved at runtime) ─────
NODE_DIR=/usr/local/lib/nodejs
NODE_BIN="${NODE_DIR}/bin/node"

if [ -x "$NODE_BIN" ] && "$NODE_BIN" --version >/dev/null 2>&1; then
  echo "[guest-install] node present: $("$NODE_BIN" --version)"
else
  ARCH="$(uname -m)"; case "$ARCH" in aarch64|arm64) ARCH=arm64 ;; x86_64|amd64) ARCH=x64 ;; esac

# Resolve the current LTS from nodejs.org — no hardcoded major version
NODE_VER="$(curl -fsSL https://nodejs.org/dist/index.json \
  | tr '}' '\n' \
  | grep '"lts":"' \
  | grep -v '"lts":false' \
  | head -n1 \
  | grep -oE '"version":"v[0-9.]+"' \
  | sed -E 's/.*"v([0-9.]+)"/v\1/')"

[ -n "$NODE_VER" ] || { echo "[guest-install] cannot resolve Node LTS" >&2; exit 3; }
echo "[guest-install] resolved LTS: $NODE_VER"

  TB="node-${NODE_VER}-linux-${ARCH}.tar.xz"
  URL="https://nodejs.org/dist/${NODE_VER}"
  cd /tmp
  curl -fsSLO "${URL}/${TB}"
  curl -fsSLO "${URL}/SHASUMS256.txt"
  grep " ${TB}\$" SHASUMS256.txt | sha256sum -c -
  tar -xJf "$TB"
  rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"
  cp -a "/tmp/node-${NODE_VER}-linux-${ARCH}/." "$NODE_DIR/"
  for b in node npm npx; do ln -sf "$NODE_DIR/bin/$b" "/usr/local/bin/$b"; done
  hash -r
fi

# ── wrangler ────────────────────────────────────────────────────
npm config set prefix /usr/local --location=global
npm config set fund false --location=global
npm config set update-notifier false --location=global
npm config set allow-scripts=workerd,esbuild --location=global 2>/dev/null || true

if ! command -v wrangler >/dev/null 2>&1; then
  echo "[guest-install] installing wrangler@latest"
  npm install -g --allow-scripts=workerd,esbuild wrangler@latest
fi
echo "[guest-install] $(wrangler --version 2>&1 | head -n1)"

# ── m1 package ──────────────────────────────────────────────────
cd "$REPO/m1"
echo "[guest-install] npm install"
npm install
echo "[guest-install] npm link"
npm link

command -v wrangler-tui >/dev/null || { echo "[guest-install] wrangler-tui not on PATH" >&2; exit 4; }
echo "[guest-install] wrangler-tui: $(command -v wrangler-tui)"