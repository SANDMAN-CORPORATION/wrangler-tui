import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { run, freshDir, cleanupDir, createProject, assertEqual, assertContains, assertNotContains } from '../helpers.mjs';

export const name = 'validate-cli';

let work, fakeBin, fakePkg, stateDir, nodeBin, indexPath, ctl;

function writeFakeWrangler() {
  fakeBin = freshDir(work, 'fake-bin');
  fakePkg = freshDir(work, 'fake-pkg');
  ctl = freshDir(work, 'ctl');
  mkdirSync(join(fakePkg, 'bin'), { recursive: true });
  writeFileSync(join(fakePkg, 'package.json'), JSON.stringify({ name: 'wrangler', version: '0.0.0-fake' }));
  writeFileSync(join(ctl, 'auth.txt'), 'in');
  writeFileSync(join(ctl, 'argv.log'), '');

  const script = `#!/usr/bin/env bash
CTL="${ctl}"
printf '%s\\n' "$*" >> "$CTL/argv.log"
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
    for a in "$@"; do [ "$a" = "--dry-run" ] && { echo "Dry run ok"; exit 0; }; done
    echo "Deployed ok"; exit 0 ;;
  pages)
    case "$2" in
      deploy) echo "Pages deployed"; exit 0 ;;
      *) exit 1 ;;
    esac ;;
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

function readArgv() {
  try { return readFileSync(join(ctl, 'argv.log'), 'utf8'); } catch { return ''; }
}

function resetArgv() { writeFileSync(join(ctl, 'argv.log'), ''); }

export const tests = [
  {
    name: 'setup',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'validate-cli-work');
      stateDir = freshDir(work, 'state');
      nodeBin = process.execPath;
      indexPath = join(ctx.REPO, 'm1', 'src', 'index.mjs');
      writeFakeWrangler();
    },
  },
  {
    name: 'deploy with missing main fails validation before spawning wrangler',
    fn: async () => {
      const root = join(work, 'missing-main');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'wrangler.jsonc'),
        JSON.stringify({ name: 'x', main: 'src/index.js', compatibility_date: '2025-01-01' }));
      resetArgv();
      const r = await run(nodeBin, [indexPath, 'deploy', '--dir', root], {
        env: baseEnv(), timeout: 15000,
      });
      assertEqual(r.code, 1, 'should exit 1');
      assertContains(r.combined, 'Pre-deploy check — blocked');
      assertContains(r.combined, 'entry point not found');
      assertNotContains(readArgv(), 'deploy', 'wrangler deploy must not have been spawned');
    },
  },
  {
    name: 'deploy with missing assets directory fails validation',
    fn: async () => {
      const root = join(work, 'missing-assets');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'wrangler.jsonc'),
        JSON.stringify({ name: 'x', assets: { directory: './dist' }, compatibility_date: '2025-01-01' }));
      resetArgv();
      const r = await run(nodeBin, [indexPath, 'deploy', '--dir', root], {
        env: baseEnv(), timeout: 15000,
      });
      assertEqual(r.code, 1);
      assertContains(r.combined, 'Assets directory not found');
      assertNotContains(readArgv(), 'deploy', 'wrangler deploy must not have been spawned');
    },
  },
  {
    name: 'valid worker reaches preflight',
    fn: async () => {
      const root = join(work, 'valid-worker');
      createProject(root, 'valid-test');
      resetArgv();
      const r = await run(nodeBin, [indexPath, 'deploy', '--dir', root], {
        env: baseEnv(), timeout: 15000,
      });
      assertContains(readArgv(), 'deploy --dry-run', 'validation passed, preflight ran');
      assertNotContains(r.combined, 'Pre-deploy check — blocked');
    },
  },
  {
    name: 'pages deploy with empty directory fails validation',
    fn: async () => {
      const root = join(work, 'empty-pages');
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, '.wrangler-tui.json'),
        JSON.stringify({ target: 'pages', projectName: 'p', assetsDir: './dist', branch: 'main' }));
      resetArgv();
      const r = await run(nodeBin, [indexPath, 'pages', 'deploy', '--dir', root], {
        env: baseEnv(), timeout: 15000,
      });
      assertEqual(r.code, 1);
      assertContains(r.combined, 'Pages pre-deploy check — blocked');
      assertContains(r.combined, 'empty');
      assertNotContains(readArgv(), 'pages deploy', 'wrangler pages deploy must not have been spawned');
    },
  },
];

tests.push({ name: 'cleanup', fn: async () => { if (work) cleanupDir(work); } });