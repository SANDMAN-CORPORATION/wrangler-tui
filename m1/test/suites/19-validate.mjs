import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { freshDir, cleanupDir, assertEqual, assert } from '../helpers.mjs';
import { validateWorkerDeploy, validatePagesDeploy } from '../../src/validate.mjs';

export const name = 'validate';

let work;

function project(name, config, files = {}) {
  const root = join(work, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'wrangler.jsonc'), JSON.stringify(config, null, 2));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    const dir = full.substring(0, full.lastIndexOf('/'));
    if (dir) mkdirSync(dir, { recursive: true });
    writeFileSync(full, content);
  }
  return { root, configPath: join(root, 'wrangler.jsonc'), config };
}

export const tests = [
  { name: 'setup', fn: async (ctx) => { work = freshDir(ctx.STATE, 'validate-work'); } },

  {
    name: 'worker: blocks when neither main nor assets declared',
    fn: async () => {
      const t = project('no-main-no-assets', { name: 'w' });
      const r = validateWorkerDeploy(t);
      assertEqual(r.ok, false);
      assertEqual(r.errors.length, 1);
      assert(r.errors[0].what.includes('neither'));
    },
  },
  {
    name: 'worker: blocks when main does not exist',
    fn: async () => {
      const t = project('missing-main', { name: 'w', main: 'src/index.js' });
      const r = validateWorkerDeploy(t);
      assertEqual(r.ok, false);
      assert(r.errors[0].what.includes('entry point not found'));
    },
  },
  {
    name: 'worker: blocks when assets directory does not exist',
    fn: async () => {
      const t = project('missing-assets', { name: 'w', assets: { directory: './dist' } });
      const r = validateWorkerDeploy(t);
      assertEqual(r.ok, false);
      assert(r.errors[0].what.includes('Assets directory not found'));
    },
  },
  {
    name: 'worker: blocks when assets directory is empty',
    fn: async () => {
      const t = project('empty-assets', { name: 'w', assets: { directory: './dist' } });
      mkdirSync(join(t.root, 'dist'), { recursive: true });
      const r = validateWorkerDeploy(t);
      assertEqual(r.ok, false);
      assert(r.errors[0].what.includes('empty'));
    },
  },
  {
    name: 'worker: valid main + assets passes',
    fn: async () => {
      const t = project('valid-worker', { name: 'w', main: 'src/index.js', assets: { directory: './public' } }, {
        'src/index.js': 'export default {};',
        'public/index.html': '<html></html>',
      });
      const r = validateWorkerDeploy(t);
      assertEqual(r.ok, true);
      assertEqual(r.errors.length, 0);
      assertEqual(r.warnings.length, 0);
    },
  },
  {
    name: 'worker: warns when _worker.js not in .assetsignore',
    fn: async () => {
      const t = project('worker-pages-files', { name: 'w', assets: { directory: './dist' } }, {
        'dist/index.html': '',
        'dist/_worker.js': '',
        'dist/_redirects': '/* /index.html 200',
      });
      const r = validateWorkerDeploy(t);
      assertEqual(r.ok, true);
      assertEqual(r.warnings.length, 1);
      assert(r.warnings[0].what.includes('_worker.js'));
      assert(r.warnings[0].what.includes('_redirects'));
      assert(r.warnings[0].fix.includes('.assetsignore'));
    },
  },
  {
    name: 'worker: no warning when Pages files in .assetsignore',
    fn: async () => {
      const t = project('worker-pages-ignored', { name: 'w', assets: { directory: './dist' } }, {
        'dist/index.html': '',
        'dist/_worker.js': '',
        'dist/.assetsignore': '_worker.js\n',
      });
      const r = validateWorkerDeploy(t);
      assertEqual(r.ok, true);
      assertEqual(r.warnings.length, 0);
    },
  },
  {
    name: 'pages: blocks when directory does not exist',
    fn: async () => {
      const r = validatePagesDeploy(join(work, 'no-such-dir'));
      assertEqual(r.ok, false);
      assert(r.errors[0].what.includes('does not exist'));
    },
  },
  {
    name: 'pages: blocks when directory is empty',
    fn: async () => {
      const d = join(work, 'empty-pages');
      mkdirSync(d, { recursive: true });
      const r = validatePagesDeploy(d);
      assertEqual(r.ok, false);
      assert(r.errors[0].what.includes('empty'));
    },
  },
  {
    name: 'pages: valid directory passes',
    fn: async () => {
      const d = join(work, 'valid-pages');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'index.html'), '<html></html>');
      const r = validatePagesDeploy(d);
      assertEqual(r.ok, true);
      assertEqual(r.errors.length, 0);
    },
  },
  {
    name: 'pages: _worker.js produces informational note',
    fn: async () => {
      const d = join(work, 'pages-worker');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'index.html'), '');
      writeFileSync(join(d, '_worker.js'), '');
      const r = validatePagesDeploy(d);
      assertEqual(r.ok, true);
      const info = r.warnings.filter((w) => w.severity === 'info');
      assertEqual(info.length, 1);
      assert(info[0].what.includes('_worker.js'));
    },
  },
];

tests.push({ name: 'cleanup', fn: async () => { if (work) cleanupDir(work); } });