import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STATE = process.env.WRANGLER_TUI_STATE_DIR
  || join(process.env.HOME, '.local/state/wrangler-tui');

export function createMockProject(name = 'wrangler-tui-mock') {
  const dir = join(STATE, 'mock', `${name}-${Date.now()}`);
  mkdirSync(join(dir, 'src'), { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(join(dir, 'wrangler.jsonc'), `{
  "name": "${name}",
  "main": "src/index.js",
  "compatibility_date": "${date}"
}
`);
  writeFileSync(join(dir, 'src/index.js'), `export default {
  async fetch(request) {
    return new Response("mock worker from wrangler-tui test");
  }
};
`);
  writeFileSync(join(dir, 'package.json'), `{
  "name": "${name}",
  "type": "module",
  "private": true
}
`);
  return dir;
}

export function destroyMockProject(dir) {
  // Safety: only delete under $STATE/mock/
  if (dir && dir.includes('/mock/') && existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}