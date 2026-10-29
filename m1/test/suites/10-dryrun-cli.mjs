import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { run, freshDir, cleanupDir, createProject, assert, assertEqual, assertContains } from '../helpers.mjs';

export const name = 'dryrun-cli';

let work, fakeBin, fakePkg, stateDir, projectDir, nodeBin, indexPath, invokePath, ctl;

function writeFakeWrangler() {
  fakeBin = freshDir(work, 'fake-bin');
  fakePkg = freshDir(work, 'fake-pkg');
  ctl = freshDir(work, 'ctl');

  mkdirSync(join(fakePkg, 'bin'), { recursive: true });
  writeFileSync(
    join(fakePkg, 'package.json'),
    JSON.stringify({ name: 'wrangler', version: '0.0.0-fake' }, null, 2)
  );
  writeFileSync(join(ctl, 'auth.txt'), 'in');
  writeFileSync(join(ctl, 'version-calls.txt'), '0');
  writeFileSync(join(ctl, 'live-deploy-calls.txt'), '0');

  const script = `#!/usr/bin/env bash
CTL="${ctl}"
AUTH_FILE="$CTL/auth.txt"
DEPLOY_FAIL="$CTL/deploy-fail.txt"
VERSION_CALLS="$CTL/version-calls.txt"
LIVE_CALLS="$CTL/live-deploy-calls.txt"
[ -f "$AUTH_FILE" ] || echo in > "$AUTH_FILE"
[ -f "$VERSION_CALLS" ] || echo 0 > "$VERSION_CALLS"
[ -f "$LIVE_CALLS" ] || echo 0 > "$LIVE_CALLS"
AUTH=$(cat "$AUTH_FILE")
case "$1" in
  --version)
    echo "$(( $(cat "$VERSION_CALLS") + 1 ))" > "$VERSION_CALLS"
    echo "wrangler 0.0.0-fake"
    exit 0
    ;;
  whoami)
    if [ "\${2:-}" = "--json" ]; then
      if [ "$AUTH" = "in" ]; then
        echo '{"loggedIn":true,"email":"test@example.com","accounts":[{"id":"acc1","name":"Test"}]}'
      else
        echo '{"loggedIn":false,"accounts":[]}'
      fi
      exit 0
    fi
    exit 0
    ;;
  login)  echo in > "$AUTH_FILE";  exit 0 ;;
  logout) echo out > "$AUTH_FILE"; exit 0 ;;
  deploy)
    for arg in "$@"; do
      if [ "$arg" = "--dry-run" ]; then
        echo "Total Upload: 0.18 KiB"
        echo "Dry run successful"
        exit 0
      fi
    done
    echo "$(( $(cat "$LIVE_CALLS") + 1 ))" > "$LIVE_CALLS"
    if [ -f "$DEPLOY_FAIL" ]; then
      echo "Error: simulated deploy failure" >&2
      exit 1
    fi
    echo "Deployed ok"
    exit 0
    ;;
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
  };
}

function readCounter(name) {
  try {
    return parseInt(readFileSync(join(ctl, name), 'utf8').trim(), 10) || 0;
  } catch { return 0; }
}

function resetCounters() {
  writeFileSync(join(ctl, 'version-calls.txt'), '0');
  writeFileSync(join(ctl, 'live-deploy-calls.txt'), '0');
}

async function invokeDeploy(args) {
  return run(nodeBin, [invokePath, ...args], { env: baseEnv(), timeout: 30000 });
}

export const tests = [
  {
    name: 'setup',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'dryrun-cli-work');
      stateDir = freshDir(work, 'state');
      projectDir = join(work, 'project');
      createProject(projectDir, 'dryrun-cli-test');
      nodeBin = process.execPath;
      indexPath = join(ctx.REPO, 'm1', 'src', 'index.mjs');
      invokePath = join(ctx.REPO, 'm1', 'test', 'invoke-deploy.mjs');
      assert(existsSync(indexPath), 'index.mjs missing');
      assert(existsSync(invokePath), 'invoke-deploy.mjs missing');
      writeFakeWrangler();
    },
  },
  {
    name: 'first deploy runs dry-run and caches',
    fn: async () => {
      resetCounters();
      const r = await invokeDeploy(['--dir', projectDir]);
      assertEqual(r.code, 0, 'deploy exit');
      assertContains(r.combined, 'Dry-run passed', 'first run must execute dry-run');
      assert(existsSync(join(stateDir, 'dryrun-cache')), 'cache dir not created');
    },
  },
  {
    name: 'warm deploy does not spawn wrangler --version',
    fn: async () => {
      resetCounters();
      const r = await invokeDeploy(['--dir', projectDir]);
      assertEqual(r.code, 0, 'deploy exit');
      assertContains(r.combined, 'Preflight cached', 'second run should hit cache');
      assertEqual(readCounter('version-calls.txt'), 0, 'warm path must not spawn wrangler --version');
    },
  },
  {
    name: 'source change invalidates cache',
    fn: async () => {
      writeFileSync(
        join(projectDir, 'src', 'index.js'),
        `export default { async fetch() { return new Response("changed"); } };\n`
      );
      const r = await invokeDeploy(['--dir', projectDir]);
      assertEqual(r.code, 0);
      assertContains(r.combined, 'Dry-run passed', 'changed source must trigger dry-run');
    },
  },
  {
    name: '--fresh forces fresh dry-run even with unchanged source',
    fn: async () => {
      const r = await invokeDeploy(['--dir', projectDir, '--fresh']);
      assertEqual(r.code, 0);
      assertContains(r.combined, 'Dry-run passed', '--fresh must run dry-run');
    },
  },
  {
    name: 'deploy failure invalidates dry-run cache',
    fn: async () => {
      const r1 = await invokeDeploy(['--dir', projectDir]);
      assertEqual(r1.code, 0, 'prime exit');

      writeFileSync(join(ctl, 'deploy-fail.txt'), '1');

      const r2 = await invokeDeploy(['--dir', projectDir]);
      assertEqual(r2.code, 1, 'deploy should fail');
      assertContains(r2.combined, 'Deploy failed', 'failure must be reported');

      const cacheDir = join(stateDir, 'dryrun-cache');
      const entries = existsSync(cacheDir) ? readdirSync(cacheDir) : [];
      assertEqual(entries.length, 0, 'cache must be invalidated on deploy failure');

      unlinkSync(join(ctl, 'deploy-fail.txt'));
    },
  },
  {
    name: 'production CLI ignores confirmation-skipping env vars',
    fn: async () => {
      // Prime cache so we skip the dry-run cost in the real CLI path
      await invokeDeploy(['--dir', projectDir]);
      resetCounters();

      const env = baseEnv();
      // Attacker-style: try every env-var bypass name we have or might have
      env.WRANGLER_TUI_AUTO_CONFIRM = 'dryrun-cli-test';
      env.WRANGLER_TUI_TEST_CONFIRM = 'dryrun-cli-test';
      env.WRANGLER_TUI_TEST_MODE = '1';

      // Spawn real CLI, close stdin immediately (no input for confirmation prompt)
      const r = await run(nodeBin, [indexPath, 'deploy', '--dir', projectDir], {
        env,
        timeout: 15000,
        stdin: '',                      // close stdin
      });

      // Regardless of how clack fails on closed stdin, no live deploy may occur
      assertEqual(readCounter('live-deploy-calls.txt'), 0,
        'production CLI must not spawn live wrangler deploy without typed confirmation');
      assert(!r.combined.includes('Deployed successfully'),
        'production CLI must not claim success without confirmation');
    },
  },
];

tests.push({
  name: 'cleanup',
  fn: async () => { if (work) cleanupDir(work); },
});