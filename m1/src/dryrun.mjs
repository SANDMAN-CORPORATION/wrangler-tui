// Dry-run cache. Skips wrangler deploy --dry-run when nothing changed.
//
// Cache key covers: config, source, package manifest, environment,
// wrangler version, AND the resolved wrangler executable path.
// Unknown wrangler version bypasses the cache entirely — do not read,
// do not store. A cache hit with unknown version would assert stability
// we cannot verify.

import {
  readFileSync, existsSync, statSync, readdirSync,
  writeFileSync, renameSync, mkdirSync, unlinkSync,
} from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';

const STATE = process.env.WRANGLER_TUI_STATE_DIR
  || join(process.env.HOME, '.local/state/wrangler-tui');
const CACHE_DIR = join(STATE, 'dryrun-cache');
const MAX_HASH_BYTES = 2 * 1024 * 1024;

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function projectCacheFile(projectRoot) {
  return join(CACHE_DIR, `${sha256(projectRoot)}.json`);
}

function hashFile(path) {
  try {
    const s = statSync(path);
    if (s.size > MAX_HASH_BYTES) return `oversize:${s.size}`;
    return sha256(readFileSync(path));
  } catch {
    return 'unreadable';
  }
}

function collectSourcePaths(target) {
  const out = new Set();
  const main = target.config?.main;

  if (main) {
    const mainPath = resolve(target.root, main);
    if (existsSync(mainPath) && statSync(mainPath).isFile()) out.add(mainPath);
    const mainDir = dirname(mainPath);
    if (existsSync(mainDir) && statSync(mainDir).isDirectory()) {
      for (const e of readdirSync(mainDir, { withFileTypes: true })) {
        if (e.isFile()) out.add(join(mainDir, e.name));
      }
    }
  }

  const srcDir = join(target.root, 'src');
  if (existsSync(srcDir) && statSync(srcDir).isDirectory()) {
    for (const e of readdirSync(srcDir, { withFileTypes: true })) {
      if (e.isFile()) out.add(join(srcDir, e.name));
    }
  }

  for (const e of readdirSync(target.root, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    if (/\.(js|mjs|cjs|ts|jsx|tsx)$/.test(e.name)) {
      out.add(join(target.root, e.name));
    }
  }

  return [...out].sort();
}

export function computeKey({ target, env, wranglerVersion, wranglerBinaryPath }) {
  if (!wranglerVersion || wranglerVersion === 'unknown') return null;

  const parts = [];
  parts.push(`config:${hashFile(target.configPath)}`);
  parts.push(`env:${env || ''}`);
  parts.push(`wranglerVersion:${wranglerVersion}`);
  parts.push(`wranglerBin:${wranglerBinaryPath || 'unresolved'}`);

  const lock = join(target.root, 'package-lock.json');
  const pkg = join(target.root, 'package.json');
  if (existsSync(lock)) parts.push(`pkg:${hashFile(lock)}`);
  else if (existsSync(pkg)) parts.push(`pkg:${hashFile(pkg)}`);

  const sources = collectSourcePaths(target);
  const sourceHashes = sources
    .map((p) => `${relative(target.root, p)}:${hashFile(p)}`)
    .join('\n');
  parts.push(`sources:${sha256(sourceHashes)}`);

  return sha256(parts.join('|'));
}

export function lookup({ target, env, wranglerVersion, wranglerBinaryPath }) {
  const key = computeKey({ target, env, wranglerVersion, wranglerBinaryPath });
  if (!key) return { hit: false, reason: 'unknown-version', key: null };

  const file = projectCacheFile(target.root);
  try {
    if (!existsSync(file)) return { hit: false, reason: 'no-cache-file', key };
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data.key !== key) return { hit: false, reason: 'key-mismatch', key };
    if (data.dryRunExit !== 0) return { hit: false, reason: 'previous-failure', key };
    return {
      hit: true,
      key,
      ageMs: Date.now() - data.verifiedAt,
      verifiedAt: data.verifiedAt,
      durationMs: data.dryRunDurationMs,
    };
  } catch (e) {
    return { hit: false, reason: `read-error: ${e.message}`, key };
  }
}

export function store({ target, env, wranglerVersion, wranglerBinaryPath, dryRunExit, durationMs }) {
  const key = computeKey({ target, env, wranglerVersion, wranglerBinaryPath });
  if (!key) return;   // unknown version — do not cache

  const file = projectCacheFile(target.root);
  const data = {
    key,
    projectRoot: target.root,
    env: env || '',
    wranglerVersion,
    wranglerBinaryPath: wranglerBinaryPath || null,
    dryRunExit,
    dryRunDurationMs: durationMs,
    verifiedAt: Date.now(),
  };
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, file);
  } catch { /* best-effort */ }
}

export function invalidate(target) {
  const file = projectCacheFile(target.root);
  try { if (existsSync(file)) unlinkSync(file); } catch { /* ignore */ }
}