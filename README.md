# wrangler-tui

**Deploy Cloudflare Workers from Termux + PRoot on Android.**  
No flags to memorize. No device codes to copy. No bloated runtime.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-104%20passing-brightgreen.svg)](m1/test/)
[![Node](https://img.shields.io/badge/node-%3E%3D22-green.svg)](m1/package.json)
[![Platform](https://img.shields.io/badge/platform-Termux%20%2B%20PRoot-orange.svg)](#12-known-limitations)

[Install](#10-installation) · [Commands](#11-usage) · [Support this project](#support-this-project) · [Contributing](CONTRIBUTING.md)

---

## 1. Executive Summary

`wrangler-tui` wraps Cloudflare's official Wrangler CLI behind a guided, stateful interface. It runs inside Debian PRoot on Termux, spawns Wrangler for Cloudflare operations, and does not reimplement Cloudflare APIs.

The tool exists because Cloudflare's desktop-oriented workflows can be awkward on Android: OAuth callbacks to localhost may fail inside PRoot, the terminal is constrained, filesystem paths cross the Termux/PRoot boundary, and each Wrangler invocation incurs expensive startup time.

**What it does:** authenticate, sign out, scaffold a project, deploy with preflight and typed confirmation, tail remote logs, and self-test.

**What it does not do:** run local `wrangler dev`. The bundled `workerd` runtime cannot initialize under the tested Android/PRoot virtual-address configuration. This limitation was discovered during feasibility testing, before feature development, and the MVP scope was narrowed accordingly.

**Measured on the target device:** deployment time fell from approximately 79 seconds at baseline to approximately 41 seconds with warm authentication and a fresh dry-run, through three independent caches. The project has 104 passing automated tests and approximately 2,400 lines of source. The fully warm deployment figure remains an estimate rather than a completed measurement.

## Support this project

`wrangler-tui` is MIT-licensed and free to use. If it saves you time, you can support its maintenance:

[![Support via Razorpay](https://img.shields.io/badge/Support%20via-Razorpay-02042B?logo=razorpay&logoColor=white)](https://razorpay.me/@zsar)

Payments are processed by **SANDMAN-CORPORATION** via Razorpay. Accepted methods: UPI, cards (including international), netbanking, and wallets. All payments are one-time; no subscription is created.

**What support pays for:** device-specific testing time, Wrangler version compatibility checks, and the 11–18 second PRoot startup tax that makes every test run expensive.

---

## Table of Contents

- [1. Executive Summary](#1-executive-summary)
- [2. What the Product Is](#2-what-the-product-is)
- [3. What the Product Is Not](#3-what-the-product-is-not)
- [4. The Problem It Solves](#4-the-problem-it-solves)
- [5. Design Principles](#5-design-principles)
- [6. Architecture](#6-architecture)
- [7. Capabilities Shipped](#7-capabilities-shipped)
- [8. Evidence: Measurements and Test Coverage](#8-evidence-measurements-and-test-coverage)
- [9. What Was Decided Against, and Why](#9-what-was-decided-against-and-why)
- [10. Installation](#10-installation)
- [11. Usage](#11-usage)
- [12. Known Limitations](#12-known-limitations)
- [13. Security Posture](#13-security-posture)
- [14. Post-Freeze Roadmap](#14-post-freeze-roadmap)
- [15. Repository Structure](#15-repository-structure)
- [16. How to Verify the Build Works](#16-how-to-verify-the-build-works)
- [17. Version History](#17-version-history)
- [18. Licensing and Distribution](#18-licensing-and-distribution)
- [19. Closing Statement](#19-closing-statement)

---

## 2. What the Product Is

`wrangler-tui` is a terminal-native tool for Cloudflare Workers operations in constrained environments.

It is:

- A wrapper around the official Wrangler CLI.
- Installable through a single setup script.
- Usable from any Wrangler project directory.
- Compatible with invocation from Termux (through a shim) and from PRoot (natively).
- Cache-aware: it avoids repeating expensive operations when relevant inputs have not changed.

The tool uses typed commands rather than relying on graphical menus. An interactive menu is available, but each operation is also a subcommand. Scripting is not a design goal.

## 3. What the Product Is Not

This is equally important for setting expectations. `wrangler-tui` is not:

- **A replacement for Wrangler.** Cloudflare operations still go through Wrangler's own executable.
- **A local development environment.** Local `wrangler dev` does not work in the qualified Termux/PRoot environment, and the tool does not pretend otherwise.
- **A Cloudflare dashboard replacement.** Deployments, account changes, and resource management remain available through Cloudflare's browser interface and official CLI.
- **A GUI.** It runs in a terminal.
- **A multi-user tool.** It manages one developer's session at a time.
- **A CI/CD system.** Its purpose is interactive operations from a phone.
- **A sandbox.** It runs trusted project operations against the user's Cloudflare account.
- **A fork of Wrangler or Cloudflare tooling.** It composes existing tools rather than modifying or reimplementing them.

## 4. The Problem It Solves

Cloudflare Workers development on desktop is straightforward. On Termux + PRoot, it introduces a sequence of small obstacles.

| Obstacle | What it can look like without `wrangler-tui` |
|---|---|
| OAuth callback to `localhost:8976` fails inside PRoot | Login can hang or require a manual device-flow flag and code transfer. |
| Wrangler expects a POSIX-like environment | It works inside PRoot, but a wrapper is needed to cross the Termux/PRoot boundary. |
| Expensive startup for each command | Each Wrangler invocation starts Node.js and loads Wrangler modules, adding substantial latency. |
| Deployment target is not prominent | The user must remember the Worker and environment selected by the command. |
| Authentication checks are expensive | `wrangler whoami` may cost many seconds when run on every deployment. |

`wrangler-tui` addresses these issues:

- **Device-flow authentication:** orchestrates `wrangler login --device --browser=false`, extracts the URL and code from Wrangler's output, opens the browser through Termux, and verifies completion.
- **Termux/PRoot integration:** a launcher shim starts the URL bridge, enters PRoot, binds the state directory, and returns when the guest exits.
- **Reduced repeated work:** authentication, dry-run preflight, and version resolution use three independent caches with separate invalidation rules.
- **Visible deployment target:** the configured Worker and environment are shown before the live deployment, and the user must type the exact Worker name to confirm.
- **Amortized authentication cost:** authentication status is cached for five minutes using a sliding window, so consecutive commands can remain warm.

## 5. Design Principles

Five principles govern the implementation.

1. **CLI-first, not CLI-replacement.** Every Cloudflare operation goes through Wrangler's executable. The tool selects a binary, sets an environment, spawns a process, and reads its result; it does not reimplement Cloudflare APIs.
2. **Project-aware, not command-aware.** The interface presents actions derived from the current project's configuration rather than merely listing Wrangler subcommands.
3. **Safety is structural.** Preflight runs before deployment. The target is visible before a mutation. Confirmation requires the exact Worker name. These rules are enforced by the flow rather than presented as optional hints.
4. **Environment-agnostic core.** The Node.js application contains no Termux-specific logic. Environment adaptation belongs in the launcher shim outside the application.
5. **Deterministic before intelligent.** There is no AI or heuristic guessing. Diagnostics cite their evidence. When the tool cannot decide safely, it asks.

## 6. Architecture

### 6.1 Layers

```text
Termux shell
   $ wrangler-tui deploy
        |
        v
$PREFIX/bin/wrangler-tui          <- Bash shim
   - starts the URL bridge if needed
   - enters PRoot with bound paths
   - passes through arguments
        |
        v
proot-distro login debian --work-dir "$PWD"
        |
        v
/usr/local/bin/wrangler-tui       <- Node.js entry: m1/src/index.mjs
   - parses arguments
   - resolves the target project
   - dispatches to a workflow
        |
        v
m1/src/*.mjs                      <- 14 modules
        |
        v
spawn('wrangler', [...args])      <- Cloudflare's own executable
        |
        v
Cloudflare services
```

### 6.2 Modules

| Module | Responsibility |
|---|---|
| `index.mjs` | CLI entry, argument parsing, dispatch, top-level error handling. |
| `ui.mjs` | Wrappers around `@clack/prompts`, stage markers, terminal restoration. |
| `supervisor.mjs` | Child-process lifecycle, state machine, bounded log buffer, signal escalation. |
| `wrangler-bin.mjs` | Executable resolution: project-local, `WRANGLER_TUI_WRANGLER_BIN`, then `PATH`. |
| `project.mjs` | JSONC/JSON/TOML configuration detection, target resolution, typo recovery, `~` expansion. |
| `auth.mjs` | Login, logout, status, sliding-window cache, device-flow orchestration. |
| `dryrun.mjs` | Dry-run cache keyed by configuration, source, package, version, binary path, and environment. |
| `deploy.mjs` | Preflight, confirmation, live deployment, cache invalidation on failure. |
| `tail.mjs` | Streams `wrangler tail` under supervision. |
| `init.mjs` | Project scaffolding using a minimal local template or Create Cloudflare. |
| `bridge.mjs` | Queues URL requests for the Termux-side bridge. |
| `recent.mjs` | Tracks recent projects. |
| `timing.mjs` | Writes per-invocation timestamp markers. |
| `test.mjs` | Runs self-tests against a mock project. |

### 6.3 The dual-environment contract

The user's mental model is **one tool, one command, one state directory**:

- **From Termux:** `$PREFIX/bin/wrangler-tui` starts the URL bridge if needed, enters PRoot with `$HOME` and the state directory bound, and passes through the current working directory.
- **From inside PRoot:** the same command runs natively without another PRoot hop.
- **Shared state:** `~/.local/state/wrangler-tui/` is bound into the guest, so preferences, caches, and recent-project records are visible from either invocation path.

The launcher is a shim rather than part of the application. The Node.js code does not need to know whether it was invoked from Termux or PRoot; it runs against the paths supplied by its environment.

### 6.4 The three caches

| Cache | Lifetime | Invalidation |
|---|---|---|
| Authentication status | Five minutes, sliding window | Logout, `--refresh`, TTL expiry, or changes to relevant Cloudflare credential environment variables. |
| Dry-run preflight | No TTL | Source, configuration, `package.json`, Wrangler version, environment changes, or live deployment failure. |
| Version resolver | Process lifetime | A new application process starts a new resolver lifecycle. |

Each cache has a different correctness requirement. Authentication is time-sensitive; dry-run validity depends on its input fingerprint; the resolved version is stable within a process. Combining them would force one invalidation policy onto three different contracts.

## 7. Capabilities Shipped

### 7.1 Commands

| Command | Purpose |
|---|---|
| `wrangler-tui` | Opens the interactive menu when a project is available. |
| `wrangler-tui auth` | Authenticates with Cloudflare or uses a valid cached status. |
| `wrangler-tui auth --refresh` | Forces a fresh authentication-status check. |
| `wrangler-tui logout` | Signs out and verifies that authentication state is cleared. |
| `wrangler-tui init` | Creates a new Wrangler project. |
| `wrangler-tui deploy` | Runs deployment preflight, confirmation, and live deployment. |
| `wrangler-tui tail` | Streams remote Worker logs. |
| `wrangler-tui test` | Runs the self-test suite against a mock project. |
| `wrangler-tui --version` | Prints the application version. |
| `wrangler-tui help` | Shows usage information. |

### 7.2 Flags

| Flag | Applies to | Purpose |
|---|---|---|
| `--dir <path>` | `init`, `deploy`, `tail` | Operates on a specific project directory. Relative paths resolve against the current working directory; `~` is expanded. |
| `--refresh` | `auth` | Forces a fresh authentication-status check. |
| `--fresh` | `deploy` | Forces a new dry-run rather than using the cache. |
| `--keep` | `test` | Preserves the mock project after testing. |

### 7.3 Behavioural guarantees

- The deployment target is visible before a live mutation: account, Worker name, environment, and configuration path.
- Typed confirmation is required. The user must enter the exact Worker name; a mismatch cancels the deployment.
- Preflight runs first. `wrangler deploy --dry-run` must succeed before the live deployment starts. A failed preflight stops the workflow.
- Success is determined by the process exit code, not by matching a message such as “Deployed”.
- The dry-run cache is invalidated after a live-deployment failure, so the next attempt does not rely on the previous result.
- `wrangler-tui` does not write Cloudflare credentials to disk. Wrangler manages authentication; the application caches derived authentication status and account-email information.

### 7.4 Confirmation boundary

The production CLI does not expose `WRANGLER_TUI_AUTO_CONFIRM` or another environment variable that bypasses typed deployment confirmation. A test-only entry point, `m1/test/invoke-deploy.mjs`, supports test injection; it is not the production CLI entry point. The test suite verifies that plausible confirmation-bypass variables do not affect production behavior.

## 8. Evidence: Measurements and Test Coverage

### 8.1 Deployment latency

Measurements were collected on the target device: Termux + Debian PRoot (trixie), Node.js 24.22.1, Wrangler 4.152.0, project `com2`.

| Scenario | Auth | Dry-run | Live deployment | Total |
|---|---:|---:|---:|---:|
| Baseline, before caching | 18–25 s | ~10 s | ~28 s | ~79 s |
| Authentication cache warm | 0 s | ~10 s | ~28 s | ~61 s |
| Warm auth, fresh dry-run after source change | 0 s | ~11 s | ~24 s | ~41 s |
| Warm auth and warm dry-run | 0 s | 0 s | ~28 s | ~37 s |
| Fully warm, inferred rather than measured | 0 s | 0 s | ~28 s | ~30.5 s (estimate) |

The fully warm number is an estimate, not a completed measurement. An attempt to measure it missed because the authentication cache had expired after 7 minutes and 17 seconds—longer than the five-minute TTL. The first four rows are reported measurements; the final row is an inference.

### 8.2 Version resolver

| Metric | Before | After |
|---|---:|---:|
| `wrangler --version` subprocess cost | ~4,700 ms | Avoided on the fast path |
| Version resolution from package metadata | — | 7–19 ms |
| Version subprocess on fast path | Present | Absent |

The version subprocess was eliminated by reading package metadata from the resolved executable's installation. The improvement was verified across three consecutive runs.

### 8.3 Test suite

**104 tests across 11 suites** pass in approximately 33 seconds on the reported environment.

| Suite | Coverage |
|---|---|
| `01-syntax` | Every `src/*.mjs` file parses and every module imports cleanly. |
| `02-project` | Project detection and target resolution: absolute and relative paths, `~`, typo recovery, ancestry. |
| `03-timing` | `mark()` writes timing output when enabled and is a no-op otherwise. |
| `04-init` | Initialization/scaffolding tests, including the minimal-template path where exported. |
| `05-cli` | Real CLI behavior: version, help, unknown commands, project-resolution exit codes. |
| `06-shim` | Launcher requirements such as `--work-dir`, avoiding `exec`, `--dir` handling, and terminal restoration. |
| `07-auth-cache` | Cache hit/miss, refresh, invalidation, and sliding-window behavior. |
| `08-recent` | Recent-project recording, deduplication, and bounded history. |
| `09-dryrun` | Cache-key stability, change detection, round-trip behavior, and invalidation. |
| `10-dryrun-cli` | End-to-end cold/warm cache behavior, source-change invalidation, `--fresh`, deployment-failure invalidation, confirmation boundary. |
| `11-resolver` | Resolution precedence, environment override, PATH fallback, non-executable entries, malformed metadata, unknown version. |

Each test defines its own preconditions; the suite does not rely on test ordering.

### 8.4 The feasibility finding (M0)

During feasibility testing, local `wrangler dev` failed to execute. The bundled `workerd` binary printed an error similar to:

```text
MmapAligned() failed - unable to allocate with tag
(hint=..., size=1073741824, alignment=1073741824)
TCMalloc assumes a 48-bit virtual address space size
```

This reflects a virtual-address-space assumption in the bundled TCMalloc allocator. The tested Android ARM64 kernel environment did not satisfy that assumption, and PRoot does not change the underlying kernel's virtual-address configuration.

**Impact:** default local development was removed from the current scope. Deploy, tail, authentication, and supported remote operations remain viable because they do not require the local `workerd` execution path.

The limitation was discovered in feasibility testing before M1 feature development, and scope was narrowed accordingly.

## 9. What Was Decided Against, and Why

A product is defined as much by what it declines to build as by what it ships.

### 9.1 Local `wrangler dev`

**Decision: excluded from the current MVP on Termux/PRoot.** The bundled `workerd` runtime cannot initialize in the tested environment because of its allocator's virtual-address-space assumption.

A compatible custom build appears technically feasible using the upstream `use_tcmalloc=False` build option, but it would introduce an additional binary, a build-and-verification pipeline, version-matching requirements, and an ongoing maintenance obligation whenever Wrangler updates its `workerd` dependency. That effort is not included in the current release scope. An independent project, `wrangler-termux`, reached a similar conclusion about local development.

The decision is to ship the deploy-oriented scope now. Developers who require local development can use a compatible desktop environment. The custom runtime route can be reconsidered if demand justifies the maintenance cost.

### 9.2 `@cloudflare/cf` CLI as the primary backend

**Decision: deferred.** The `cf` CLI provides unified resource operations and structured JSON output, but it has not been established as a drop-in replacement for Wrangler's existing tail, secret-write, and dry-run deployment workflows. Wrangler remains the primary backend. The adapter boundary leaves room for future integration without rewriting the interface.

### 9.3 Authentication profiles

**Decision: deferred.** Wrangler supports directory-scoped authentication profiles, but the feature is documented as experimental. Standard `wrangler logout` and `wrangler login` workflows are sufficient for the current MVP. Profile-based account switching can be added after compatibility and precedence behavior are validated.

### 9.4 Programmatic Wrangler API

**Decision: not used.** The relevant local-development APIs include deprecated/unstable interfaces. CLI subprocess execution has been sufficient for the shipped operations and keeps behavior aligned with the official CLI.

### 9.5 Blessed as TUI framework

**Decision: rejected.** Blessed is no longer actively maintained, and `neo-blessed` is also old. `@clack/prompts` was selected for the MVP's linear, narrow-terminal-first interaction model. A full-screen dashboard is unnecessary for the present scope.

### 9.6 Custom `workerd` build

**Decision: not part of the current release.** Disabling TCMalloc is a technically credible route, but a custom binary would add a substantial artifact and require version-matched builds and validation on Wrangler upgrades. The team has chosen not to take on that burden for the initial deploy-oriented product. This is a product-scope decision, not a claim that a compatible build is theoretically impossible.

### 9.7 Dashboard hand-off and `wrangler dev --remote`

**Decision: deferred, not rejected.** A dashboard deep link after deployment and an explicit remote-development command are possible small enhancements. They are not included in the current release freeze.

## 10. Installation

### 10.1 Prerequisites

- An Android device with Termux installed. The project targets the actively maintained Termux distribution rather than the frozen Play Store build.
- Approximately 1.5 GB of free internal storage for Termux, the Debian root filesystem, Node.js, and Wrangler.
- Network access for initial installation.
- A Cloudflare account; the free tier is sufficient for basic use.

### 10.2 Install

```bash
git clone <repo-url> ~/wrangler-tui
cd ~/wrangler-tui
bash setup.sh
```

`setup.sh` performs the following tasks:

1. Installs `proot-distro` and `termux-tools` if missing.
2. Installs the Debian root filesystem if missing.
3. Installs the launcher shim to `$PREFIX/bin/wrangler-tui`.
4. Installs the URL bridge at the shared state path.
5. Runs the guest installer, which installs Node.js from an official tarball, installs Wrangler through npm, installs the M1 package, and links the CLI.

The Node.js LTS release is resolved during setup rather than hardcoded in the installer.

### 10.3 Verify

```bash
wrangler-tui --version   # Expected: 0.1.0-m1 and a timing table
wrangler-tui test        # Expected: self-test summary with PASS results
```

The product's automated regression suite is separate from the quick self-test command. See [How to Verify the Build Works](#16-how-to-verify-the-build-works).

## 11. Usage

### 11.1 First-time authentication

```bash
wrangler-tui auth
```

The tool will:

1. Offer sign-up guidance if no Cloudflare account is available.
2. Spawn `wrangler login --device --browser=false`.
3. Extract the URL and device code from Wrangler's output.
4. Open the URL in a browser through the Termux URL bridge, prefilled with the code where supported.
5. Copy the code to the clipboard if `termux-clipboard-set` is available.
6. Wait for the user to approve the request in the browser.
7. Verify the result using `wrangler whoami --json`.
8. Cache the derived authentication status for five minutes using a sliding window.

### 11.2 Create a project

```bash
wrangler-tui init
```

The workflow prompts for:

- Destination directory (suggested default: `~/projects/my-worker`).
- Worker name.
- Template: a minimal offline template generated by the tool, or the official `create-cloudflare` flow.

After scaffolding, the tool adopts the new directory as its target and displays the next action.

### 11.3 Deploy

From inside a project:

```bash
cd ~/my-worker
wrangler-tui deploy
```

Or from any directory:

```bash
wrangler-tui deploy --dir ~/my-worker
```

The flow is:

1. Display project information: name, configuration, main entry, and environments.
2. Check authentication, using the cache if valid.
3. Display the deployment target: Worker, environment, main entry, compatibility date, and configuration path.
4. Run `wrangler deploy --dry-run`, using the cache when its fingerprint still applies.
5. Ask the user to type the Worker name to confirm.
6. Run `wrangler deploy`.
7. Report the result using the process exit status.

If preflight fails, deployment does not proceed. If the typed Worker name does not match, the operation is cancelled. If the live deployment fails, the dry-run cache is invalidated.

### 11.4 Tail logs

```bash
wrangler-tui tail
```

Streams logs from the deployed Worker. Ctrl-C stops the tail process cleanly and returns control to the application.

### 11.5 Flags

- `--dir <path>` — operate on a project without changing directories. Relative paths resolve against the current working directory; `~` is expanded.
- `--refresh` — force a fresh authentication check.
- `--fresh` — force a fresh dry-run.
- `--keep` — preserve the mock project after the self-test.

### 11.6 Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `WRANGLER_TUI_STATE_DIR` | Shared state directory | `~/.local/state/wrangler-tui` |
| `WRANGLER_TUI_WRANGLER_BIN` | Explicit Wrangler executable | Unset |
| `WRANGLER_TUI_DISTRO` | PRoot distribution name | `debian` |

## 12. Known Limitations

These limitations are documented so users are not surprised.

### 12.1 Local development is not available in the current MVP

Default local `wrangler dev` cannot run in the tested Termux/PRoot environment because the bundled `workerd` runtime cannot initialize with the tested virtual-address-space configuration. This is a platform/runtime compatibility issue rather than a bug in the TUI's deployment flow.

The application does not expose local development as a working feature or silently fall back to a broken state. `wrangler dev --remote`, which executes on Cloudflare infrastructure rather than using the local runtime, remains a possible future feature but is not exposed as a first-class command in this release.

### 12.2 Authentication cache TTL is five minutes

The five-minute sliding window is correct for the current cache policy but can be short for a mobile development session. A user who deploys, edits for six minutes, and deploys again may pay for another authentication-status check. Extending the TTL to 15–20 minutes or making it configurable is a possible future enhancement, subject to usage measurements and clear staleness reporting.

### 12.3 Wrangler startup is slow under PRoot

Each Wrangler invocation can cost approximately 11–18 seconds because of Node.js startup and module loading through PRoot's process-translation layer. The caches reduce the number of invocations but do not remove the startup cost of each invocation that remains necessary.

### 12.4 Live-deployment duration has an unexplained gap

Wrangler commonly reports upload and trigger durations totalling approximately 9–11 seconds, while the live-deployment stage has taken approximately 24–28 seconds wall-clock time in measurements on the target device. The remaining interval may include Wrangler startup, module loading, PRoot translation overhead, and network handshakes. It has not been decomposed and is not declared irreducible.

### 12.5 Fully warm deployment time has not been measured

An attempt to measure this state missed because authentication had expired after 7 minutes and 17 seconds, exceeding the five-minute cache TTL. The first four deployment measurements in Section 8.1 are measured; the fully warm value is an estimate.

### 12.6 Older Wrangler versions may lack preferred authentication output

The authentication flow prefers `wrangler whoami --json`. Older Wrangler versions may not support that output format, so text parsing is retained as a fallback. Current supported versions should use the structured path.

### 12.7 The frozen Play Store build of Termux is not supported

Use an actively maintained Termux distribution with working package repositories. The frozen Play Store build may have package repository and update problems.

### 12.8 No external users have validated the product yet

This release is an M1 walking skeleton tested extensively by its author. It has not yet been independently tested by external users. External testing is a next milestone, not a claim of completed validation.

## 13. Security Posture

### 13.1 What `wrangler-tui` handles

- Reads project configuration files in JSONC, JSON, or TOML formats.
- Reads application preferences where configured.
- Writes application state for caches, recent-project history, and optional timing data.
- Spawns Wrangler subprocesses with argument arrays and `shell: false`.
- Queues URLs for the Termux-side browser bridge.

### 13.2 What `wrangler-tui` does not handle

- **Credentials:** Cloudflare tokens, API keys, and OAuth state are managed by Wrangler. The TUI reads derived authentication status and account-email information, not the credential values themselves.
- **Secret entry:** users who need to set Worker secrets use `wrangler secret put` directly; this operation is not wrapped by the current MVP.
- **OAuth protocol:** the TUI starts Wrangler's login flow, extracts the URL and device code from its output, and relies on Wrangler for OAuth polling and credential management.

### 13.3 Shell-injection defense

Wrangler processes are spawned with argument arrays and `shell: false`. User-supplied strings, such as project paths and Worker names, are not concatenated into shell command strings. The test suite includes an injection-oriented `--dir` case and checks that invalid input is rejected cleanly.

### 13.4 Confirmation boundary

The production CLI requires the exact Worker name to be typed before deployment. There is no production environment variable that bypasses this step. Automated tests verify that `WRANGLER_TUI_AUTO_CONFIRM`, `WRANGLER_TUI_TEST_CONFIRM`, and `WRANGLER_TUI_TEST_MODE` do not weaken the production confirmation boundary.

### 13.5 Trust model

`wrangler-tui` operates on a developer's own project and Cloudflare account. It does not sandbox Worker execution. Local `dev` is out of scope in this release, so normal usage does not run Worker code on the device. Users should deploy only code they trust and to accounts they control.

Cloudflare also warns that `workerd` is not a hardened sandbox for arbitrary malicious code. That warning remains relevant if local runtime support is introduced in a future release.

## 14. Post-Freeze Roadmap

The following items are future work, not requirements for the current release. Each can be developed independently.

### 14.1 Highest value

| Item | Value | Estimated effort | Dependency |
|---|---|---|---|
| Dashboard hand-off | Offer to open the Cloudflare dashboard for the deployed Worker after a successful deployment. | About one day | None |
| `wrangler dev --remote` | Expose remote development as a first-class `wrangler-tui` command. | About half a day | Existing authentication workflow |

### 14.2 Authentication TTL tuning

Measure typical mobile sessions before changing the authentication cache TTL from five minutes. A future implementation could use 15–20 minutes and display the age of the last verified identity result.

### 14.3 `cf` CLI adapter

As Cloudflare's `cf` CLI stabilizes, an adapter behind the existing boundary could support read-only resource inspection and carefully confirmed resource mutations. It is not an MVP requirement, and a specific operation must be demonstrated to be better supported by `cf` before adopting it.

### 14.4 Authentication profiles

When Wrangler's profile support is no longer documented as experimental, profile-based account switching may replace the current logout/login workflow. This requires validating profile-resolution precedence in PRoot.

### 14.5 Resource inspection

Potential read-only features include listing KV namespaces, D1 databases, R2 buckets, and secret names. Each resource type needs its own output and safety decisions even if it uses the same supervisor.

### 14.6 Interrupted-operation automated test

Manual testing during Commit 4.5 observed Ctrl-C terminating a PRoot session and restoring the terminal correctly. This behavior is not yet covered by a dedicated automated test. A future suite should exercise signal handling during authentication, dry-run, live deployment, and tailing.

### 14.7 Bundling the TUI application

Bundling the approximately 2,400 lines across 14 modules into one file may reduce application startup file reads by an estimated 300–500 ms per invocation. This is lower priority than Wrangler's measured startup cost and should be benchmarked before adoption.

### 14.8 Persistent PRoot session

A persistent guest session could eliminate roughly 40 ms of PRoot entry per invocation, but PRoot entry is not the measured bottleneck. The lifecycle complexity is not justified by current evidence, so this remains deferred.

## 15. Repository Structure

```text
wrangler-tui/
├── README.md                      <- this document
├── setup.sh                       <- one-time installer and Termux entry
├── m0/                            <- feasibility harness
│   ├── README.md
│   ├── run.sh
│   └── guest.sh
└── m1/                            <- product
    ├── package.json
    ├── README.md
    ├── src/                       <- 14 application modules
    │   ├── index.mjs
    │   ├── ui.mjs
    │   ├── supervisor.mjs
    │   ├── wrangler-bin.mjs
    │   ├── project.mjs
    │   ├── auth.mjs
    │   ├── dryrun.mjs
    │   ├── deploy.mjs
    │   ├── tail.mjs
    │   ├── init.mjs
    │   ├── bridge.mjs
    │   ├── recent.mjs
    │   ├── timing.mjs
    │   └── test.mjs
    ├── host/                      <- files installed outside the guest
    │   ├── launcher.sh
    │   ├── url-bridge.sh
    │   └── install-guest.sh
    └── test/                      <- 104 tests across 11 suites
        ├── run.sh
        ├── run-in-guest.sh
        ├── harness.mjs
        ├── helpers.mjs
        ├── invoke-deploy.mjs      <- test-only entry point
        ├── README.md
        └── suites/
            ├── 01-syntax.mjs
            ├── 02-project.mjs
            ├── 03-timing.mjs
            ├── 04-init.mjs
            ├── 05-cli.mjs
            ├── 06-shim.mjs
            ├── 07-auth-cache.mjs
            ├── 08-recent.mjs
            ├── 09-dryrun.mjs
            ├── 10-dryrun-cli.mjs
            └── 11-resolver.mjs
```

Do not publish the manual-test Worker project as part of the root repository. Remove it or move it into a clearly named, non-production test-fixture directory before release.

## 16. How to Verify the Build Works

### 16.1 Quick regression verification

```bash
cd ~/wrangler-tui
bash m1/test/run.sh
```

Expected at the time of this document: **104 tests, 104 passed, 0 failed**, in approximately 33 seconds. The expected count should be updated when the suite changes.

### 16.2 Real deployment verification

Use a non-production test account and Worker.

```bash
# Create a fresh test project
cd ~
wrangler-tui init
# Accept the suggested destination, name the Worker, choose the minimal template.

# Deploy the test Worker
wrangler-tui deploy --dir ~/projects/<name>
# Type the Worker name to confirm.

# Verify the deployment
curl https://<worker>.<subdomain>.workers.dev/
```

Expected: a live test Worker is reachable at the URL shown by the deployment flow.

### 16.3 Cache verification

```bash
# Deploy once, then deploy again without changing relevant inputs.
wrangler-tui deploy --dir ~/projects/<name>
wrangler-tui deploy --dir ~/projects/<name>
```

On the second run, when both caches remain valid, expected markers include `deploy.dryrun.cached` and `auth.status.cached`. The timing output should not show `deploy.dryrun.fresh` or a fresh authentication-status subprocess.

### 16.4 Check for orphaned processes

```bash
ps -ef | grep -E 'wrangler|workerd|proot' | grep -v grep
```

Expected during an idle session: only the URL-bridge daemon, if it is configured to remain running. There should be no unintended orphaned Wrangler or `workerd` process.

## 17. Version History

The project was built through staged commits, each accepted after the full regression suite passed.

| Milestone / commit | Content | Test count at that stage |
|---|---|---:|
| M0 | Feasibility testing; local `workerd` failure established; scope narrowed. | — |
| Commit 1 | Timing instrumentation. | 54 |
| Commit 2 | Project targeting (`--dir`) and scaffold destination fix. | 54 |
| Commit 3 | Authentication cache with sliding window. | 61 |
| Commit 3.5 | Fuzzy suggestions, `~` expansion, recent projects. | 70, then 69 after stale-test cleanup |
| Commit 4 | Dry-run cache. | 90 |
| Commit 4.5 | Executable resolver, version fast path, confirmation-boundary fix. | 104 |
| Post-4.5 | Attempted fully warm measurement; missed because authentication had expired. | 104 |

No accepted commit introduced a measured regression in a previously passing capability. The test suite protects against regressions discovered during implementation, including project-path resolution, launcher working-directory handling, terminal restoration, sliding-window cache behavior, executable resolution, and confirmation bypass attempts.

## 18. Licensing and Distribution

### License

The publishing plan proposes the MIT License. The repository should include a root-level `LICENSE` file containing the complete MIT license text before the README's MIT badge is treated as authoritative.

The application uses permissively licensed dependencies, including:

- `@clack/prompts` — MIT
- `jsonc-parser` — MIT
- `smol-toml` — MIT

Verify dependency license metadata again at release time.

### Distribution

The current installation method is a repository clone followed by `bash setup.sh`. A future npm package could publish the M1 package along with the required `m1/host/*` files, but npm distribution is not part of the current release freeze.

### Wrangler dependency

`wrangler-tui` requires Wrangler to be installed in the same execution environment. It does not bundle Wrangler. The executable resolver prefers a project-local installation, then `WRANGLER_TUI_WRANGLER_BIN`, then PATH. Wrangler 4.x was used for the reported tests.

## 19. Closing Statement

`wrangler-tui` is a small, focused tool for a specific problem: deploying Cloudflare Workers from an Android phone without memorizing Cloudflare CLI flags or wrestling with OAuth in a constrained terminal.

It was built from a reviewed concept through a systematic milestone plan. Feasibility was tested before feature code was written. Scope was narrowed based on observed platform behavior, not convenience. Capabilities were tested on the target device rather than only in a mock harness.

It is not a replacement for Wrangler. It is a companion for environments where the ordinary Wrangler workflow is cumbersome. Developers who work entirely on desktop may not need it; Android developers who encounter these specific problems may find it useful.

The current release includes 104 passing tests, measured performance on the target device, and an explicit account of what it does not support. It is ready for initial external use, with the remaining roadmap documented rather than implied to be complete.

---

*Support links and release metadata should be updated when the project is published. Performance figures describe the tested Termux + Debian PRoot environment and are not universal guarantees.*
