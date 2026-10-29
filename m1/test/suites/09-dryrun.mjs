import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { run, freshDir, cleanupDir, createProject, assert, assertEqual } from '../helpers.mjs';

export const name = 'dryrun';

let work, stateDir, projectDir, dryrunPath;

function importScript() {
  return `
    process.env.WRANGLER_TUI_STATE_DIR = ${JSON.stringify(stateDir)};
    const m = await import(${JSON.stringify('file://' + dryrunPath)});
    const target = {
      root: ${JSON.stringify(projectDir)},
      configPath: ${JSON.stringify(join(projectDir, 'wrangler.jsonc'))},
      config: JSON.parse(${JSON.stringify(readFileSync(join(projectDir, 'wrangler.jsonc'), 'utf8'))}),
      source: 'explicit',
    };
  `;
}

async function runNode(body) {
  return run(process.execPath, ['--input-type=module', '-e', importScript() + body]);
}

export const tests = [
  {
    name: 'setup',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'dryrun-work');
      stateDir = freshDir(work, 'state');
      projectDir = join(work, 'project');
      createProject(projectDir, 'dryrun-test');
      dryrunPath = join(ctx.REPO, 'm1', 'src', 'dryrun.mjs');
      assert(existsSync(dryrunPath), 'dryrun.mjs missing');
    },
  },
  {
    name: 'computeKey is stable for unchanged project',
    fn: async () => {
      const script = `
        const k1 = m.computeKey({ target, env: 'default', wranglerVersion: '4.0.0' });
        const k2 = m.computeKey({ target, env: 'default', wranglerVersion: '4.0.0' });
        process.stdout.write(JSON.stringify({ k1, k2 }));
      `;
      const r = await runNode(script);
      assertEqual(r.code, 0);
      const { k1, k2 } = JSON.parse(r.stdout);
      assertEqual(k1, k2, 'keys should match');
      assertEqual(k1.length, 64, 'sha256 hex length');
    },
  },
  {
    name: 'computeKey changes on source change',
    fn: async () => {
      const before = await runNode(`
        const k = m.computeKey({ target, env: 'default', wranglerVersion: '4.0.0' });
        process.stdout.write(k);
      `);
      writeFileSync(join(projectDir, 'src', 'index.js'), '// modified\n');
      const after = await runNode(`
        const k = m.computeKey({ target, env: 'default', wranglerVersion: '4.0.0' });
        process.stdout.write(k);
      `);
      assert(before.stdout !== after.stdout, 'source change should invalidate');
    },
  },
  {
    name: 'computeKey changes on config change',
    fn: async () => {
      const cfgPath = join(projectDir, 'wrangler.jsonc');
      const original = readFileSync(cfgPath, 'utf8');
      try {
        const cfg = JSON.parse(original);

        cfg.compatibility_date = '2025-12-31';
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
        const r1 = await runNode(`
          const k = m.computeKey({ target, env: 'default', wranglerVersion: '4.0.0' });
          process.stdout.write(k);
        `);

        cfg.compatibility_date = '2026-01-01';
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
        const r2 = await runNode(`
          const k = m.computeKey({ target, env: 'default', wranglerVersion: '4.0.0' });
          process.stdout.write(k);
        `);

        assertEqual(r1.code, 0, 'first key exit');
        assertEqual(r2.code, 0, 'second key exit');
        assertEqual(r1.stdout.length, 64, 'first key must be sha256 hex');
        assertEqual(r2.stdout.length, 64, 'second key must be sha256 hex');
        assert(r1.stdout !== r2.stdout, 'config change should invalidate');
      } finally {
        writeFileSync(cfgPath, original);
      }
    },
  },
  {
    name: 'computeKey changes on env change',
    fn: async () => {
      const a = await runNode(`
        const k = m.computeKey({ target, env: 'default', wranglerVersion: '4.0.0' });
        process.stdout.write(k);
      `);
      const b = await runNode(`
        const k = m.computeKey({ target, env: 'production', wranglerVersion: '4.0.0' });
        process.stdout.write(k);
      `);
      assert(a.stdout !== b.stdout, 'env change should invalidate');
    },
  },
  {
    name: 'computeKey changes on wrangler version change',
    fn: async () => {
      const a = await runNode(`
        const k = m.computeKey({ target, env: 'default', wranglerVersion: '4.0.0' });
        process.stdout.write(k);
      `);
      const b = await runNode(`
        const k = m.computeKey({ target, env: 'default', wranglerVersion: '4.152.0' });
        process.stdout.write(k);
      `);
      assert(a.stdout !== b.stdout, 'version change should invalidate');
    },
  },
  {
    name: 'store + lookup round-trip',
    fn: async () => {
      const script = `
        m.store({ target, env: 'default', wranglerVersion: '4.0.0', dryRunExit: 0, durationMs: 20000 });
        const hit = m.lookup({ target, env: 'default', wranglerVersion: '4.0.0' });
        process.stdout.write(JSON.stringify(hit));
      `;
      const r = await runNode(script);
      assertEqual(r.code, 0);
      const hit = JSON.parse(r.stdout);
      assertEqual(hit.hit, true);
      assert(typeof hit.ageMs === 'number', 'ageMs missing');
      assertEqual(hit.durationMs, 20000);
    },
  },
  {
    name: 'lookup misses on key mismatch',
    fn: async () => {
      const script = `
        m.store({ target, env: 'default', wranglerVersion: '4.0.0', dryRunExit: 0, durationMs: 20000 });
        const hit = m.lookup({ target, env: 'production', wranglerVersion: '4.0.0' });
        process.stdout.write(JSON.stringify(hit));
      `;
      const r = await runNode(script);
      const hit = JSON.parse(r.stdout);
      assertEqual(hit.hit, false);
      assertEqual(hit.reason, 'key-mismatch');
    },
  },
  {
    name: 'lookup misses on version change',
    fn: async () => {
      const script = `
        m.store({ target, env: 'default', wranglerVersion: '4.0.0', dryRunExit: 0, durationMs: 20000 });
        const hit = m.lookup({ target, env: 'default', wranglerVersion: '4.152.0' });
        process.stdout.write(JSON.stringify(hit));
      `;
      const r = await runNode(script);
      const hit = JSON.parse(r.stdout);
      assertEqual(hit.hit, false);
    },
  },
  {
    name: 'invalidate removes cache file',
    fn: async () => {
      const script = `
        m.store({ target, env: 'default', wranglerVersion: '4.0.0', dryRunExit: 0, durationMs: 20000 });
        const before = m.lookup({ target, env: 'default', wranglerVersion: '4.0.0' });
        m.invalidate(target);
        const after = m.lookup({ target, env: 'default', wranglerVersion: '4.0.0' });
        process.stdout.write(JSON.stringify({ before: before.hit, after: after.hit }));
      `;
      const r = await runNode(script);
      const { before, after } = JSON.parse(r.stdout);
      assertEqual(before, true, 'should hit before invalidate');
      assertEqual(after, false, 'should miss after invalidate');
    },
  },
  {
    name: 'lookup never throws on missing cache directory',
    fn: async (ctx) => {
      const emptyState = freshDir(ctx.STATE, 'empty-state');
      const script = `
        process.env.WRANGLER_TUI_STATE_DIR = ${JSON.stringify(emptyState)};
        const m2 = await import(${JSON.stringify('file://' + dryrunPath)} + '?fresh=1');
        const hit = m2.lookup({ target, env: 'default', wranglerVersion: '4.0.0' });
        process.stdout.write(JSON.stringify(hit));
      `;
      const r = await runNode(script);
      assertEqual(r.code, 0, 'should not throw');
      const hit = JSON.parse(r.stdout);
      assertEqual(hit.hit, false);
    },
  },
];

tests.push({
  name: 'cleanup',
  fn: async () => { if (work) cleanupDir(work); },
});