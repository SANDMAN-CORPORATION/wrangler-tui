import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { freshDir, cleanupDir, assert, assertEqual, expectThrows } from '../helpers.mjs';
import { detectDeployDirectory, detectProjectName } from '../../src/pages.mjs';

export const name = 'pages';

let work, savedCwd;

export const tests = [
  {
    name: 'setup',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'pages-work');
      savedCwd = process.cwd();
    },
  },
  {
    name: 'detectDeployDirectory finds dist/',
    fn: async () => {
      const proj = join(work, 'proj-dist');
      mkdirSync(join(proj, 'dist'), { recursive: true });
      writeFileSync(join(proj, 'dist', 'index.html'), '<html></html>');
      process.chdir(proj);
      try {
        assertEqual(detectDeployDirectory(), join(proj, 'dist'));
      } finally { process.chdir(savedCwd); }
    },
  },
  {
    name: 'detectDeployDirectory prefers dist/ over public/',
    fn: async () => {
      const proj = join(work, 'proj-both');
      mkdirSync(join(proj, 'dist'), { recursive: true });
      mkdirSync(join(proj, 'public'), { recursive: true });
      writeFileSync(join(proj, 'dist', 'index.html'), 'x');
      writeFileSync(join(proj, 'public', 'index.html'), 'x');
      process.chdir(proj);
      try {
        assertEqual(detectDeployDirectory(), join(proj, 'dist'));
      } finally { process.chdir(savedCwd); }
    },
  },
  {
    name: 'detectDeployDirectory skips empty dirs',
    fn: async () => {
      const proj = join(work, 'proj-empty');
      mkdirSync(join(proj, 'dist'), { recursive: true });
      writeFileSync(join(proj, 'index.html'), 'x');
      process.chdir(proj);
      try {
        assertEqual(detectDeployDirectory(), proj);
      } finally { process.chdir(savedCwd); }
    },
  },
  {
    name: 'detectDeployDirectory returns null when nothing found',
    fn: async () => {
      const proj = join(work, 'proj-nothing');
      mkdirSync(proj, { recursive: true });
      process.chdir(proj);
      try {
        assertEqual(detectDeployDirectory(), null);
      } finally { process.chdir(savedCwd); }
    },
  },
  {
    name: 'detectDeployDirectory rejects nonexistent --dir',
    fn: async () => {
      const err = await expectThrows(
        () => detectDeployDirectory(join(work, 'no-such-dir')),
        /does not exist/
      );
    },
  },
  {
    name: 'detectProjectName uses package.json name',
    fn: async () => {
      const proj = join(work, 'proj-pkg');
      mkdirSync(proj, { recursive: true });
      writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'my-awesome-site' }));
      process.chdir(proj);
      try {
        assertEqual(detectProjectName(), 'my-awesome-site');
      } finally { process.chdir(savedCwd); }
    },
  },
  {
    name: 'detectProjectName strips npm scope',
    fn: async () => {
      const proj = join(work, 'proj-scope');
      mkdirSync(proj, { recursive: true });
      writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: '@myscope/awesome' }));
      process.chdir(proj);
      try {
        assertEqual(detectProjectName(), 'awesome');
      } finally { process.chdir(savedCwd); }
    },
  },
  {
    name: 'detectProjectName falls back to basename',
    fn: async () => {
      const proj = join(work, 'my-site');
      mkdirSync(proj, { recursive: true });
      process.chdir(proj);
      try {
        assertEqual(detectProjectName(), 'my-site');
      } finally { process.chdir(savedCwd); }
    },
  },
];

tests.push({ name: 'cleanup', fn: async () => { process.chdir(savedCwd); if (work) cleanupDir(work); } });