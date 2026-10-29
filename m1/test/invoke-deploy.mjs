#!/usr/bin/env node
// Test-only entry. Invokes deploy.flow() with a stub confirmFn.
// NOT part of the production CLI. Never imported by src/.
// Production CLI (src/index.mjs) uses deploy.flow() with defaultConfirm,
// which requires typed confirmation — no env-var bypass exists.
import { resolveTarget } from '../src/project.mjs';
import * as deploy from '../src/deploy.mjs';

const args = process.argv.slice(2);
let dir = null;
let fresh = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir') { dir = args[++i]; continue; }
  if (args[i] === '--fresh') { fresh = true; continue; }
}

const target = resolveTarget({ dir });
if (!target) { console.error('no project resolved'); process.exit(1); }

const result = await deploy.flow(target, '', {
  fresh,
  confirmFn: async (name) => {
    console.error(`[test-only] auto-confirm "${name}"`);
    return name;
  },
});

process.exit(result.ok ? 0 : 1);