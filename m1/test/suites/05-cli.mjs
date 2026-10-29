import { join } from 'node:path';
import { run, assertEqual, assertContains, assertNotContains } from '../helpers.mjs';
import { createProject, freshDir, cleanupDir } from '../helpers.mjs';

export const name = 'cli';

let work;

export const tests = [
  {
    name: 'version',
    fn: async (ctx) => {
      const r = await run(ctx.CLI, ['--version'], { env: { WRANGLER_TUI_STATE_DIR: ctx.STATE } });
      assertEqual(r.code, 0);
      assertContains(r.stdout, 'wrangler-tui');
    },
  },
  {
    name: 'help',
    fn: async (ctx) => {
      const r = await run(ctx.CLI, ['help'], { env: { WRANGLER_TUI_STATE_DIR: ctx.STATE } });
      assertEqual(r.code, 0);
      assertContains(r.stdout, 'Usage:');
      assertContains(r.stdout, '--dir');
    },
  },
  {
    name: 'unknown command exits 2',
    fn: async (ctx) => {
      const r = await run(ctx.CLI, ['nonsense'], { env: { WRANGLER_TUI_STATE_DIR: ctx.STATE } });
      assertEqual(r.code, 2);
      assertContains(r.combined, 'Unknown command: nonsense');
    },
  },
  {
    name: 'deploy with no project exits 1 with hint list',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'cli-work');
      const r = await run(ctx.CLI, ['deploy'], {
        cwd: work,
        env: { WRANGLER_TUI_STATE_DIR: ctx.STATE },
      });
      assertEqual(r.code, 1);
      assertContains(r.combined, 'Project not detected');
      assertContains(r.combined, 'wrangler-tui init');
      assertContains(r.combined, '--dir');
    },
  },
  {
    name: 'deploy --dir nonexistent exits 1 with specific error',
    fn: async (ctx) => {
      const r = await run(ctx.CLI, ['deploy', '--dir', join(work, 'nope')], {
        cwd: work,
        env: { WRANGLER_TUI_STATE_DIR: ctx.STATE },
      });
      assertEqual(r.code, 1);
      assertContains(r.combined, 'does not exist');
    },
  },
  {
    name: 'deploy --dir without config exits 1',
    fn: async (ctx) => {
      const empty = freshDir(ctx.STATE, 'empty-target');
      const r = await run(ctx.CLI, ['deploy', '--dir', empty], {
        cwd: work,
        env: { WRANGLER_TUI_STATE_DIR: ctx.STATE },
      });
      assertEqual(r.code, 1);
      assertContains(r.combined, 'no wrangler.jsonc');
    },
  },
  {
    name: 'deploy --dir relative resolves to cwd',
    fn: async (ctx) => {
      createProject(join(work, 'rel-target'), 'rel-test');
      const r = await run(ctx.CLI, ['deploy', '--dir', 'rel-target'], {
        cwd: work,
        env: { WRANGLER_TUI_STATE_DIR: ctx.STATE },
        timeout: 5000,
      });
      // The deploy will attempt a dry-run and possibly prompt.
      // We only verify project resolution succeeds by the presence of
      // "Source: explicit" in the output and absence of "resolution failed".
      assertContains(r.combined, 'Source:');
      assertContains(r.combined, 'explicit');
      assertNotContains(r.combined, 'Project resolution failed');
    },
  },
  {
    name: '--dir without argument exits 2',
    fn: async (ctx) => {
      const r = await run(ctx.CLI, ['deploy', '--dir'], {
        env: { WRANGLER_TUI_STATE_DIR: ctx.STATE },
      });
      assertEqual(r.code, 2);
      assertContains(r.stderr, '--dir requires an argument');
    },
  },
  {
    name: 'unexpected positional argument exits 2',
    fn: async (ctx) => {
      const r = await run(ctx.CLI, ['deploy', 'unexpected'], {
        env: { WRANGLER_TUI_STATE_DIR: ctx.STATE },
      });
      assertEqual(r.code, 2);
      assertContains(r.stderr, 'unexpected argument');
    },
  },
];

tests.push({
  name: 'cleanup',
  fn: async () => { if (work) cleanupDir(work); },
});