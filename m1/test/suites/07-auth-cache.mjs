import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { run, freshDir, cleanupDir, assert, assertEqual, assertContains } from '../helpers.mjs';

export const name = 'auth-cache';

let work, fakeBin, cacheDir, nodeBin, indexPath;

function writeFakeWrangler() {
  fakeBin = freshDir(work, 'fake-bin');
  const stateFile = join(work, 'fake-state.txt');
  writeFileSync(stateFile, 'in');
  const script = `#!/usr/bin/env bash
STATE_FILE="${stateFile}"
[ -f "$STATE_FILE" ] || echo in > "$STATE_FILE"
MODE=$(cat "$STATE_FILE")
case "$1" in
  whoami)
    if [ "\${2:-}" = "--json" ]; then
      if [ "$MODE" = "in" ]; then
        echo '{"loggedIn":true,"email":"test@example.com","accounts":[{"id":"acc1","name":"Test"}]}'
      else
        echo '{"loggedIn":false,"email":null,"accounts":[]}'
      fi
    else
      if [ "$MODE" = "in" ]; then echo "You are logged in."; else echo "You are not authenticated."; fi
    fi
    ;;
  --version) echo "wrangler 0.0.0-fake" ;;
  login)  echo in > "$STATE_FILE"; echo "logged in (fake)"; exit 0 ;;
  logout) echo out > "$STATE_FILE"; exit 0 ;;
  *) exit 1 ;;
esac
`;
  writeFileSync(join(fakeBin, 'wrangler'), script, { mode: 0o755 });
}

function baseEnv() {
  return {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    WRANGLER_TUI_STATE_DIR: cacheDir,
    WRANGLER_TUI_SHIM_START_MS: '',
    WRANGLER_TUI_TIMING_FILE: '',
    CLOUDFLARE_API_TOKEN: '',
  };
}

function readCache() {
  const p = join(cacheDir, 'auth-status.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function setFakeState(mode) {
  writeFileSync(join(work, 'fake-state.txt'), mode);
}

export const tests = [
  {
    name: 'setup fake wrangler',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'auth-cache-work');
      cacheDir = freshDir(work, 'state');
      nodeBin = process.execPath;
      indexPath = join(ctx.REPO, 'm1', 'src', 'index.mjs');
      assert(existsSync(indexPath), 'index.mjs missing');
      writeFakeWrangler();
    },
  },
  {
    name: 'first auth writes cache with verifiedAt',
    fn: async () => {
      setFakeState('in');
      const r = await run(nodeBin, [indexPath, 'auth'], { env: baseEnv(), timeout: 30000 });
      assertEqual(r.code, 0, 'auth exit');
      const cache = readCache();
      assert(cache !== null, 'cache file not written');
      assertEqual(cache.authenticated, true);
      assertEqual(cache.email, 'test@example.com');
      assert(typeof cache.verifiedAt === 'number' && cache.verifiedAt > 0, 'verifiedAt missing');
      assert(typeof cache.key === 'string' && cache.key.length === 64, 'cache key missing');
    },
  },
  {
    name: 'auth --refresh forces fresh check and updates verifiedAt',
    fn: async () => {
      setFakeState('in');
      const before = readCache().verifiedAt;
      await new Promise((res) => setTimeout(res, 50));
      const r = await run(nodeBin, [indexPath, 'auth', '--refresh'], { env: baseEnv(), timeout: 30000 });
      assertEqual(r.code, 0);
      const after = readCache().verifiedAt;
      assert(after > before, `--refresh should update verifiedAt (${before} -> ${after})`);
    },
  },
  {
    name: 'CLOUDFLARE_API_TOKEN change invalidates cache',
    fn: async () => {
      setFakeState('in');
      await run(nodeBin, [indexPath, 'auth'], { env: baseEnv(), timeout: 30000 });
      const key1 = readCache().key;

      const envWithToken = { ...baseEnv(), CLOUDFLARE_API_TOKEN: 'fake-token' };
      const r = await run(nodeBin, [indexPath, 'auth'], { env: envWithToken, timeout: 30000 });
      assertEqual(r.code, 0);
      const key2 = readCache().key;
      assert(key1 !== key2, 'cache key should change when CLOUDFLARE_API_TOKEN presence changes');
    },
  },
  {
    name: 'logout invalidates cache and reflects unauthenticated state',
    fn: async () => {
      setFakeState('in');
      const env = baseEnv();
      await run(nodeBin, [indexPath, 'auth'], { env, timeout: 30000 });
      const before = readCache();
      assert(before !== null && before.authenticated === true, 'should be authenticated before logout');

      const r = await run(nodeBin, [indexPath, 'logout'], { env, timeout: 30000 });
      assertEqual(r.code, 0);

      const after = readCache();
      assert(after !== null, 'cache should exist after logout (fresh state write)');
      assertEqual(after.authenticated, false, 'cache must report unauthenticated after logout');
      assert(after.verifiedAt > before.verifiedAt, 'verifiedAt should advance after logout');
    },
  },
  {
    name: 'cache hit displays age and slides verifiedAt',
    fn: async () => {
      // Normalize: ensure fake wrangler is logged in and cache is authenticated
      setFakeState('in');
      const env = baseEnv();
      const norm = await run(nodeBin, [indexPath, 'auth', '--refresh'], { env, timeout: 30000 });
      assertEqual(norm.code, 0, 'normalize exit');
      const cached = readCache();
      assert(cached !== null, 'cache should exist after refresh');
      assertEqual(cached.authenticated, true, 'cache should be authenticated after refresh');

      // Precondition guaranteed. Now test cache-hit display + sliding window.
      await new Promise((res) => setTimeout(res, 50));
      const before = cached.verifiedAt;
      const r = await run(nodeBin, [indexPath, 'auth'], { env, timeout: 30000 });
      assertEqual(r.code, 0, 'auth exit');
      assertContains(r.combined, 'verified', 'should say "verified"');
      assertContains(r.combined, 'ago', 'should say "Ns ago"');
      const after = readCache().verifiedAt;
      assert(after >= before, `sliding should advance verifiedAt (${before} -> ${after})`);
      assert(after - before < 5000, `slide should be small (${after - before}ms)`);
    },
  },
];

tests.push({
  name: 'cleanup',
  fn: async () => { if (work) cleanupDir(work); },
});