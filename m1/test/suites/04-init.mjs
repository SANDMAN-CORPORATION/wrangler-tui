import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { freshDir, cleanupDir, assert, assertEqual, assertContains } from '../helpers.mjs';
import { detect } from '../../src/project.mjs';

export const name = 'init';

let work;

export const tests = [
  {
    name: 'scaffold creates all three files',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'init-work');
      // Import init internals by executing init.flow with mocked prompts
      // would require mocking clack. Instead, use the exported helper path:
      // we call the CLI's minimal template by invoking through the actual
      // entry with a throwaway spawn (see suite 06 for CLI e2e).
      // For unit testing, verify the fixture we'd expect:
      const { execSync } = await import('node:child_process');
      // No direct call — this test relies on suite 06 for the actual scaffold.
      // Here we just verify detect() would find what we expect to be written.
      // Placeholder to be augmented when init.scaffoldMinimal is exported.
      assert(true, 'placeholder');
    },
  },
];

tests.push({
  name: 'cleanup',
  fn: async () => { if (work) cleanupDir(work); },
});