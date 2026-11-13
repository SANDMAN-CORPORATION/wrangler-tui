import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { run, freshDir, cleanupDir, assertEqual, assertContains, assertNotContains, assert } from '../helpers.mjs';

export const name = 'adopt-cli';

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
      deploy) echo "Pages deployed $3"; exit 0 ;;
      project)
        case "$3" in
          list) echo "my-site  my-site.pages.dev"; exit 0 ;;
          create) echo "created $4"; exit 0 ;;
          *) exit 1 ;;
        esac ;;
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

function argvLog() {
  try { return readFileSync(join(ctl, 'argv.log'), 'utf8'); } catch { return ''; }
}

function resetArgv() { writeFileSync(join(ctl, 'argv.log'), ''); }

function makeSite(name) {
  const root = join(work, name);
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist', 'index.html'), '<html>hi</html>');
  return root;
}

export const tests = [
  {
    name: 'setup',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'adopt-cli-work');
      stateDir = freshDir(work, 'state');
      nodeBin = process.execPath;
      indexPath = join(ctx.REPO, 'm1', 'src', 'index.mjs');
      writeFakeWrangler();
    },
  },
  {
    name: 'adopt --target worker-assets writes wrangler.jsonc',
    fn: async () => {
      const root = makeSite('site-worker');
      const r = await run(nodeBin, [
        indexPath, 'adopt', '--dir', root, '--target', 'worker-assets',
        '--preset', 'spa', '--name', 'adopted-worker',
      ], { env: baseEnv(), timeout: 30000 });
      assertEqual(r.code, 0, 'adopt exit');
      const cfg = JSON.parse(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'));
      assertEqual(cfg.name, 'adopted-worker');
      assertEqual(cfg.assets.directory, './dist');
      assertEqual(cfg.assets.not_found_handling, 'single-page-application');
    },
  },
  {
    name: 'deploy after adopt runs dry-run with the adopted config',
    fn: async () => {
      const root = join(work, 'site-worker');
      resetArgv();
      const r = await run(nodeBin, [indexPath, 'deploy', '--dir', root], {
        env: { ...baseEnv(), WRANGLER_TUI_AUTO_CONFIRM_UNUSED: '' },
        timeout: 20000,
      });
      // Confirmation prompt aborts without a TTY; the assertion is that the
      // dry-run reached wrangler with the config in place.
      assertContains(argvLog(), 'deploy --dry-run', 'dry-run invoked');
      assertContains(r.combined, './dist', 'assets dir shown in target note');
    },
  },
  {
    name: 'adopt --target pages writes marker',
    fn: async () => {
      const root = makeSite('site-pages');
      const r = await run(nodeBin, [
        indexPath, 'adopt', '--dir', root, '--target', 'pages',
        '--name', 'my-pages', '--branch', 'main',
      ], { env: baseEnv(), timeout: 30000 });
      assertEqual(r.code, 0, 'adopt exit');
      const marker = JSON.parse(readFileSync(join(root, '.wrangler-tui.json'), 'utf8'));
      assertEqual(marker.target, 'pages');
      assertEqual(marker.projectName, 'my-pages');
      assertEqual(marker.assetsDir, './dist');
    },
  },
  {
  name: 'pages deploy uses marker defaults without prompts',
  fn: async () => {
    const root = join(work, 'site-pages');
    resetArgv();
    const r = await run(nodeBin, [indexPath, 'pages', 'deploy', '--dir', root], {
      env: baseEnv(), timeout: 30000,
    });
    // The marker supplies project name and branch — no prompts should appear.
    // Assert on the project name (proves marker read) and on a short
    // substring of the path (clack wraps long paths across lines at 80 cols).
    assertContains(r.combined, 'my-pages', 'marker project name used');
    assertContains(r.combined, 'site-pages/dist', 'marker assets dir used');
    assertNotContains(r.combined, 'Pages project name:', 'should not prompt for name');
    assertNotContains(r.combined, 'Branch (production URL uses this):', 'should not prompt for branch');
  },
},
  {
    name: 'adopt rejects a nonexistent assets dir',
    fn: async () => {
      const root = makeSite('site-bad');
      const r = await run(nodeBin, [
        indexPath, 'adopt', '--dir', root,
        '--target', 'worker-assets', '--assets-dir', join(root, 'nope'),
      ], { env: baseEnv(), timeout: 15000 });
      assertEqual(r.code, 1);
      assertContains(r.combined, 'does not exist');
    },
  },
];

tests.push({ name: 'cleanup', fn: async () => { if (work) cleanupDir(work); } });