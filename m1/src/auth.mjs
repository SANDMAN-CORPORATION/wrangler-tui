import { spawnTask } from './supervisor.mjs';
import { queueUrl, extractUrl } from './bridge.mjs';
import * as ui from './ui.mjs';
import { mark } from './timing.mjs';
import { resolveWranglerBinary } from './wrangler-bin.mjs';
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const SIGNUP_URL = 'https://dash.cloudflare.com/sign-up';
const STATE = process.env.WRANGLER_TUI_STATE_DIR
  || join(process.env.HOME, '.local/state/wrangler-tui');
const CACHE_FILE = join(STATE, 'auth-status.json');
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function cacheKey() {
  const h = createHash('sha256');
  h.update(STATE); h.update('\0');
  h.update(process.env.CLOUDFLARE_API_TOKEN ? 'token' : 'no-token'); h.update('\0');
  h.update(process.env.CLOUDFLARE_API_KEY ? 'key' : 'no-key'); h.update('\0');
  h.update(process.env.CLOUDFLARE_EMAIL ? 'email' : 'no-email');
  return h.digest('hex');
}

function readCache() {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    if (data.key !== cacheKey()) return null;
    if (typeof data.verifiedAt !== 'number') return null;
    return data;
  } catch { return null; }
}

function writeCache(status) {
  try {
    mkdirSync(STATE, { recursive: true });
    const data = { ...status, verifiedAt: Date.now(), key: cacheKey() };
    const tmp = `${CACHE_FILE}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, CACHE_FILE);
  } catch { /* best-effort */ }
}

function touchCache() {
  const data = readCache();
  if (!data) return;
  try {
    const updated = { ...data, verifiedAt: Date.now() };
    const tmp = `${CACHE_FILE}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(updated), { mode: 0o600 });
    renameSync(tmp, CACHE_FILE);
  } catch { /* best-effort */ }
}

export function invalidate() {
  try { if (existsSync(CACHE_FILE)) unlinkSync(CACHE_FILE); } catch { /* ignore */ }
}

async function freshStatus(bin) {
  mark('auth.status.spawn');
  const j = spawnTask(bin, ['whoami', '--json']).start();
  const jr = await j.wait();
  mark('auth.status.json', `exit=${jr.code}`);
  if (jr.code === 0) {
    try {
      const data = JSON.parse(j.output());
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      return { authenticated: accounts.length > 0, accounts, email: data.email || null, source: 'json' };
    } catch { /* fall through */ }
  }

  mark('auth.status.text.spawn');
  const t = spawnTask(bin, ['whoami']).start();
  const tr = await t.wait();
  mark('auth.status.text', `exit=${tr.code}`);
  const text = t.output();
  if (tr.code !== 0) return { authenticated: false, reason: `whoami exit ${tr.code}` };
  if (/not authenticated|not logged in|no account|you are not/i.test(text)) {
    return { authenticated: false, reason: 'text: not authenticated' };
  }
  const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.\w+/);
  return {
    authenticated: /account\s+id|account name/i.test(text),
    email: emailMatch ? emailMatch[0] : null,
    source: 'text',
  };
}

/**
 * Auth status. Cache-aware with sliding window.
 *   wranglerBin:  absolute path from resolveWranglerBinary(); falls back to
 *                 resolving from PATH/env when not provided.
 */
export async function status({ maxAge = DEFAULT_TTL_MS, force = false, wranglerBin } = {}) {
  if (!force && maxAge > 0) {
    const cached = readCache();
    if (cached) {
      const age = Date.now() - cached.verifiedAt;
      if (age <= maxAge) {
        touchCache();
        mark('auth.status.cached', `age=${Math.round(age / 1000)}s`);
        return { ...cached, cached: true, ageMs: age };
      }
    }
  }

  const bin = wranglerBin || resolveWranglerBinary().path;
  if (!bin) return { authenticated: false, reason: 'no wrangler binary' };

  const fresh = await freshStatus(bin);
  writeCache(fresh);
  return { ...fresh, cached: false, ageMs: 0, verifiedAt: Date.now() };
}

async function tryClipboard(text) {
  try {
    const t = spawnTask('termux-clipboard-set', [text]).start();
    const { code } = await t.wait();
    return code === 0;
  } catch { return false; }
}

export function login({ onOutput, wranglerBin } = {}) {
  return new Promise((resolve) => {
    const bin = wranglerBin || resolveWranglerBinary().path;
    if (!bin) return resolve({ ok: false, phase: 'login', reason: 'no wrangler binary' });

    invalidate();
    ui.note(
      `If you do not have a Cloudflare account yet, create one first:\n\n  ${SIGNUP_URL}\n\n` +
      `Then approve the sign-in request that opens in your browser.`,
      'Before you continue'
    );

    const t = spawnTask(bin, ['login', '--device', '--browser=false']).start();
    let accumulated = '';
    let deviceUrl = null;
    let deviceCode = null;
    let sideEffectsDone = false;

    t.on('data', (chunk) => {
      if (onOutput) onOutput(chunk);
      accumulated += chunk;

      if (!deviceUrl) {
        const url = extractUrl(accumulated);
        if (url) deviceUrl = url;
      }
      if (!deviceCode) {
        const m = accumulated.match(/enter the code:\s*\n+\s*([A-Za-z0-9\-]{4,20})/);
        if (m) deviceCode = m[1];
      }

      if (!sideEffectsDone && deviceUrl && deviceCode) {
        sideEffectsDone = true;
        const withCode = `${deviceUrl}${deviceUrl.includes('?') ? '&' : '?'}user_code=${encodeURIComponent(deviceCode)}`;
        queueUrl(withCode);
        tryClipboard(deviceCode).then((copied) => {
          const clip = copied ? 'Code copied to clipboard.\n\n' : '';
          ui.note(
            `${clip}If the browser did not pre-fill the code, enter it there:\n\n  ${deviceCode}\n\n` +
            `Approve the request to finish signing in.`,
            'Action needed'
          );
        });
      }
    });

    t.wait().then(async ({ code }) => {
      if (code !== 0) return resolve({ ok: false, phase: 'login', exit: code });
      const post = await status({ force: true, wranglerBin: bin });
      if (post.authenticated) {
        return resolve({ ok: true, accounts: post.accounts?.length ?? 0, email: post.email });
      }
      resolve({ ok: false, phase: 'verify', reason: post.reason || 'whoami shows unauthenticated' });
    });
  });
}

export async function ensure({ onOutput, wranglerBin } = {}) {
  const pre = await status({ wranglerBin });
  if (pre.authenticated) {
    return { ok: true, already: true, accounts: pre.accounts?.length ?? 0, email: pre.email };
  }
  return login({ onOutput, wranglerBin });
}

export async function logout({ wranglerBin } = {}) {
  const bin = wranglerBin || resolveWranglerBinary().path;
  if (!bin) return { ok: false, reason: 'no wrangler binary' };

  const t = spawnTask(bin, ['logout']).start();
  const { code } = await t.wait();
  invalidate();
  if (code !== 0) return { ok: false, exit: code };
  const post = await status({ force: true, wranglerBin: bin });
  if (post.authenticated) return { ok: false, reason: 'still authenticated after logout' };
  return { ok: true };
}