import { join } from 'node:path';
import { writeFileSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { run, freshDir, cleanupDir, createProject, assertEqual, assert } from '../helpers.mjs';

export const name = 'interrupt';

let work, fakeBin, fakePkg, stateDir, nodeBin, indexPath, ctl;

function writeSlowFakeWrangler() {
  fakeBin = freshDir(work, 'fake-bin');
  fakePkg = freshDir(work, 'fake-pkg');
  ctl = freshDir(work, 'ctl');
  mkdirSync(join(fakePkg, 'bin'), { recursive: true });
  writeFileSync(join(fakePkg, 'package.json'),
    JSON.stringify({ name: 'wrangler', version: '0.0.0-fake' }));
  writeFileSync(join(ctl, 'auth.txt'), 'in');

  const script = `#!/usr/bin/env bash
CTL="${ctl}"
AUTH_FILE="$CTL/auth.txt"
[ -f "$AUTH_FILE" ] || echo in > "$AUTH_FILE"
AUTH=$(cat "$AUTH_FILE")
case "$1" in
  --version) echo "wrangler 0.0.0-fake"; exit 0 ;;
  whoami)
    if [ "\${2:-}" = "--json" ]; then
      if [ "$AUTH" = "in" ]; then
        echo '{"loggedIn":true,"email":"t@example.com","accounts":[{"id":"a1","name":"T"}]}'
      else
        echo '{"loggedIn":false,"accounts":[]}'
      fi
      exit 0
    fi
    exit 0 ;;
  login)  echo in > "$AUTH_FILE"; exit 0 ;;
  logout) echo out > "$AUTH_FILE"; exit 0 ;;
  deploy)
    for a in "$@"; do
      if [ "$a" = "--dry-run" ]; then
        echo "Starting dry-run..."
        # exec -a replaces bash with sleep, so the process we spawn
        # IS the process that hangs. Killing this PID kills the hang.
        exec -a fake-wrangler-sleep-marker sleep 30
      fi
    done
    echo "Deployed"
    exit 0 ;;
  *) exit 1 ;;
esac
`;
  writeFileSync(join(fakePkg, 'bin', 'wrangler'), script, { mode: 0o755 });
  symlinkSync(join(fakePkg, 'bin', 'wrangler'), join(fakeBin, 'wrangler'));
}

function baseEnv() {
  return {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    WRANGLER_TUI_STATE_DIR: stateDir,
    WRANGLER_TUI_SHIM_START_MS: '',
    WRANGLER_TUI_TIMING_FILE: '',
    CLOUDFLARE_API_TOKEN: '',
    WRANGLER_TUI_AUTH_TTL_MS: '0',    // force fresh auth so test is hermetic
  };
}

async function findOrphans() {
  const ps = await run('ps', ['-ef']);
  if (ps.code !== 0) return [];
  return ps.stdout.split('\n')
    .filter((l) => l.includes('fake-wrangler-sleep-marker') && !l.includes('grep'))
    .map((l) => l.trim());
}

export const tests = [
  {
    name: 'setup',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'interrupt-work');
      stateDir = freshDir(work, 'state');
      nodeBin = process.execPath;
      indexPath = join(ctx.REPO, 'm1', 'src', 'index.mjs');
      writeSlowFakeWrangler();
    },
  },
  {
    name: 'SIGINT during dry-run exits 130 and leaves no orphans',
    fn: async () => {
      const root = join(work, 'deploy-target');
      createProject(root, 'interrupt-test');

      // Confirm no orphans before we start
      const before = await findOrphans();
      assertEqual(before.length, 0, `clean start (found: ${before.join(' | ')})`);

      // Spawn deploy, SIGINT at 1.5s — lands during the 30s dry-run sleep.
      const r = await run(nodeBin, [indexPath, 'deploy', '--dir', root], {
        env: baseEnv(),
        signalAfterMs: 1500,
        signal: 'SIGINT',
        timeout: 30000,
      });

      assertEqual(r.code, 130, `should exit 130 (our SIGINT handler); got ${r.code}`);
      assertEqual(r.signal, null, `should exit via process.exit, not default SIGINT`);

      // Give the kernel a moment to reap the killed child
      await new Promise((res) => setTimeout(res, 500));

      const after = await findOrphans();
      assertEqual(after.length, 0, `no orphans expected; found: ${after.join(' | ')}`);
    },
  },
  {
    name: 'SIGTERM also exits cleanly',
    fn: async () => {
      const root = join(work, 'deploy-target');
      const r = await run(nodeBin, [indexPath, 'deploy', '--dir', root], {
        env: baseEnv(),
        signalAfterMs: 1500,
        signal: 'SIGTERM',
        timeout: 30000,
      });
      assertEqual(r.code, 143, `should exit 143 (SIGTERM handler); got ${r.code}`);
      assertEqual(r.signal, null, 'should exit via process.exit');

      await new Promise((res) => setTimeout(res, 500));
      const after = await findOrphans();
      assertEqual(after.length, 0, `no orphans after SIGTERM; found: ${after.join(' | ')}`);
    },
  },
];

tests.push({
  name: 'cleanup',
  fn: async () => {
    // Defensive: kill any orphans that slipped through
    try { await run('pkill', ['-f', 'fake-wrangler-sleep-marker']); } catch { /* ignore */ }
    if (work) cleanupDir(work);
  },
});