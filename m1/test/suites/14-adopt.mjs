import { join } from 'node:path';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { freshDir, cleanupDir, assert, assertEqual } from '../helpers.mjs';
import {
  buildWorkerConfig, applyWorkerConfig, applyAssetsIgnore,
  applyPagesMarker, readMarker,
} from '../../src/adopt.mjs';

export const name = 'adopt';

let work;

function makeAssets(name, files = ['index.html']) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f), '<html></html>');
  return dir;
}

export const tests = [
  {
    name: 'setup',
    fn: async (ctx) => { work = freshDir(ctx.STATE, 'adopt-work'); },
  },
  {
    name: 'buildWorkerConfig static preset',
    fn: async () => {
      const assets = makeAssets('static-site');
      const cfg = buildWorkerConfig({ root: work, name: 'my-site', assetsDir: assets, preset: 'static' });
      assertEqual(cfg.name, 'my-site');
      assertEqual(cfg.assets.directory, './static-site');
      assertEqual(cfg.assets.not_found_handling, undefined);
      assert(/^\d{4}-\d{2}-\d{2}$/.test(cfg.compatibility_date), 'compat date format');
    },
  },
  {
    name: 'buildWorkerConfig spa preset sets not_found_handling',
    fn: async () => {
      const assets = makeAssets('spa-site');
      const cfg = buildWorkerConfig({ root: work, name: 'spa', assetsDir: assets, preset: 'spa' });
      assertEqual(cfg.assets.not_found_handling, 'single-page-application');
    },
  },
  {
    name: 'buildWorkerConfig base path',
    fn: async () => {
      const assets = makeAssets('basepath-site');
      const cfg = buildWorkerConfig({ root: work, name: 'b', assetsDir: assets, preset: 'static', basePath: '/blog' });
      assertEqual(cfg.assets.base_path, '/blog');
    },
  },
  {
    name: 'buildWorkerConfig omits $schema when no local wrangler',
    fn: async () => {
      const assets = makeAssets('noschema-site');
      const cfg = buildWorkerConfig({ root: work, name: 'x', assetsDir: assets, preset: 'static' });
      assertEqual(cfg.$schema, undefined);
    },
  },
  {
  name: 'applyWorkerConfig creates file',
  fn: async () => {
    const root = join(work, 'create-root');
    mkdirSync(root, { recursive: true });
    const assets = makeAssets('create-root/create-assets');
    const r = applyWorkerConfig({ root, config: buildWorkerConfig({ root, name: 'c', assetsDir: assets, preset: 'static' }) });
    assertEqual(r.action, 'created');
    const parsed = JSON.parse(readFileSync(r.path, 'utf8'));
    assertEqual(parsed.assets.directory, './create-assets');
  },
},
  {
    name: 'applyWorkerConfig merges into existing wrangler.jsonc',
    fn: async () => {
      const root = join(work, 'merge-root');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'wrangler.jsonc'),
        '{\n  // existing comment\n  "name": "existing",\n  "main": "src/index.js",\n  "compatibility_date": "2025-01-01"\n}\n');
      const assets = makeAssets('merge-assets');
      const r = applyWorkerConfig({ root, config: buildWorkerConfig({ root, name: 'ignored', assetsDir: assets, preset: 'spa' }) });
      assertEqual(r.action, 'merged');
      const text = readFileSync(r.path, 'utf8');
      assert(text.includes('// existing comment'), 'comment preserved');
      assert(text.includes('"main": "src/index.js"'), 'main preserved');
      assert(text.includes('"single-page-application"'), 'assets merged');
      assert(text.includes('"name": "existing"'), 'name not overwritten');
    },
  },
  {
    name: 'applyWorkerConfig leaves existing assets untouched',
    fn: async () => {
      const root = join(work, 'exists-root');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'wrangler.jsonc'),
        '{\n  "name": "n",\n  "compatibility_date": "2025-01-01",\n  "assets": { "directory": "./public" }\n}\n');
      const assets = makeAssets('exists-assets');
      const r = applyWorkerConfig({ root, config: buildWorkerConfig({ root, name: 'n', assetsDir: assets, preset: 'static' }) });
      assertEqual(r.action, 'unchanged');
    },
  },
  {
    name: 'applyAssetsIgnore writes entries when Pages files present',
    fn: async () => {
      const assets = makeAssets('migrate-assets', ['index.html', '_worker.js', '_redirects']);
      const r = applyAssetsIgnore({ assetsDir: assets });
      assertEqual(r.action, 'created');
      const text = readFileSync(r.path, 'utf8');
      assert(text.includes('_worker.js'));
      assert(text.includes('_redirects'));
      assert(!text.includes('_headers'), 'absent file not listed');
    },
  },
  {
    name: 'applyAssetsIgnore no-op when no Pages files',
    fn: async () => {
      const assets = makeAssets('clean-assets');
      const r = applyAssetsIgnore({ assetsDir: assets });
      assertEqual(r.action, 'none');
    },
  },
  {
  name: 'applyPagesMarker round-trips through readMarker',
  fn: async () => {
    const root = join(work, 'pages-root');
    mkdirSync(root, { recursive: true });
    const assets = makeAssets('pages-root/pages-assets');
    const r = applyPagesMarker({ root, projectName: 'my-site', assetsDir: assets, branch: 'main' });
    const marker = readMarker(root);
    assertEqual(marker.target, 'pages');
    assertEqual(marker.projectName, 'my-site');
    assertEqual(marker.assetsDir, './pages-assets');
    assertEqual(marker.branch, 'main');
  },
},
  {
    name: 'readMarker returns null when absent',
    fn: async () => {
      const empty = freshDir(work, 'no-marker');
      assertEqual(readMarker(empty), null);
    },
  },
];

tests.push({ name: 'cleanup', fn: async () => { if (work) cleanupDir(work); } });