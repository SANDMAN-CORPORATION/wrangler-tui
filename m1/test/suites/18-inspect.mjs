import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { run, freshDir, cleanupDir, assertEqual, assertContains } from '../helpers.mjs';

export const name = 'inspect';

let work, nodeBin, indexPath;

export const tests = [
  {
    name: 'setup',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'inspect-work');
      nodeBin = process.execPath;
      indexPath = join(ctx.REPO, 'm1', 'src', 'index.mjs');
    },
  },
  {
    name: 'inspect on vite project shows evidence and recommendation',
    fn: async () => {
      const d = join(work, 'vite'); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'vite.config.ts'), '');
      mkdirSync(join(d, 'dist'), { recursive: true });
      writeFileSync(join(d, 'dist', 'index.html'), '');

      const r = await run(nodeBin, [indexPath, 'inspect', '--dir', d], {
        env: { WRANGLER_TUI_STATE_DIR: work },
        timeout: 15000,
      });
      assertEqual(r.code, 0, 'inspect exit');
      assertContains(r.combined, 'Vite project', 'detected shape');
      assertContains(r.combined, 'vite.config.ts', 'evidence shown');
      assertContains(r.combined, 'Workers static assets', 'recommendation');
      assertContains(r.combined, 'wrangler-tui adopt', 'next step');
    },
  },
  {
    name: 'inspect on nextjs blocked shows adapter instructions',
    fn: async () => {
      const d = join(work, 'next'); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'next.config.js'), '');

      const r = await run(nodeBin, [indexPath, 'inspect', '--dir', d], {
        env: { WRANGLER_TUI_STATE_DIR: work },
        timeout: 15000,
      });
      assertEqual(r.code, 1, 'blocked exit code');
      assertContains(r.combined, 'Next.js', 'detected');
      assertContains(r.combined, '@opennextjs/cloudflare', 'fix mentioned');
    },
  },
  {
    name: 'inspect on already-worker project says ready',
    fn: async () => {
      const d = join(work, 'worker'); mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'wrangler.jsonc'), JSON.stringify({ name: 'w', main: 'src/index.js' }));

      const r = await run(nodeBin, [indexPath, 'inspect', '--dir', d], {
        env: { WRANGLER_TUI_STATE_DIR: work },
        timeout: 15000,
      });
      assertEqual(r.code, 0);
      assertContains(r.combined, 'already a Wrangler project');
      assertContains(r.combined, 'wrangler-tui deploy');
    },
  },
];

tests.push({ name: 'cleanup', fn: async () => { if (work) cleanupDir(work); } });