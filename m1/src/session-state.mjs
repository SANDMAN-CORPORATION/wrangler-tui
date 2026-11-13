// Per-project session state: last action, when it happened.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const STATE = process.env.WRANGLER_TUI_STATE_DIR
  || join(process.env.HOME, '.local/state/wrangler-tui');
const FILE = join(STATE, 'session-state.json');

function keyFor(root) {
  return createHash('sha256').update(root).digest('hex').slice(0, 16);
}

export function load(root) {
  try {
    if (!existsSync(FILE)) return {};
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    return data[keyFor(root)] || {};
  } catch { return {}; }
}

export function record(root, action, detail = '') {
  try {
    let data = {};
    if (existsSync(FILE)) {
      try { data = JSON.parse(readFileSync(FILE, 'utf8')); } catch { data = {}; }
    }
    data[keyFor(root)] = { action, detail, at: Date.now() };
    mkdirSync(STATE, { recursive: true });
    const tmp = `${FILE}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(tmp, FILE);
  } catch { /* best-effort */ }
}

export function formatLast(state) {
  if (!state || !state.at) return 'no previous action in this session';
  const ms = Date.now() - state.at;
  const min = Math.round(ms / 60000);
  const hrs = Math.round(ms / 3600000);
  const days = Math.round(ms / 86400000);
  let time;
  if (min < 1) time = 'just now';
  else if (min < 60) time = `${min} minute${min === 1 ? '' : 's'} ago`;
  else if (hrs < 24) time = `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  else time = `${days} day${days === 1 ? '' : 's'} ago`;
  return `${state.action}${state.detail ? ` (${state.detail})` : ''} — ${time}`;
}