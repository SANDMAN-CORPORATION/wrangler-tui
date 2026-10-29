import { join, dirname } from 'node:path';
import { writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { freshDir, cleanupDir, assert, assertEqual } from '../helpers.mjs';
import { resolveWranglerBinary, resetResolver } from '../../src/wrangler-bin.mjs';

export const name = 'resolver';

let work;

function makeFakeInstall(baseDir, { version = '4.0.0', pkgValid = true } = {}) {
  mkdirSync(join(baseDir, 'bin'), { recursive: true });
  if (pkgValid) {
    writeFileSync(
      join(baseDir, 'package.json'),
      JSON.stringify({ name: 'wrangler', version }, null, 2)
    );
  } else {
    writeFileSync(join(baseDir, 'package.json'), '{ malformed');
  }
  const bin = join(baseDir, 'bin', 'wrangler');
  writeFileSync(bin, '#!/bin/sh\necho "wrangler ' + version + '"\n', { mode: 0o755 });
  return bin;
}

function makeNonExecutable(baseDir) {
  const bin = join(baseDir, 'wrangler');
  writeFileSync(bin, '#!/bin/sh\necho nope\n', { mode: 0o644 });
  return bin;
}

function makeProject(dir, name = 'proj') {
  const root = join(dir, name);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'wrangler.jsonc'), JSON.stringify({
    name, main: 'src/index.js', compatibility_date: '2025-01-01',
  }, null, 2));
  writeFileSync(join(root, 'src', 'index.js'), 'export default {};\n');
  return root;
}

function withPath(additions, fn) {
  const orig = process.env.PATH;
  const origEnv = process.env.WRANGLER_TUI_WRANGLER_BIN;
  process.env.PATH = additions.join(':') + ':' + orig;
  return Promise.resolve(fn()).finally(() => {
    process.env.PATH = orig;
    if (origEnv === undefined) delete process.env.WRANGLER_TUI_WRANGLER_BIN;
    else process.env.WRANGLER_TUI_WRANGLER_BIN = origEnv;
    resetResolver();
  });
}

