#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${REPO:?REPO required}"
: "${TEST_STATE:?TEST_STATE required}"
: "${CLI:?CLI required}"

exec node "$HERE/harness.mjs" "$@"