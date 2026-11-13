import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { freshDir, cleanupDir, assert, assertEqual, assertContains } from '../helpers.mjs';
import { detectShape, shapeLabel } from '../../src/shape.mjs';

export const name = 'shape';

let work;

function w(dir, name, content = '') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content);
}

export const tests = [
  { name: 'setup', fn: async (ctx) => { work = freshDir(ctx.STATE, 'shape-work'); } },

  {
    name: 'detects worker-full (main + assets)',
    fn: async () => {
      const d = join(work, 'worker-full'); mkdirSync(d, { recursive: true });
      w(d, 'wrangler.jsonc', JSON.stringify({ name: 'w', main: 'src/index.js', assets: { directory: './public' } }));
      const s = detectShape(d);
      assertEqual(s.shape, 'worker-full');
      assertEqual(s.deployTarget, 'already-worker');
      assertEqual(s.deployable, true);
    },
  },

  {
    name: 'detects worker-assets-only',
    fn: async () => {
      const d = join(work, 'worker-assets'); mkdirSync(d, { recursive: true });
      w(d, 'wrangler.jsonc', JSON.stringify({ name: 'w', assets: { directory: './dist' } }));
      const s = detectShape(d);
      assertEqual(s.shape, 'worker-assets-only');
      assertEqual(s.deployTarget, 'already-worker');
    },
  },

  {
    name: 'detects worker-incomplete (config with no main, no assets)',
    fn: async () => {
      const d = join(work, 'worker-incomplete'); mkdirSync(d, { recursive: true });
      w(d, 'wrangler.jsonc', JSON.stringify({ name: 'w' }));
      const s = detectShape(d);
      assertEqual(s.shape, 'worker-incomplete');
      assertEqual(s.deployable, false);
      assert(s.blockers.length > 0);
    },
  },

  {
    name: 'detects worker-invalid (bad JSONC)',
    fn: async () => {
      const d = join(work, 'worker-invalid'); mkdirSync(d, { recursive: true });
      w(d, 'wrangler.jsonc', '{ "main": }');
      const s = detectShape(d);
      assertEqual(s.shape, 'worker-invalid');
      assertEqual(s.deployable, false);
    },
  },

  {
    name: 'detects vite with dist → spa recommended',
    fn: async () => {
      const d = join(work, 'vite-built'); mkdirSync(d, { recursive: true });
      w(d, 'vite.config.ts', '');
      mkdirSync(join(d, 'dist'), { recursive: true });
      w(join(d, 'dist'), 'index.html', '<html></html>');
      const s = detectShape(d);
      assertEqual(s.shape, 'vite');
      assertEqual(s.deployable, true);
      assertEqual(s.outputDir, './dist');
      assertEqual(s.recommendedPreset, 'spa');
    },
  },

  {
    name: 'detects vite without dist → blocked',
    fn: async () => {
      const d = join(work, 'vite-nobuild'); mkdirSync(d, { recursive: true });
      w(d, 'vite.config.ts', '');
      const s = detectShape(d);
      assertEqual(s.shape, 'vite');
      assertEqual(s.deployable, false);
      assertContains(s.blockers[0].fix, 'npm run build');
    },
  },

  {
    name: 'detects astro with dist → static recommended',
    fn: async () => {
      const d = join(work, 'astro-built'); mkdirSync(d, { recursive: true });
      w(d, 'astro.config.mjs', '');
      mkdirSync(join(d, 'dist'), { recursive: true });
      w(join(d, 'dist'), 'index.html', '');
      const s = detectShape(d);
      assertEqual(s.shape, 'astro');
      assertEqual(s.recommendedPreset, 'static');
    },
  },

  {
    name: 'detects nextjs without out → blocked with adapter instructions',
    fn: async () => {
      const d = join(work, 'next-default'); mkdirSync(d, { recursive: true });
      w(d, 'next.config.js', 'module.exports = {};');
      const s = detectShape(d);
      assertEqual(s.shape, 'nextjs');
      assertEqual(s.deployable, false);
      assertContains(s.blockers[0].fix, '@opennextjs/cloudflare');
    },
  },

  {
    name: 'detects nextjs static export (out/)',
    fn: async () => {
      const d = join(work, 'next-exported'); mkdirSync(d, { recursive: true });
      w(d, 'next.config.js', 'module.exports = { output: "export" };');
      mkdirSync(join(d, 'out'), { recursive: true });
      w(join(d, 'out'), 'index.html', '');
      const s = detectShape(d);
      assertEqual(s.shape, 'nextjs');
      assertEqual(s.deployable, true);
      assertEqual(s.outputDir, './out');
    },
  },

  {
    name: 'detects sveltekit without adapter → blocked',
    fn: async () => {
      const d = join(work, 'svelte-no-adapter'); mkdirSync(d, { recursive: true });
      w(d, 'svelte.config.js', '');
      w(d, 'package.json', JSON.stringify({ devDependencies: {} }));
      const s = detectShape(d);
      assertEqual(s.shape, 'sveltekit');
      assertEqual(s.deployable, false);
      assertContains(s.blockers[0].fix, '@sveltejs/adapter-cloudflare');
    },
  },

  {
    name: 'detects sveltekit with static adapter and build/',
    fn: async () => {
      const d = join(work, 'svelte-static'); mkdirSync(d, { recursive: true });
      w(d, 'svelte.config.js', '');
      w(d, 'package.json', JSON.stringify({ devDependencies: { '@sveltejs/adapter-static': '2.0.0' } }));
      mkdirSync(join(d, 'build'), { recursive: true });
      w(join(d, 'build'), 'index.html', '');
      const s = detectShape(d);
      assertEqual(s.shape, 'sveltekit');
      assertEqual(s.deployable, true);
      assertEqual(s.outputDir, './build');
    },
  },

  {
    name: 'detects nuxt without .output → blocked',
    fn: async () => {
      const d = join(work, 'nuxt-default'); mkdirSync(d, { recursive: true });
      w(d, 'nuxt.config.ts', '');
      const s = detectShape(d);
      assertEqual(s.shape, 'nuxt');
      assertEqual(s.deployable, false);
      assertContains(s.blockers[0].fix, 'NITRO_PRESET');
    },
  },

  {
    name: 'detects remix → blocked with guide link',
    fn: async () => {
      const d = join(work, 'remix-default'); mkdirSync(d, { recursive: true });
      w(d, 'remix.config.js', '');
      const s = detectShape(d);
      assertEqual(s.shape, 'remix');
      assertEqual(s.deployable, false);
      assertContains(s.blockers[0].what, '@remix-run/cloudflare');
      assertContains(s.blockers[0].fix, 'developers.cloudflare.com');    },
  },

  {
    name: 'detects built dist/ with no framework markers',
    fn: async () => {
      const d = join(work, 'bare-dist'); mkdirSync(d, { recursive: true });
      mkdirSync(join(d, 'dist'), { recursive: true });
      w(join(d, 'dist'), 'index.html', '');
      const s = detectShape(d);
      assertEqual(s.shape, 'built-dist');
      assertEqual(s.deployable, true);
      assertEqual(s.outputDir, './dist');
      assertEqual(s.recommendedPreset, 'static');
    },
  },

  {
    name: 'detects pages functions',
    fn: async () => {
      const d = join(work, 'pages-fn'); mkdirSync(d, { recursive: true });
      mkdirSync(join(d, 'functions'), { recursive: true });
      w(join(d, 'functions'), 'hello.js', '');
      const s = detectShape(d);
      assertEqual(s.shape, 'pages-functions');
      assertEqual(s.deployTarget, 'pages');
      assertEqual(s.options.length, 1);
    },
  },

  {
    name: 'detects plain static (index.html at root)',
    fn: async () => {
      const d = join(work, 'plain'); mkdirSync(d, { recursive: true });
      w(d, 'index.html', '<html></html>');
      const s = detectShape(d);
      assertEqual(s.shape, 'plain-static');
      assertEqual(s.deployable, true);
      assertEqual(s.outputDir, '.');
      assertEqual(s.recommendedPreset, null);
    },
  },

  {
    name: 'detects empty directory',
    fn: async () => {
      const d = join(work, 'empty'); mkdirSync(d, { recursive: true });
      const s = detectShape(d);
      assertEqual(s.shape, 'empty');
      assertEqual(s.deployable, false);
    },
  },

  {
    name: 'detects unknown directory (files, no markers)',
    fn: async () => {
      const d = join(work, 'unknown'); mkdirSync(d, { recursive: true });
      w(d, 'random.txt', 'hello');
      w(d, 'another.md', 'world');
      const s = detectShape(d);
      assertEqual(s.shape, 'unknown');
      assertEqual(s.deployable, false);
      assertContains(s.blockers[0].fix, '--assets-dir');
    },
  },

  {
    name: 'shapeLabel covers all shapes',
    fn: async () => {
      for (const k of ['worker-full', 'vite', 'nextjs', 'plain-static', 'empty', 'unknown']) {
        assert(shapeLabel(k), `label missing for ${k}`);
      }
    },
  },
];

tests.push({ name: 'cleanup', fn: async () => { if (work) cleanupDir(work); } });