export const tests = [
  {
    name: 'setup',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'resolver-work');
    },
  },
  {
    name: 'project-local takes precedence over global',
    fn: async () => {
      const globalDir = freshDir(work, 'global-bin');
      makeFakeInstall(join(work, 'global-install'), { version: '9.9.9' });
      symlinkSync(join(work, 'global-install', 'bin', 'wrangler'), join(globalDir, 'wrangler'));

      const project = makeProject(work, 'local-wins');
      const localInstall = join(project, 'node_modules', 'wrangler-install');
      makeFakeInstall(localInstall, { version: '4.5.6' });
      mkdirSync(join(project, 'node_modules', '.bin'), { recursive: true });
      symlinkSync(
        join(localInstall, 'bin', 'wrangler'),
        join(project, 'node_modules', '.bin', 'wrangler')
      );

      await withPath([globalDir], async () => {
        resetResolver();
        const r = resolveWranglerBinary({ target: { root: project } });
        assertEqual(r.source, 'project-local');
        assertEqual(r.version, '4.5.6');
      });
    },
  },
  {
    name: 'WRANGLER_TUI_WRANGLER_BIN honored when project-local absent',
    fn: async () => {
      const project = makeProject(work, 'env-fallback');
      const envInstall = join(work, 'env-install');
      const envBin = makeFakeInstall(envInstall, { version: '5.0.0' });

      const globalDir = freshDir(work, 'global-bin-2');
      makeFakeInstall(join(work, 'global-install-2'), { version: '9.9.9' });
      symlinkSync(join(work, 'global-install-2', 'bin', 'wrangler'), join(globalDir, 'wrangler'));

      await withPath([globalDir], async () => {
        process.env.WRANGLER_TUI_WRANGLER_BIN = envBin;
        resetResolver();
        const r = resolveWranglerBinary({ target: { root: project } });
        assertEqual(r.source, 'env');
        assertEqual(r.version, '5.0.0');
      });
    },
  },
  {
    name: 'WRANGLER_TUI_WRANGLER_BIN ignored when project-local exists',
    fn: async () => {
      const project = makeProject(work, 'local-beats-env');
      const localInstall = join(project, 'node_modules', 'wrangler-install');
      makeFakeInstall(localInstall, { version: '4.5.6' });
      mkdirSync(join(project, 'node_modules', '.bin'), { recursive: true });
      symlinkSync(
        join(localInstall, 'bin', 'wrangler'),
        join(project, 'node_modules', '.bin', 'wrangler')
      );

      const envBin = makeFakeInstall(join(work, 'env-install-2'), { version: '5.0.0' });

      await withPath([], async () => {
        process.env.WRANGLER_TUI_WRANGLER_BIN = envBin;
        resetResolver();
        const r = resolveWranglerBinary({ target: { root: project } });
        assertEqual(r.source, 'project-local');
        assertEqual(r.version, '4.5.6');
      });
    },
  },
  {
    name: 'PATH resolution works when no local and no env',
    fn: async () => {
      const project = makeProject(work, 'path-fallback');
      const globalDir = freshDir(work, 'global-bin-3');
      makeFakeInstall(join(work, 'global-install-3'), { version: '7.0.0' });
      symlinkSync(join(work, 'global-install-3', 'bin', 'wrangler'), join(globalDir, 'wrangler'));

      await withPath([globalDir], async () => {
        delete process.env.WRANGLER_TUI_WRANGLER_BIN;
        resetResolver();
        const r = resolveWranglerBinary({ target: { root: project } });
        assertEqual(r.source, 'path');
        assertEqual(r.version, '7.0.0');
      });
    },
  },
  {
    name: 'PATH skips non-executable files',
    fn: async () => {
      const project = makeProject(work, 'nonexec-skip');
      const badDir = freshDir(work, 'bad-bin');
      makeNonExecutable(badDir);      // 0644 — not executable

      const goodDir = freshDir(work, 'good-bin');
      makeFakeInstall(join(work, 'good-install'), { version: '3.0.0' });
      symlinkSync(join(work, 'good-install', 'bin', 'wrangler'), join(goodDir, 'wrangler'));

      await withPath([badDir, goodDir], async () => {
        delete process.env.WRANGLER_TUI_WRANGLER_BIN;
        resetResolver();
        const r = resolveWranglerBinary({ target: { root: project } });
        assertEqual(r.source, 'path');
        assertEqual(r.version, '3.0.0');
        assert(r.path.includes('good-bin'), 'should resolve from good-bin, not bad-bin');
      });
    },
  },
  {
    name: 'version read from package.json in npm layout',
    fn: async () => {
      const install = join(work, 'pkg-layout');
      makeFakeInstall(install, { version: '4.152.0' });
      const binDir = freshDir(work, 'pkg-layout-bin');
      symlinkSync(join(install, 'bin', 'wrangler'), join(binDir, 'wrangler'));

      await withPath([binDir], async () => {
        delete process.env.WRANGLER_TUI_WRANGLER_BIN;
        resetResolver();
        const r = resolveWranglerBinary({ target: null });
        assertEqual(r.versionSource, 'package.json');
        assertEqual(r.version, '4.152.0');
      });
    },
  },
  {
    name: 'malformed package.json triggers spawn fallback',
    fn: async () => {
      const install = join(work, 'malformed-pkg');
      makeFakeInstall(install, { version: '4.99.0', pkgValid: false });
      const binDir = freshDir(work, 'malformed-bin');
      symlinkSync(join(install, 'bin', 'wrangler'), join(binDir, 'wrangler'));

      await withPath([binDir], async () => {
        delete process.env.WRANGLER_TUI_WRANGLER_BIN;
        resetResolver();
        const r = resolveWranglerBinary({ target: null });
        assertEqual(r.versionSource, 'spawn');
        assertEqual(r.version, '4.99.0');
      });
    },
  },
  {
    name: 'version unknown when both package.json and spawn fail',
    fn: async () => {
      const install = join(work, 'broken-all');
      mkdirSync(join(install, 'bin'), { recursive: true });
      writeFileSync(join(install, 'package.json'), '{ malformed');
      writeFileSync(join(install, 'bin', 'wrangler'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      const binDir = freshDir(work, 'broken-all-bin');
      symlinkSync(join(install, 'bin', 'wrangler'), join(binDir, 'wrangler'));

      await withPath([binDir], async () => {
        delete process.env.WRANGLER_TUI_WRANGLER_BIN;
        resetResolver();
        const r = resolveWranglerBinary({ target: null });
        assertEqual(r.version, 'unknown');
        assertEqual(r.versionSource, 'unknown');
      });
    },
  },
  {
    name: 'no wrangler found returns error result',
    fn: async () => {
      const emptyDir = freshDir(work, 'empty-bin');
      await withPath([emptyDir], async () => {
        delete process.env.WRANGLER_TUI_WRANGLER_BIN;
        // Also strip the real PATH
        const orig = process.env.PATH;
        process.env.PATH = emptyDir;
        try {
          resetResolver();
          const r = resolveWranglerBinary({ target: null });
          assertEqual(r.path, null);
          assertEqual(r.source, 'none');
          assert(r.error, 'error message expected');
        } finally {
          process.env.PATH = orig;
        }
      });
    },
  },
];

tests.push({
  name: 'cleanup',
  fn: async () => { if (work) cleanupDir(work); },
});