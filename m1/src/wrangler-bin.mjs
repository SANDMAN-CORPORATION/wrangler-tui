// Single source of truth for Wrangler executable resolution.
// All modules that spawn wrangler call resolveWranglerBinary() so that
// version identification, auth, dry-run, and live deploy use the same
// executable within a single command.

import { existsSync, statSync, realpathSync, readFileSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const CACHE = { resolved: null, forTarget: null };

function isUsableExecutable(path) {
  try {
    const st = statSync(path);           // follows symlinks
    if (!st.isFile()) return false;
    if (typeof st.mode === 'number' && (st.mode & 0o111) === 0) return false;
    return true;
  } catch {
    return false;
  }
}

function readWranglerPackageVersion(binPath) {
  let realBin;
  try { realBin = realpathSync(binPath); } catch { return null; }
  let dir = dirname(realBin);
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const data = JSON.parse(readFileSync(pkg, 'utf8'));
        if (data && data.name === 'wrangler' && typeof data.version === 'string') {
          return data.version;
        }
      } catch { /* malformed — try parent */ }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveViaPath() {
  const PATH = process.env.PATH || '';
  for (const d of PATH.split(':')) {
    if (!d) continue;
    const p = join(d, 'wrangler');
    if (isUsableExecutable(p)) return p;
  }
  return null;
}

function spawnVersion(binPath) {
  try {
    const r = spawnSync(binPath, ['--version'], {
      encoding: 'utf8', shell: false, timeout: 30000,
    });
    if (r.status !== 0) return null;
    const m = (r.stdout || '').match(/(\d+\.\d+\.\d+[^\s]*)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the Wrangler executable.
 *   { target }  resolves project-local first, then env, then PATH
 *   {}          env, then PATH (for auth/logout which are not project-scoped)
 * Returns: { path, source, version, versionSource, error? }
 *   source:        'project-local' | 'env' | 'path' | 'none'
 *   versionSource: 'package.json' | 'spawn' | 'unknown'
 */
export function resolveWranglerBinary({ target } = {}) {
  const cacheKey = target?.root || null;
  if (CACHE.resolved && CACHE.forTarget === cacheKey) return CACHE.resolved;

  let path = null;
  let source = 'none';

  if (target?.root) {
    const local = join(target.root, 'node_modules', '.bin', 'wrangler');
    if (isUsableExecutable(local)) { path = local; source = 'project-local'; }
  }

  if (!path && process.env.WRANGLER_TUI_WRANGLER_BIN) {
    const envPath = process.env.WRANGLER_TUI_WRANGLER_BIN;
    const abs = isAbsolute(envPath) ? envPath : resolve(envPath);
    if (isUsableExecutable(abs)) { path = abs; source = 'env'; }
  }

  if (!path) {
    const p = resolveViaPath();
    if (p) { path = p; source = 'path'; }
  }

  if (!path) {
    const result = {
      path: null,
      source: 'none',
      version: 'unknown',
      versionSource: 'unknown',
      error: 'no usable wrangler executable found (checked project-local, WRANGLER_TUI_WRANGLER_BIN, PATH)',
    };
    CACHE.resolved = result;
    CACHE.forTarget = cacheKey;
    return result;
  }

  let version = null;
  let versionSource = 'unknown';
  const pkgVer = readWranglerPackageVersion(path);
  if (pkgVer) {
    version = pkgVer;
    versionSource = 'package.json';
  } else {
    const spawnVer = spawnVersion(path);
    if (spawnVer) {
      version = spawnVer;
      versionSource = 'spawn';
    }
  }

  const result = { path, source, version: version || 'unknown', versionSource };
  CACHE.resolved = result;
  CACHE.forTarget = cacheKey;
  return result;
}

export function resetResolver() {
  CACHE.resolved = null;
  CACHE.forTarget = null;
}