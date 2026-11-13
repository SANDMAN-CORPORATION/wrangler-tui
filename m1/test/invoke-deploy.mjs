#!/usr/bin/env node
// Test-only entry. Invokes deploy.flow() or pages.deployFlow() with a stub
// confirmFn. NOT part of the production CLI. Never imported by src/.
// Production CLI (src/index.mjs) uses the interactive confirm — no env-var
// bypass exists, and suite 10 asserts this.

import { resolveTarget } from '../src/project.mjs';
import * as deploy from '../src/deploy.mjs';
import * as pages from '../src/pages.mjs';
import { queueUrl } from '../src/bridge.mjs';

const args = process.argv.slice(2);
let dir = null;
let fresh = false;
let open = false;
let pagesDeploy = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dir') { dir = args[++i]; continue; }
  if (a === '--fresh') { fresh = true; continue; }
  if (a === '--open') { open = true; continue; }
  if (a === 'pages') { pagesDeploy = true; continue; }
}

const stubConfirm = async (name) => {
  process.stderr.write(`[test-only] auto-confirm "${name}"\n`);
  return name;
};

let result;

try {
  if (pagesDeploy) {
    result = await pages.deployFlow({ dir, confirmFn: stubConfirm });
  } else {
    const target = resolveTarget({ dir });
    if (!target) {
      console.error('no project resolved');
      process.exit(1);
    }
    result = await deploy.flow(target, '', { fresh, confirmFn: stubConfirm });
  }
} catch (err) {
  console.error('invoke-deploy error:', err.message);
  process.exit(2);
}

if (open && result.ok && result.dashboardUrl) {
  queueUrl(result.dashboardUrl);
}

// Structured result on stdout — the last line of output.
// Human-readable clack notes appear above it.
console.log(JSON.stringify({
  ok: !!result.ok,
  phase: result.phase || null,
  cancelled: !!result.cancelled,
  deployedUrl: result.deployedUrl || null,
  dashboardUrl: result.dashboardUrl || null,
  name: result.name || result.projectName || null,
}));

process.exit(result.ok ? 0 : 1);