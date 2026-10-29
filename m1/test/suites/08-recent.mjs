import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { run, freshDir, cleanupDir, assert, assertEqual } from '../helpers.mjs';

export const name = 'recent';

let work, stateDir, nodeBin;

function recentFile() { return join(stateDir, 'recent-projects.json'); }

export const tests = [
  {
    name: 'setup',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'recent-work');
      stateDir = freshDir(work, 'state');
      nodeBin = process.execPath;
    },
  },
  {
    name: 'record adds to front and de-dupes',
    fn: async () => {
      const recentPath = join(process.env.REPO, 'm1', 'src', 'recent.mjs').replace(/\\/g, '/');
      const script = `
        process.env.WRANGLER_TUI_STATE_DIR = ${JSON.stringify(stateDir)};
        const m = await import(${JSON.stringify('file://' + recentPath)});
        m.record('/a/b');
        m.record('/c/d');
        m.record('/a/b');
        process.stdout.write(JSON.stringify(m.load()));
      `;
      const r = await run(nodeBin, ['--input-type=module', '-e', script]);
      assertEqual(r.code, 0);
      const arr = JSON.parse(r.stdout);
      assertEqual(arr[0], '/a/b', 'most recent first');
      assertEqual(arr[1], '/c/d');
      assertEqual(arr.length, 2, 'dupes removed');
    },
  },
  {
    name: 'record caps at 10',
    fn: async () => {
      const recentPath = join(process.env.REPO, 'm1', 'src', 'recent.mjs').replace(/\\/g, '/');
      const script = `
        process.env.WRANGLER_TUI_STATE_DIR = ${JSON.stringify(stateDir)};
        const m = await import(${JSON.stringify('file://' + recentPath)});
        m.clear();
        for (let i = 0; i < 15; i++) m.record('/p/' + i);
        const l = m.load();
        process.stdout.write(JSON.stringify({ len: l.length, first: l[0], last: l[l.length-1] }));
      `;
      const r = await run(nodeBin, ['--input-type=module', '-e', script]);
      assertEqual(r.code, 0);
      const out = JSON.parse(r.stdout);
      assertEqual(out.len, 10);
      assertEqual(out.first, '/p/14');
      assertEqual(out.last, '/p/5');
    },
  },
];

tests.push({ name: 'cleanup', fn: async () => { if (work) cleanupDir(work); } });