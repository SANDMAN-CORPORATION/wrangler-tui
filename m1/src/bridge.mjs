import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATE = process.env.WRANGLER_TUI_STATE_DIR
  || join(process.env.HOME, '.local/state/wrangler-tui');
const QUEUE = join(STATE, 'url-requests');

const recent = new Map();
const WINDOW_MS = 60_000;

export function queueUrl(url) {
  const now = Date.now();
  for (const [u, t] of recent) if (now - t > WINDOW_MS) recent.delete(u);
  if (recent.has(url)) return { queued: false, reason: 'duplicate' };

  mkdirSync(QUEUE, { recursive: true });
  const id = `url-${now}-${randomUUID().slice(0, 8)}`;
  const path = join(QUEUE, `${id}.url`);
  writeFileSync(path, url, { mode: 0o644 });
  recent.set(url, now);
  return { queued: true, path };
}

export function extractUrl(text) {
  const m = text.match(/https:\/\/[^\s"'<>]+/);
  return m ? m[0] : null;
}