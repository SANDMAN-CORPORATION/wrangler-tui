// Shared utilities for suites. Every helper throws AssertionError on failure
// with enough context to debug from the terminal alone.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export class AssertionError extends Error {
  constructor(msg, ctx = {}) {
    super(msg);
    this.ctx = ctx;
  }
}

export function assert(cond, msg, ctx = {}) {
  if (!cond) throw new AssertionError(msg, ctx);
}

export function assertEqual(actual, expected, label = '') {
  if (actual !== expected) {
    throw new AssertionError(
      `${label || 'values'} differ`,
      { expected: JSON.stringify(expected), actual: JSON.stringify(actual) }
    );
  }
}

export function assertContains(haystack, needle, label = '') {
  if (!haystack.includes(needle)) {
    throw new AssertionError(
      `${label || 'output'} missing expected substring`,
      { expected_substring: needle, actual: haystack.slice(0, 500) }
    );
  }
}

export function assertNotContains(haystack, needle, label = '') {
  if (haystack.includes(needle)) {
    throw new AssertionError(
      `${label || 'output'} contains forbidden substring`,
      { forbidden_substring: needle, actual: haystack.slice(0, 500) }
    );
  }
}

export async function expectThrows(fn, pattern) {
  try {
    await fn();
  } catch (err) {
    const msg = err.message || String(err);
    if (pattern && !msg.match(pattern)) {
      throw new AssertionError(
        `error message did not match pattern`,
        { pattern: String(pattern), got: msg }
      );
    }
    return err;
  }
  throw new AssertionError(`expected throw matching ${pattern}, but nothing thrown`);
}

/**
 * Spawn a command with full capture. Never throws on non-zero exit;
 * callers assert on the returned .code.
 */
export function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (e) => res({ code: -1, error: e.message, stdout, stderr, ms: Date.now() - t0 }));
    if (opts.stdin) { p.stdin.write(opts.stdin); p.stdin.end(); } else p.stdin.end();
    p.on('close', (code, signal) => res({
      code, signal, stdout, stderr, ms: Date.now() - t0,
      combined: stdout + stderr,
    }));
    if (opts.timeout) setTimeout(() => p.kill('SIGKILL'), opts.timeout);
  });
}

/** Create a minimal Wrangler project at <dir>. Returns <dir>. */
export function createProject(dir, name = 'test-worker') {
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'wrangler.jsonc'), `{
  "name": "${name}",
  "main": "src/index.js",
  "compatibility_date": "${date}"
}\n`);
  writeFileSync(join(dir, 'src', 'index.js'),
    `export default { async fetch() { return new Response("ok"); } };\n`);
  writeFileSync(join(dir, 'package.json'),
    `{ "name": "${name}", "type": "module", "private": true }\n`);
  return dir;
}

export function freshDir(parent, name) {
  const d = join(parent, name);
  if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}

export function cleanupDir(dir) {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}