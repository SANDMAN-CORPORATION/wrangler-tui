import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { run, assertEqual, assertContains } from '../helpers.mjs';

export const name = 'syntax';

const SRC = join(process.env.REPO, 'm1', 'src');

export const tests = [];

// Enumerate every source file and check it parses
for (const f of readdirSync(SRC).filter((f) => f.endsWith('.mjs'))) {
  tests.push({
    name: `${f} parses`,
    fn: async () => {
      const r = await run('node', ['--check', join(SRC, f)]);
      assertEqual(r.code, 0, `${f} parse exit`);
      assertEqual(r.stderr.trim(), '', `${f} parse stderr`);
    },
  });
}

// Critically: verify every module can actually be imported.
// --check catches syntax errors but not "export named X" from wrong package
for (const f of readdirSync(SRC).filter((f) => f.endsWith('.mjs') && !f.includes('index') && !f.includes('test'))) {
  tests.push({
    name: `${f} imports cleanly`,
    fn: async () => {
      const modPath = join(SRC, f);
      const importer = `
        const m = await import(${JSON.stringify(modPath)});
        process.exit(0);
      `;
      const r = await run('node', ['--input-type=module', '-e', importer]);
      assertEqual(r.code, 0, `${f} import exit`);
      assertEqual(r.stderr.trim(), '', `${f} import stderr`);
    },
  });
}

// Every src module can be reached from the CLI entry
tests.push({
  name: 'index.mjs is executable',
  fn: async () => {
    const r = await run('node', ['--check', join(SRC, 'index.mjs')]);
    assertEqual(r.code, 0, 'index syntax');
  },
});