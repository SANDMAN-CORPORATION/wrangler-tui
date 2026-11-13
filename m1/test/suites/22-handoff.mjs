import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { run, freshDir, cleanupDir, createProject, assertEqual, assertContains, assert } from '../helpers.mjs';

export const name = 'handoff';

let work, fakeBin, fakePkg, stateDir, nodeBin, indexPath, invokePath, ctl, queueDir;

function writeFakeWrangler() {
  fakeBin = freshDir(work, 'fake-bin');
  fakePkg = freshDir(work, 'fake-pkg');
  ctl = freshDir(work, 'ctl');
  mkdirSync(join(fakePkg, 'bin'), { recursive: true });
  writeFileSync(join(fakePkg, 'package.json'), JSON.stringify({ name: 'wrangler', version: '0.0.0-fake' }));
  writeFileSync(join(ctl, 'auth.txt'), 'in');
  writeFileSync(join(ctl, 'deploy-out.txt'),
    'Total Upload: 0.18 KiB\n' +
    'Worker Startup Time: 1 ms\n' +
    'Uploaded test-worker (4.49 sec)\n' +
    'Deployed test-worker triggers (3.18 sec)\n' +
    '  https://test-worker.test.workers.dev\n' +
    'Current Version ID: abc-123\n');

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
    for a in "$@"; do [ "$a" = "--dry-run" ] && { echo "Dry run ok"; exit 0; }; done
    cat "$CTL/deploy-out.txt"
    exit 0 ;;
  pages)
    case "$2" in
      deploy)
        echo "Deploying to Pages"
        echo "✨ Deployment complete! Take a peek over at https://test-site.pages.dev"
        exit 0 ;;
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

function clearQueue() {
  queueDir = join(stateDir, 'url-requests');
  if (!existsSync(queueDir)) return;
  for (const f of readdirSync(queueDir)) {
    try { unlinkSync(join(queueDir, f)); } catch { /* ignore */ }
  }
}

function queueUrls() {
  const dir = join(stateDir, 'url-requests');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.url'))
    .map((f) => {
      try { return readFileSync(join(dir, f), 'utf8').trim(); } catch { return null; }
    })
    .filter(Boolean);
}

function parseResult(stdout) {
  const lines = stdout.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj && typeof obj === 'object' && 'ok' in obj) return obj;
    } catch { /* not json */ }
  }
  return null;
}

export const tests = [
  {
    name: 'setup',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'handoff-work');
      stateDir = freshDir(work, 'state');
      nodeBin = process.execPath;
      indexPath = join(ctx.REPO, 'm1', 'src', 'index.mjs');
      invokePath = join(ctx.REPO, 'm1', 'test', 'invoke-deploy.mjs');
      writeFakeWrangler();
      mkdirSync(join(stateDir, 'url-requests'), { recursive: true });
    },
  },
  {
    name: 'worker deploy success shows live and dashboard URLs',
    fn: async () => {
      const root = join(work, 'deploy-target');
      createProject(root, 'test-worker');
      const r = await run(nodeBin, [invokePath, '--dir', root], {
        env: baseEnv(),
        timeout: 20000,
      });
      assertEqual(r.code, 0, 'exit');
      assertContains(r.combined, 'Live:', 'live URL label');
      assertContains(r.combined, 'https://test-worker.test.workers.dev', 'extracted URL');
      assertContains(r.combined, 'Dashboard:', 'dashboard label');
      assertContains(r.combined, 'dash.cloudflare.com', 'dashboard host');
      assertContains(r.combined, 'workers/services/view/test-worker', 'dashboard path');

      const json = parseResult(r.stdout);
      assert(json !== null, 'JSON result missing');
      assertEqual(json.ok, true);
      assertEqual(json.deployedUrl, 'https://test-worker.test.workers.dev');
      assert(json.dashboardUrl && json.dashboardUrl.includes('test-worker'));
      assertEqual(json.name, 'test-worker');
    },
  },
  {
    name: 'worker deploy --open queues the dashboard URL',
    fn: async () => {
      const root = join(work, 'deploy-open');
      createProject(root, 'test-worker');
      clearQueue();
      const r = await run(nodeBin, [invokePath, '--dir', root, '--open'], {
        env: baseEnv(),
        timeout: 20000,
      });
      if (r.code !== 0) {
  console.error('[debug] invoke-deploy stderr:', r.stderr);
  console.error('[debug] invoke-deploy stdout:', r.stdout);
      }
      assertEqual(r.code, 0, 'exit');
      const urls = queueUrls();
      assert(urls.length >= 1, `expected at least one URL queued, got ${urls.length}`);
      assert(
        urls.some((u) => u.includes('dash.cloudflare.com') && u.includes('test-worker')),
        `dashboard URL must be queued; got: ${JSON.stringify(urls)}`
      );
    },
  },
  {
    name: 'pages deploy success shows live and dashboard URLs',
    fn: async () => {
      const root = join(work, 'pages-target');
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist', 'index.html'), '<html></html>');
      writeFileSync(join(root, '.wrangler-tui.json'), JSON.stringify({
        target: 'pages',
        projectName: 'test-site',
        assetsDir: './dist',
        branch: 'main',
      }));
      const r = await run(nodeBin, [invokePath, 'pages', '--dir', root], {
        env: baseEnv(),
        timeout: 20000,
      });
      assertEqual(r.code, 0, 'exit');
      assertContains(r.combined, 'Live:', 'live URL label');
      assertContains(r.combined, 'https://test-site.pages.dev', 'extracted URL');
      assertContains(r.combined, 'Dashboard:', 'dashboard label');
      assertContains(r.combined, 'pages/view/test-site', 'pages dashboard path');

      const json = parseResult(r.stdout);
      assert(json !== null, 'JSON result missing');
      assertEqual(json.ok, true);
      assertEqual(json.deployedUrl, 'https://test-site.pages.dev');
      assert(json.dashboardUrl && json.dashboardUrl.includes('pages/view/test-site'));
      assertEqual(json.name, 'test-site');
    },
  },
];

tests.push({
  name: 'cleanup',
  fn: async () => { if (work) cleanupDir(work); },
});