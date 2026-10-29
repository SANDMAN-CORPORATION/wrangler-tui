import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import * as jsonc from 'jsonc-parser';
import * as toml from 'smol-toml';

const CANDIDATES = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];

// ── config parsing ────────────────────────────────────────────────────

function parse(path, filename) {
  const raw = readFileSync(path, 'utf8');
  if (filename.endsWith('.toml')) return toml.parse(raw);
  const errors = [];
  const result = jsonc.parse(raw, errors, { allowTrailingComma: true });
  if (errors.length) {
    throw new Error(`JSONC parse errors in ${path}: ${JSON.stringify(errors, null, 2)}`);
  }
  return result;
}

// ── ancestry detection ────────────────────────────────────────────────

export function detect(start = process.cwd()) {
  let dir = resolve(start);
  while (true) {
    for (const name of CANDIDATES) {
      const p = join(dir, name);
      if (existsSync(p)) {
        return {
          root: dir,
          configPath: p,
          format: name.endsWith('.toml') ? 'toml' : 'jsonc',
          config: parse(p, name),
        };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ── target resolution ─────────────────────────────────────────────────

function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

// Levenshtein distance for typo recovery.
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = b.length + 1;
  const cols = a.length + 1;
  let prev = new Array(cols);
  let curr = new Array(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    curr[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

function isSimilar(a, b) {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return true;
  if (la.includes(lb) || lb.includes(la)) return true;
  if (Math.abs(la.length - lb.length) > 3) return false;
  return levenshtein(la, lb) <= 2;
}

function suggestAlternatives(abs, cwd) {
  const name = abs.split('/').pop() || '';
  if (!name) return [];
  const roots = new Set([
    abs.substring(0, abs.length - name.length - 1),
    cwd,
    homedir(),
  ]);
  const out = new Set();
  for (const root of roots) {
    try {
      if (!root || !existsSync(root)) continue;
      for (const e of readdirSync(root, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (e.name === name) continue;
        if (isSimilar(e.name, name)) {
          out.add(join(root, e.name));
          if (out.size >= 5) return [...out];
        }
      }
    } catch { /* permission errors — ignore */ }
  }
  return [...out];
}

function formatMiss(abs, cwd, kind = 'does not exist') {
  let msg = `--dir ${kind}: ${abs}`;
  const sugg = suggestAlternatives(abs, cwd);
  if (sugg.length === 1) {
    msg += `\n\nDid you mean:\n  ${sugg[0]}\n\nRetry:\n  wrangler-tui deploy --dir ${sugg[0]}`;
  } else if (sugg.length > 1) {
    msg += `\n\nDid you mean one of:\n${sugg.map((s) => '  ' + s).join('\n')}\n\n` +
           `Retry with --dir <one of the above>.`;
  }
  return msg;
}

/**
 * Resolve the target project.
 *   { dir }    explicit --dir; '~' expands, relative paths resolve against cwd
 *   { cwd }    fall back to ancestry walk
 * Returns { root, configPath, format, config, source } | null.
 * Throws for --dir validation failures.
 */
export function resolveTarget({ dir, cwd = process.cwd() } = {}) {
  if (dir) {
    const expanded = expandHome(dir);
    const abs = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
    if (!existsSync(abs)) {
      throw new Error(formatMiss(abs, cwd, 'does not exist'));
    }
    if (!statSync(abs).isDirectory()) {
      throw new Error(formatMiss(abs, cwd, 'is not a directory'));
    }
    for (const name of CANDIDATES) {
      const p = join(abs, name);
      if (existsSync(p)) {
        return {
          root: abs,
          configPath: p,
          format: name.endsWith('.toml') ? 'toml' : 'jsonc',
          config: parse(p, name),
          source: 'explicit',
        };
      }
    }
    throw new Error(formatMiss(abs, cwd, 'contains no wrangler.jsonc/json/toml'));
  }
  const found = detect(cwd);
  if (!found) return null;
  return { ...found, source: 'discovered' };
}

// ── summary ───────────────────────────────────────────────────────────

export function summarize(target) {
  const c = target.config || {};
  return {
    root: target.root,
    configPath: target.configPath,
    name: c.name || '(unnamed)',
    main: c.main || '(none)',
    compatibilityDate: c.compatibility_date || '(none)',
    environments: c.env ? Object.keys(c.env) : [],
    source: target.source,
  };
}