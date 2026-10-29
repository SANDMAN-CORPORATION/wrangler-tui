
# Security Policy

## Supported Versions

`wrangler-tui` is currently pre-1.0.

Security fixes are developed against the current `main` branch. Older commits and unreleased development snapshots may not receive individual security patches.

Users should update to the latest supported revision when a security fix is announced.

## Reporting a Vulnerability

**Please do not publish exploitable security vulnerabilities in public GitHub issues.**

Preferred reporting method:

- Use GitHub's private vulnerability reporting feature for this repository, if enabled.

Alternatively, contact the maintainer through a verified security email address published in this repository.

Do not publish this document with a placeholder email address. Configure a real, monitored contact before release if email reporting is offered.

When reporting a vulnerability, include:

- A description of the issue and its potential impact.
- Steps to reproduce the issue.
- The affected command, module, or version.
- Relevant logs or a minimal proof of concept, with credentials and personal information removed.
- Whether exploitation requires direct user interaction or can be triggered through project files, configuration, paths, or environment variables.

Please allow the maintainer reasonable time to investigate and prepare a fix before publicly disclosing an exploitable issue.

Acknowledgement and remediation timelines will be communicated by the maintainer. No response-time guarantee is made until a formal response process has been established.

## Scope

| In scope | Out of scope |
|---|---|
| Command injection through project paths or user-supplied arguments | Vulnerabilities in Cloudflare infrastructure |
| Credential or authentication-state leakage | Physical access to an unlocked device |
| Deployment confirmation bypasses | Social engineering outside the application |
| Path traversal during project discovery | Vulnerabilities in Wrangler itself |
| Cache isolation failures between accounts or projects | Vulnerabilities in Cloudflare's hosted execution environment |
| Unsafe subprocess lifecycle or terminal handling | Denial of service caused solely by intentionally deploying a user's own workload |

Vulnerabilities in Wrangler, Node.js, Termux, PRoot, or Cloudflare services should also be reported to the respective upstream project when appropriate.

## Security Design

### Credential handling

`wrangler-tui` delegates Cloudflare authentication to Wrangler.

The application may read derived authentication status and account-identifying information required for its interface. It must not copy Cloudflare credentials into its own caches, preferences, logs, or diagnostic output.

### Subprocess execution

Wrangler commands should be spawned using argument arrays with `shell: false`.

User-controlled values must not be concatenated into shell command strings.

### Deployment confirmation

Live deployment requires preflight and explicit confirmation by typing the exact target worker name.

Production code must not expose an environment variable or other undocumented bypass for this confirmation boundary.

### Local execution

Local `wrangler dev` is outside the current supported scope because the bundled `workerd` runtime cannot initialize in the tested Termux/PRoot environment.

The tool does not provide an alternative sandbox for executing arbitrary Worker code locally.

### Trust boundary

`wrangler-tui` operates with the developer's own permissions and Cloudflare account access. It is not a security sandbox.

Users should inspect unfamiliar project code and configuration before deploying it.

## Disclosure

After a report is received, the maintainer will investigate the issue, determine its scope, and decide on appropriate remediation.

Security acknowledgements, fixes, credits, and release announcements depend on the circumstances and the maintainer's available resources.
