# M0 — Feasibility and Environment Qualification

## Verdict: PASS (conditional) — deploy-only scope

Established by the M0 runs on 2026-10-26:

| Capability | Result | Evidence |
|---|---|---|
| Node in guest | PASS | v24.22.1 via official tarball |
| Wrangler in guest | PASS | 4.152.0 via npm |
| `wrangler deploy --dry-run` | PASS | exit 0 |
| Shared state Termux ↔ PRoot | PASS | bind-mount probe read back |
| `workerd` execution | FAIL | `MmapAligned() failed ... TCMalloc assumes 48-bit VA` |
| `wrangler dev` (local) | FAIL | cascaded from workerd |

**Local development via `workerd` is not achievable on Termux + PRoot.** The
bundled TCMalloc assumes a 48-bit virtual address space that PRoot on Android
cannot provide. No runtime workaround exists; the fix would require rebuilding
`workerd` with different compile-time flags.

**Deploy, tail, auth, and resource operations do not invoke local `workerd`**
and are therefore viable. The M1 walking skeleton builds on this.

## Reproducing

From Termux:

    bash m0/run.sh

Produces `$WRANGLER_TUI_STATE_DIR/report/records-m0-*.tsv`.

## Files

- `run.sh` — host entry; runs `guest.sh` in PRoot from Termux, or in place on Linux
- `guest.sh` — the checks
- `README.md` — this file

## Not tested in M0

Authentication. M0 does not own the interactive flow; auth is exercised end-to-end
in M1 via the URL bridge. M0 records auth-dependent capabilities as SKIP.