# wrangler-tui test suite

## Usage

From Termux:

    bash m1/test/run.sh                   # all suites
    bash m1/test/run.sh syntax            # one suite by filename substring
    bash m1/test/run.sh --list            # list suites
    bash m1/test/run.sh --trace           # show every subprocess spawn
    bash m1/test/run.sh --keep            # keep temp dirs
    bash m1/test/run.sh --only "resolve"  # filter by test name

From inside PRoot:

    node ~/wrangler-tui/m1/test/harness.mjs

## Suites

| Suite | Coverage |
|---|---|
| 01-syntax | Every `src/*.mjs` parses; every module imports. Catches bad imports. |
| 02-project | `detect` and `resolveTarget` across absolute, relative, tilde, typo, ancestry. |
| 03-timing | `mark()` writes when env set, no-ops otherwise. |
| 04-init | Placeholder; expands when `scaffoldMinimal` is exported. |
| 05-cli | Real CLI: `--version`, `help`, unknown command, project-resolution exit codes. |
| 06-shim | Greps `launcher.sh` for `--work-dir`, no `exec`, `--dir` handling, `stty sane`. |
| 07-auth-cache | Cache hit/miss/refresh/invalidate; sliding window; fake wrangler. |
| 08-recent | `recent-projects.json`: record, dedupe, cap. |
| 09-dryrun | Unit tests for `dryrun.mjs`: key stability, change triggers, `store`/`lookup`/`invalidate`, unknown-version bypass. |
| 10-dryrun-cli | E2E via `test/invoke-deploy.mjs` (test-only entry). Cold/warm cache, source-change invalidation, `--fresh`, deploy-failure invalidation. Plus: real CLI must not bypass confirmation via any env var. |
| 11-resolver | Unit tests for `wrangler-bin.mjs`: project-local precedence, `WRANGLER_TUI_WRANGLER_BIN`, PATH fallback, non-executable skip, package.json vs spawn version, unknown-version, no-wrangler. |

## Test-only entry point

`test/invoke-deploy.mjs` exists because the deploy flow requires typed
confirmation. The production CLI (`src/index.mjs`) uses `defaultConfirm`,
which prompts interactively. Tests cannot reasonably type into a prompt, so
suite 10 spawns `test/invoke-deploy.mjs`, which calls the same `deploy.flow()`
with an injected `confirmFn`. **The production CLI has no env-var bypass.**
Test suite 10 asserts this.

## Regression history the suite guards

| Suite | Bug | Commit |
|---|---|---|
| 01-syntax | `import { homedir } from 'node:path'` | commit 2 |
| 02-project | `--dir` rejected relative paths | commit 2 |
| 05-cli | `--dir` relative resolved against `/root` (missing `--work-dir`) | commit 2 |
| 06-shim | `exec proot-distro` prevented `stty sane` trap | commit 2 |
| 02-project | `--dir '~/x'` not expanded; typos gave no suggestions | commit 3.5 |
| 07-auth-cache | Stale test asserted pre-sliding-window behavior | commit 3.5 |
| 11-resolver | Version resolved from PATH while execution used project-local | commit 4.5 |
| 10-dryrun-cli | `WRANGLER_TUI_AUTO_CONFIRM` bypassed typed confirmation | commit 4.5 |