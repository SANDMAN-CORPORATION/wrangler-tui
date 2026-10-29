// Tracks the last 10 successfully-resolved project directories.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const STATE = process.env.WRANGLER_TUI_STATE_DIR
  || join(process.env.HOME, '.local/state/wrangler-tui');
const FILE = join(STATE, 'recent-projects.json');
const CAP = 10;

export function load() {
  try {
    if (!existsSync(FILE)) return [];
    const arr = JSON.parse(readFileSync(FILE, 'utf8'));
    return Array.isArray(arr) ? arr.filter((p) => typeof p === 'string') : [];
  } catch { return []; }
}

export function record(root) {
  if (!root || typeof root !== 'string') return;
  const list = load().filter((p) => p !== root);
  list.unshift(root);
  const trimmed = list.slice(0, CAP);
  try {
    mkdirSync(STATE, { recursive: true });
    const tmp = `${FILE}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(trimmed, null, 2), { mode: 0o600 });
    renameSync(tmp, FILE);
  } catch { /* best-effort */ }
}

export function clear() {
  try { if (existsSync(FILE)) writeFileSync(FILE, '[]', { mode: 0o600 }); } catch { /* ignore */ }
}