import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { detect, resolveTarget, summarize } from '../../src/project.mjs';
import { createProject, freshDir, cleanupDir, assert, assertEqual, assertContains, expectThrows } from '../helpers.mjs';

export const name = 'project';

let work;

export const tests = [
  {
    name: 'detect from project root',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'proj-detect');
      createProject(join(work, 'p1'), 'test-1');
      const found = detect(join(work, 'p1'));
      assert(found !== null, 'detect returned null');
      assertEqual(found.root, join(work, 'p1'));
      assertEqual(found.config.name, 'test-1');
    },
  },
  {
    name: 'detect walks up from nested directory',
    fn: async (ctx) => {
      createProject(join(work, 'p2'), 'test-2');
      mkdirSync(join(work, 'p2', 'a', 'b', 'c'), { recursive: true });
      const found = detect(join(work, 'p2', 'a', 'b', 'c'));
      assert(found !== null, 'detect returned null from nested');
      assertEqual(found.root, join(work, 'p2'));
    },
  },
  {
    name: 'detect returns null outside any project',
    fn: async (ctx) => {
      const empty = freshDir(ctx.STATE, 'empty');
      const found = detect(empty);
      assertEqual(found, null);
    },
  },
  {
    name: 'detect finds wrangler.toml',
    fn: async (ctx) => {
      const d = freshDir(ctx.STATE, 'toml-proj');
      // write a wrangler.toml manually
      const fs = await import('node:fs');
      fs.writeFileSync(join(d, 'wrangler.toml'), 'name = "toml-test"\nmain = "src/index.js"\ncompatibility_date = "2025-01-01"\n');
      const found = detect(d);
      assert(found !== null, 'detect missed .toml');
      assertEqual(found.config.name, 'toml-test');
    },
  },
  {
    name: 'resolveTarget with absolute --dir',
    fn: async (ctx) => {
      createProject(join(work, 'p3'), 'test-3');
      const t = resolveTarget({ dir: join(work, 'p3') });
      assertEqual(t.source, 'explicit');
      assertEqual(t.config.name, 'test-3');
    },
  },
  {
    name: 'resolveTarget with relative --dir resolves against cwd',
    fn: async (ctx) => {
      createProject(join(work, 'p4'), 'test-4');
      const originalCwd = process.cwd();
      process.chdir(work);
      try {
        const t = resolveTarget({ dir: 'p4' });
        assertEqual(t.source, 'explicit');
        assertEqual(t.root, join(work, 'p4'));
      } finally {
        process.chdir(originalCwd);
      }
    },
  },
  {
    name: 'resolveTarget --dir nonexistent throws',
    fn: async (ctx) => {
      const err = await expectThrows(
        () => resolveTarget({ dir: join(ctx.STATE, 'no-such-dir') }),
        /does not exist/
      );
    },
  },
  {
    name: 'resolveTarget --dir without config throws',
    fn: async (ctx) => {
      const empty = freshDir(ctx.STATE, 'empty-dir');
      await expectThrows(
        () => resolveTarget({ dir: empty }),
        /no wrangler\.(jsonc|json|toml)/
      );
    },
  },
  {
    name: 'resolveTarget falls back to ancestry walk',
    fn: async (ctx) => {
      createProject(join(work, 'p5'), 'test-5');
      mkdirSync(join(work, 'p5', 'sub'), { recursive: true });
      const t = resolveTarget({ cwd: join(work, 'p5', 'sub') });
      assertEqual(t.source, 'discovered');
      assertEqual(t.config.name, 'test-5');
    },
  },
  {
    name: 'summarize returns expected fields',
    fn: async () => {
      const proj = resolveTarget({ dir: join(work, 'p1') });
      const s = summarize(proj);
      assertEqual(s.name, 'test-1');
      assertEqual(s.source, 'explicit');
      assert(s.environments.length === 0, 'expected no environments');
    },
  },
  {
  name: 'resolveTarget expands tilde in --dir',
  fn: async () => {
    const origHome = process.env.HOME;
    process.env.HOME = work;
    try {
      const d = freshDir(work, 'tilde-proj');
      createProject(d, 'tilde-test');
      const t = resolveTarget({ dir: '~/tilde-proj' });
      assertEqual(t.source, 'explicit');
      assertEqual(t.root, d);
    } finally {
      process.env.HOME = origHome;
    }
  },
},
{
  name: 'resolveTarget suggests alternatives on typo',
  fn: async () => {
    createProject(join(work, 'typo-proj'), 'typo-test');
    const err = await expectThrows(
      () => resolveTarget({ dir: join(work, 'typ-proj') }),
      /Did you mean/
    );
    assertContains(err.message, 'typo-proj');
  },
},
];

// Cleanup at end of suite
tests.push({
  name: 'cleanup',
  fn: async () => { if (work) cleanupDir(work); },
});