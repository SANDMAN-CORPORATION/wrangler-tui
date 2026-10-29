# M1 — Walking skeleton

## Commands

| Command | Purpose |
|---|---|
| `wrangler-tui` | Interactive menu (requires project) |
| `wrangler-tui auth` | Authenticate with Cloudflare |
| `wrangler-tui logout` | Sign out (switch accounts) |
| `wrangler-tui init` | Create a new Wrangler project |
| `wrangler-tui deploy` | Deploy (requires project) |
| `wrangler-tui tail` | Stream logs (requires project) |
| `wrangler-tui test` | Self-test against a mock project |
| `wrangler-tui test --keep` | Same, but preserve the mock project |
| `wrangler-tui --version` | Print version |
| `wrangler-tui help` | Show usage |

## Install

From Termux, in repo root:

    bash setup.sh

## Testing without touching real repos

    wrangler-tui test

This creates a mock project under `$WRANGLER_TUI_STATE_DIR/mock/`, runs detection
and `wrangler deploy --dry-run` against it, then cleans up. Use `--keep` to
preserve it for inspection.

If the shim itself is broken, run the shell wrapper directly:

    bash m1/test/run.sh

## Files

- `src/index.mjs` — CLI entry, command dispatch
- `src/ui.mjs` — clack wrappers + terminal restore
- `src/supervisor.mjs` — child process lifecycle
- `src/project.mjs` — config detection and parsing
- `src/bridge.mjs` — URL queue client
- `src/auth.mjs` — login, logout, status
- `src/init.mjs` — project creation (minimal or Cloudflare create)
- `src/deploy.mjs` — dry-run → confirm → deploy
- `src/tail.mjs` — stream `wrangler tail`
- `src/mock.mjs` — mock project generator (for `test`)
- `src/test.mjs` — test orchestrator
- `host/launcher.sh` — source for `$PREFIX/bin/wrangler-tui`
- `host/url-bridge.sh` — source for `$STATE/url-bridge.sh`
- `host/install-guest.sh` — guest-side installer
- `test/run.sh` — shell wrapper for self-test (works if shim is broken)