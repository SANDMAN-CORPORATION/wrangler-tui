import { join } from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { run, assert, assertEqual, assertContains } from '../helpers.mjs';

export const name = 'timing';

export const tests = [
  {
    name: 'timing no-op without env vars',
    fn: async (ctx) => {
      const script = `
        import { mark, isEnabled } from ${JSON.stringify(join(ctx.REPO, 'm1/src/timing.mjs'))};
        process.stdout.write(String(isEnabled()) + '\\n');
        mark('should.not.write');
        process.exit(0);
      `;
      const r = await run('node', ['--input-type=module', '-e', script], {
        env: { WRANGLER_TUI_SHIM_START_MS: '', WRANGLER_TUI_TIMING_FILE: '' },
      });
      assertEqual(r.code, 0);
      assertEqual(r.stdout.trim(), 'false');
    },
  },
  {
    name: 'timing writes marks when env vars set',
    fn: async (ctx) => {
      mkdirSync(join(ctx.STATE, 'timing'), { recursive: true });
      const file = join(ctx.STATE, 'timing', `test-${Date.now()}.tsv`);
      const script = `
        import { mark, isEnabled } from ${JSON.stringify(join(ctx.REPO, 'm1/src/timing.mjs'))};
        mark('first.mark');
        mark('second.mark', 'with-detail');
        process.exit(0);
      `;
      const r = await run('node', ['--input-type=module', '-e', script], {
        env: {
          WRANGLER_TUI_SHIM_START_MS: String(Date.now() - 100),
          WRANGLER_TUI_TIMING_FILE: file,
        },
      });
      assertEqual(r.code, 0);
      assert(existsSync(file), 'timing file not created');
      const content = readFileSync(file, 'utf8');
      assertContains(content, 'first.mark');
      assertContains(content, 'second.mark\twith-detail');
    },
  },
];