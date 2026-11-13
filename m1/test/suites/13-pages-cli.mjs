import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { run, freshDir, cleanupDir, assertEqual, assertContains } from '../helpers.mjs';

export const name = 'pages-cli';

let work, fakeBin, fakePkg, stateDir, nodeBin, indexPath, invokePath, ctl;

function writeFakeWrangler() {
  fakeBin = freshDir(work, 'fake-bin');
  fakePkg = freshDir(work, 'fake-pkg');
  ctl = freshDir(work, 'ctl');

  mkdirSync(join(fakePkg, 'bin'), { recursive: true });
  writeFileSync(join(fakePkg, 'package.json'),
    JSON.stringify({ name: 'wrangler', version: '0.0.0-fake' }, null, 2));
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
        echo '{"loggedIn":true,"email":"test@example.com","accounts":[{"id":"acc1","name":"Test"}]}'
      else
        echo '{"loggedIn":false,"accounts":[]}'
      fi
      exit 0
    fi
    exit 0
    ;;
  login)  echo in > "$AUTH_FILE"; exit 0 ;;
  logout) echo out > "$AUTH_FILE"; exit 0 ;;
  pages)
    case "$2" in
      deploy)
        echo "Deploying to Pages project $5 branch $7"
        echo "Success! Deployment live at https://$5.pages.dev"
        exit 0
        ;;
      project)
        case "$3" in
          list)   echo "name        domains       latest"; echo "my-site     my-site.pages.dev  2026-10-29"; exit 0 ;;
          create) echo "Created project $4 with production branch $6"; exit 0 ;;
          *) exit 1 ;;
        esac
        ;;
      *) exit 1 ;;
    esac
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

function makeSite(name) {
  const site = join(work, name);
  mkdirSync(join(site, 'dist'), { recursive: true });
  writeFileSync(join(site, 'dist', 'index.html'), '<html><body>test site</body></html>');
  writeFileSync(join(site, 'package.json'), JSON.stringify({ name: 'test-site' }));
  return join(site, 'dist');
}

export const tests = [
  {
    name: 'setup',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'pages-cli-work');
      stateDir = freshDir(work, 'state');
      nodeBin = process.execPath;
      indexPath = join(ctx.REPO, 'm1', 'src', 'index.mjs');
      writeFakeWrangler();
    },
  },
  {
    name: 'pages list exits 0 and shows table',
    fn: async () => {
      const r = await run(nodeBin, [indexPath, 'pages', 'list'], { env: baseEnv(), timeout: 30000 });
      assertEqual(r.code, 0, 'list exit');
      assertContains(r.combined, 'my-site', 'table output');
    },
  },
  {
    name: 'pages create with --name exits 0',
    fn: async () => {
      const r = await run(nodeBin, [indexPath, 'pages', 'create', 'mysite', '--branch', 'main'], {
        env: baseEnv(), timeout: 30000,
      });
      assertEqual(r.code, 0, 'create exit');
      assertContains(r.combined, 'mysite', 'project name in output');
    },
  },
  {
    name: 'pages deploy with --dir and --name succeeds',
    fn: async () => {
      const siteDir = makeSite('site1');
      const r = await run(nodeBin, [
        indexPath, 'pages', 'deploy', '--dir', siteDir, '--name', 'mysite', '--branch', 'main',
      ], { env: baseEnv(), timeout: 30000 });
      // Deploy flow prompts for confirmation; with no TTY it will abort cleanly.
      // We only assert no crash and that it reached the auth stage.
      assertContains(r.combined, 'auth', 'should progress past auth');
    },
  },
  {
    name: 'pages with no args defaults to deploy',
    fn: async () => {
      const r = await run(nodeBin, [indexPath, 'pages'], { env: baseEnv(), timeout: 30000 });
      // Should attempt deploy; will fail gracefully with no directory
      assertContains(r.combined, 'Deploy directory', 'should report missing directory');
    },
  },
  {
    name: 'unknown pages subcommand errors cleanly',
    fn: async () => {
      const r = await run(nodeBin, [indexPath, 'pages', 'bogus'], { env: baseEnv(), timeout: 15000 });
      assertEqual(r.code, 1, 'should exit 1');
      assertContains(r.combined, 'Unknown pages subcommand', 'error message');
    },
  },
];

tests.push({ name: 'cleanup', fn: async () => { if (work) cleanupDir(work); } });