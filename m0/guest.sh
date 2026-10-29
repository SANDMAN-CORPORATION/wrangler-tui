#!/usr/bin/env bash
# M0 guest-side checks. Run inside PRoot Debian.
set -uo pipefail

STATE="${WRANGLER_TUI_STATE_DIR:?state dir required}"
SHARED="${STATE}/m0"
RECORDS="${M0_RECORDS:-${STATE}/report/records-guest.tsv}"
mkdir -p "$(dirname "$RECORDS")" "$SHARED"

pass() { printf '\033[32mPASS\033[0m %s — %s\n' "$1" "${2:-}"; printf 'm0\tPASS\t%s\t%s\n' "$1" "${2:-}" >> "$RECORDS"; }
fail() { printf '\033[31mFAIL\033[0m %s — %s\n' "$1" "${2:-}"; printf 'm0\tFAIL\t%s\t%s\n' "$1" "${2:-}" >> "$RECORDS"; }
skip() { printf '\033[33mSKIP\033[0m %s — %s\n' "$1" "${2:-}"; printf 'm0\tSKIP\t%s\t%s\n' "$1" "${2:-}" >> "$RECORDS"; }
rec()  { printf 'm0\tREC\t%s\t%s\n' "$1" "$2" >> "$RECORDS"; }
sec()  { printf '\n── %s ──\n' "$*"; }

sec "ARCHITECTURE"
case "$(uname -m)" in
  aarch64|arm64) ARCH=arm64 ;;
  x86_64|amd64)  ARCH=x64 ;;
  *) fail arch "unsupported: $(uname -m)"; exit 2 ;;
esac
pass arch "$ARCH"
rec uname "$(uname -a)"

sec "GLIBC"
GLIBC="$(ldd --version 2>&1 | head -n1 | grep -oE '[0-9]+\.[0-9]+$' || echo '')"
if [ -n "$GLIBC" ]; then
  MAJ="${GLIBC%%.*}"; MIN="${GLIBC#*.}"
  if [ "$MAJ" -gt 2 ] || { [ "$MAJ" -eq 2 ] && [ "$MIN" -ge 35 ]; }; then
    pass glibc "$GLIBC"
  else
    fail glibc "$GLIBC < 2.35"; exit 3
  fi
else
  skip glibc "cannot parse"
fi

sec "BASE PACKAGES"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || { fail apt.update "failed"; exit 4; }
apt-get install -y --no-install-recommends \
  ca-certificates curl xz-utils procps tar coreutils >/dev/null 2>&1 \
  || { fail apt.install "failed"; exit 4; }
pass packages "installed"

sec "NODE"
NODE_DIR=/usr/local/lib/nodejs
if [ -x "$NODE_DIR/bin/node" ] && "$NODE_DIR/bin/node" --version >/dev/null 2>&1; then
  pass node.present "$("$NODE_DIR/bin/node" --version)"
else
  skip node.present "run setup.sh to install"
fi

if command -v node >/dev/null 2>&1; then
  case "$(command -v node)" in
    /data/data/com.termux/*) fail node.path "resolves to Termux"; exit 5 ;;
  esac
  PLATFORM="$(node -p process.platform)"
  [ "$PLATFORM" = linux ] || { fail platform "$PLATFORM != linux"; exit 5; }
  pass platform "linux/$(node -p process.arch)"
  rec node.version "$(node --version)"
fi

sec "WRANGLER"
if command -v wrangler >/dev/null 2>&1; then
  case "$(command -v wrangler)" in
    /data/data/com.termux/*) fail wrangler.path "resolves to Termux"; exit 6 ;;
  esac
  pass wrangler.present "$(wrangler --version 2>&1 | head -n1)"
else
  skip wrangler.present "run setup.sh to install"
fi

sec "WORKERD (expected FAIL — PRoot VA limit)"
NPM_ROOT="$(npm root -g 2>/dev/null || echo /usr/local/lib/node_modules)"
WORKERD=""
for c in \
  "$NPM_ROOT/wrangler/node_modules/@cloudflare/workerd-linux-arm64/bin/workerd" \
  "$NPM_ROOT/wrangler/node_modules/workerd/bin/workerd" \
  "$NPM_ROOT/@cloudflare/workerd-linux-arm64/bin/workerd"; do
  [ -f "$c" ] && { WORKERD="$c"; break; }
done
[ -z "$WORKERD" ] && WORKERD="$(find -L "$NPM_ROOT" -type f -name 'workerd' 2>/dev/null | head -n1 || true)"

if [ -n "$WORKERD" ]; then
  chmod +x "$WORKERD" 2>/dev/null || true
  OUT="$("$WORKERD" --version 2>&1 || true)"; RC=$?
  if [ "$RC" -eq 0 ]; then
    pass workerd "$(printf '%s' "$OUT" | head -n1)"
  else
    fail workerd "exit $RC (tcmalloc 48-bit VA — platform limitation)"
    printf '%s\n' "$OUT" | grep -iE 'tcmalloc|MmapAligned' | head -n 2
  fi
else
  skip workerd "binary not located"
fi

sec "DEPLOY DRY-RUN"
PROJ="${SHARED}/sample-project"
mkdir -p "$PROJ/src"
[ -f "$PROJ/wrangler.jsonc" ] || cat > "$PROJ/wrangler.jsonc" <<'JSONC'
{
  "name": "m0-sample",
  "main": "src/index.js",
  "compatibility_date": "2025-01-01"
}
JSONC
[ -f "$PROJ/src/index.js" ] || cat > "$PROJ/src/index.js" <<'JS'
export default { async fetch() { return new Response("m0-ok"); } };
JS
[ -f "$PROJ/package.json" ] || cat > "$PROJ/package.json" <<'JSON'
{ "name": "m0-sample", "type": "module", "private": true }
JSON

cd "$PROJ"
DRY_LOG="${STATE}/logs/m0-dryrun-$(date +%s).log"
if wrangler deploy --dry-run --outdir /tmp/m0-dryrun >"$DRY_LOG" 2>&1; then
  pass deploy.dry_run "exit 0"
else
  fail deploy.dry_run "exit $? — see $DRY_LOG"
  tail -n 20 "$DRY_LOG"
fi

sec "SHARED STATE"
PROBE="${SHARED}/state-probe.txt"
echo "guest-$(date +%s)" > "$PROBE"
pass shared_state "$PROBE"

sec "VERDICT"
if grep -q $'\tFAIL\tdeploy.dry_run' "$RECORDS"; then
  echo "   BLOCKED — deploy dry-run failed"; exit 1
elif grep -q $'\tFAIL\tworkerd' "$RECORDS"; then
  echo "   CONDITIONAL PASS — deploy path viable, local dev impossible"
  exit 0
else
  echo "   FULL PASS"
  exit 0
fi