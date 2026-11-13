import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { freshDir, cleanupDir, createProject, assert, assertEqual, assertContains } from '../helpers.mjs';
import { load, record, formatLast } from '../../src/session-state.mjs';
import { renderHeader } from '../../src/dashboard.mjs';
import { run as runSession } from '../../src/session.mjs';

export const name = 'session';

let work, projectDir;

export const tests = [
  {
    name: 'setup',
    fn: async (ctx) => {
      work = freshDir(ctx.STATE, 'session-work');
      projectDir = join(work, 'proj');
      createProject(projectDir, 'test-session-worker');
      process.env.WRANGLER_TUI_STATE_DIR = ctx.STATE;
    },
  },
  {
  name: 'session-state: load returns empty for unknown project',
  fn: async () => {
    const result = load('/nonexistent/path');
    assertEqual(Object.keys(result).length, 0, 'should have no keys');
  },
},
  {
    name: 'session-state: record and load round-trip',
    fn: async () => {
      record(projectDir, 'deploy', 'ok');
      const state = load(projectDir);
      assertEqual(state.action, 'deploy');
      assertEqual(state.detail, 'ok');
      assert(typeof state.at === 'number' && state.at > 0);
    },
  },
  {
    name: 'session-state: formatLast renders minutes',
    fn: async () => {
      const text = formatLast({ action: 'deploy', detail: 'ok', at: Date.now() - 5 * 60000 });
      assertContains(text, 'deploy');
      assertContains(text, '5 minutes ago');
    },
  },
  {
    name: 'session-state: formatLast renders just now',
    fn: async () => {
      const text = formatLast({ action: 'deploy', at: Date.now() });
      assertContains(text, 'just now');
    },
  },
  {
    name: 'session-state: formatLast handles empty',
    fn: async () => {
      assertEqual(formatLast(null), 'no previous action in this session');
    },
  },
  {
    name: 'dashboard: renderHeader includes all fields',
    fn: async () => {
      const header = renderHeader({
        name: 'demo',
        type: 'Worker (assets: ./dist)',
        account: 'user@example.com (cached 45s ago)',
        lastAction: 'deploy — 3 hours ago',
        preflightInfo: 'files unchanged',
      }, '0.4.0-m2');
      assertContains(header, 'wrangler-tui 0.4.0-m2');
      assertContains(header, 'demo');
      assertContains(header, 'Worker (assets: ./dist)');
      assertContains(header, 'user@example.com');
      assertContains(header, 'deploy — 3 hours ago');
      assertContains(header, 'files unchanged');
    },
  },
  {
    name: 'session: quit immediately with mock select',
    fn: async (ctx) => {
      const target = {
        root: projectDir,
        configPath: join(projectDir, 'wrangler.jsonc'),
        config: JSON.parse(readFileSync(join(projectDir, 'wrangler.jsonc'), 'utf8')),
        source: 'explicit',
      };
      let calls = 0;
      const mockSelect = async () => { calls += 1; return 'quit'; };
      const code = await runSession({
        target,
        version: '0.4.0-m2',
        options: {},
        dashboardSelectFn: mockSelect,
      });
      assertEqual(code, 0, 'session exit code');
      assertEqual(calls, 1, 'select called exactly once');
    },
  },
];

tests.push({ name: 'cleanup', fn: async () => { if (work) cleanupDir(work); } });