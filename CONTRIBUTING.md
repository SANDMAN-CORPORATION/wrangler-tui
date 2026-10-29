
# Contributing to wrangler-tui

Thank you for considering contributing to `wrangler-tui`.

The project helps developers deploy Cloudflare Workers from Termux and Debian PRoot on Android. Contributions should improve reliability, safety, compatibility, documentation, or the experience of deploying from a constrained device.

## What Contributions Are Welcome?

| Area | Priority |
|---|---|
| Bug reports with reproducible steps | High |
| Regression tests for real failures | High |
| Documentation fixes and clarifications | High |
| Wrangler version compatibility reports | High |
| Deployment safety and confirmation improvements | High |
| Dashboard hand-off after successful deployment | Roadmap |
| `wrangler dev --remote` command | Roadmap |
| Authentication cache tuning based on measurements | Roadmap |
| Read-only resource inspection for KV, D1, and R2 | Roadmap |
| New full-screen TUI frameworks | Not currently planned |
| AI features before deterministic diagnostics are established | Not currently planned |
| Custom `workerd` builds or a bundled runtime | Out of scope for the current project |

Please open an issue before starting substantial work. This helps establish whether the proposed change fits the product's goals.

## Project Principles

Contributions should preserve these principles:

1. **CLI-first:** Cloudflare operations must use the official Wrangler CLI unless an explicitly approved backend adapter is introduced.
2. **Project-aware:** Features should use the current project's configuration and deployment context.
3. **Safety by construction:** Deployment preflight and exact-name confirmation must not be bypassed.
4. **Environment separation:** Termux-specific behaviour belongs in the launcher, not in the Node.js application core.
5. **Deterministic diagnostics:** Report observable evidence instead of relying on heuristic guesses.
6. **Minimal dependencies:** Prefer existing modules and Node.js built-ins over new dependencies.
7. **Constrained-device compatibility:** Avoid unnecessary memory use, subprocesses, and startup overhead.

## Before Opening a Pull Request

1. Open an issue for any non-trivial feature or architectural change.
2. Run the complete test suite:

   ```bash
   bash m1/test/run.sh
   ```

3. Confirm that all existing tests pass.
4. Add regression tests for changed behaviour.
5. Keep the change focused on one concern.
6. Document new commands, flags, environment variables, or limitations.
7. Explain any new dependency and why existing functionality cannot meet the requirement.
8. Never include credentials, access tokens, private configuration, or personal deployment data in commits.

The current baseline is **104 automated tests across 11 suites**. If the suite changes, update the documented count only after verifying the new result.

## Development Setup

Clone the repository:

```bash
git clone https://github.com/SANDMAN-CORPORATION/wrangler-tui.git
cd wrangler-tui
```

Install the environment using the project's installer:

```bash
bash setup.sh
```

Run the test suite:

```bash
bash m1/test/run.sh
```

The test suite is designed to run inside Debian PRoot and uses mock Wrangler binaries for relevant CLI tests. A real Cloudflare account should not be necessary for the automated regression suite.

## Code Standards

- Use argument arrays when spawning subprocesses.
- Never introduce `shell: true` into Wrangler process execution.
- Do not place credentials in logs, caches, preferences, or error messages.
- Do not introduce environment variables that bypass deployment confirmation.
- Keep authentication and Cloudflare API responsibilities delegated to Wrangler.
- Preserve graceful interruption and terminal restoration.
- Test cache invalidation whenever relevant inputs change.
- Keep documentation consistent with actual implementation.

## Testing Expectations

Changes involving these areas should include appropriate regression coverage:

- Project discovery and configuration parsing
- Authentication and logout
- Wrangler executable resolution
- Dry-run cache creation and invalidation
- Deployment confirmation and failure handling
- Subprocess lifecycle and interruption
- Termux/PRoot launcher behaviour
- URL bridge behaviour
- Version and dependency compatibility

Do not claim that a feature works on Android or PRoot unless it has been tested in that environment or the limitation is clearly disclosed.

## Reporting Security Issues

Please do not disclose exploitable vulnerabilities in public issues. Follow the reporting instructions in [SECURITY.md](SECURITY.md).

## License

By contributing to this project, you agree that your contributions are submitted under the MIT License in the repository's [LICENSE](LICENSE) file.
