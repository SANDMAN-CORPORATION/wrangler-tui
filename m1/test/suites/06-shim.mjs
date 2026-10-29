import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, assertContains, assertNotContains, assertEqual } from '../helpers.mjs';

export const name = 'shim';

let src;

export const tests = [
  {
    name: 'launcher.sh reads',
    fn: async (ctx) => {
      src = readFileSync(join(ctx.REPO, 'm1/host/launcher.sh'), 'utf8');
      assert(src.length > 0, 'launcher.sh is empty');
    },
  },
  {
    name: 'launcher passes --work-dir (regression: cwd falls to /root without it)',
    fn: async () => {
      assertContains(src, '--work-dir "${PWD}"', 'launcher must set --work-dir');
    },
  },
  {
    name: 'launcher does NOT use exec (regression: traps and stty sane need to run)',
    fn: async () => {
      assertNotContains(src, 'exec proot-distro', 'launcher must not exec proot-distro');
    },
  },
  {
    name: 'launcher sets WRANGLER_TUI_SHIM_START_MS and TIMING_FILE',
    fn: async () => {
      assertContains(src, 'WRANGLER_TUI_SHIM_START_MS');
      assertContains(src, 'WRANGLER_TUI_TIMING_FILE');
    },
  },
  {
    name: 'launcher handles --dir for binding',
    fn: async () => {
      assertContains(src, 'DIR_ARG', 'launcher must inspect --dir for bind strategy');
    },
  },
  {
    name: 'launcher runs stty sane on exit',
    fn: async () => {
      assertContains(src, 'stty sane', 'launcher must restore terminal on exit');
    },
  },
];