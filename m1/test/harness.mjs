#!/usr/bin/env node
// Test harness. Discovers suites in ./suites/, runs each in order.
import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { mark, isEnabled as timingEnabled } from '../src/timing.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SUITES_DIR = join(HERE, 'suites');
const ARGS = process.argv.slice(2);
const TRACE = ARGS.includes('--trace');
const KEEP = ARGS.includes('--keep');
const LIST = ARGS.includes('--list');
const ONLY = (() => {
  const i = ARGS.indexOf('--only');
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : null;
})();
const SUITE_ARG = ARGS.find((a) => !a.startsWith('-'));

const ctx = {
  REPO: process.env.REPO,
  STATE: process.env.TEST_STATE,
  CLI: process.env.CLI,
  TRACE,
  KEEP,
};

const colors = {
  pass: '\x1b[32m', fail: '\x1b[31m', skip: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m',
};
const c = (k, s) => `${colors[k]}${s}${colors.reset}`;

let total = 0, passed = 0, failed = 0, skipped = 0;
let currentSuite = '';
const failures = [];

function section(title) {
  process.stdout.write(`\n${c('dim', '══')} ${title} ${c('dim', '══')}\n`);
}

function record(name, ok, detail) {
  total++;
  const tag = ok ? c('pass', 'PASS') : c('fail', 'FAIL');
  const ms = detail?.ms != null ? c('dim', ` (${detail.ms.toFixed(0)}ms)`) : '';
  process.stdout.write(`  ${tag} ${name}${ms}\n`);
  if (!ok) {
    failed++;
    failures.push({ suite: currentSuite, name, detail });
    if (detail?.ctx) {
      for (const [k, v] of Object.entries(detail.ctx)) {
        process.stdout.write(`       ${c('dim', k + ':')} ${String(v).split('\n').join('\n       ')}\n`);
      }
    }
  } else {
    passed++;
  }
}

function skip(name, reason) {
  total++;
  skipped++;
  process.stdout.write(`  ${c('skip', 'SKIP')} ${name} ${c('dim', '— ' + reason)}\n`);
}

// Trace subprocess spawns when --trace is set
async function traceSpawn(label, cmd, args, opts = {}) {
  if (!TRACE) return;
  process.stdout.write(`       ${c('dim', `$ ${label}: ${cmd} ${args.join(' ')}`)}\n`);
}

// Each suite exports { name, tests: [{ name, fn: async (ctx) => {...} }] }
async function loadSuites() {
  const files = readdirSync(SUITES_DIR).filter((f) => f.endsWith('.mjs')).sort();
  const suites = [];
  for (const f of files) {
    if (SUITE_ARG && !f.includes(SUITE_ARG)) continue;
    const mod = await import(pathToFileURL(join(SUITES_DIR, f)).href);
    suites.push({ file: f, name: mod.name || basename(f, '.mjs'), tests: mod.tests || [] });
  }
  return suites;
}

async function run() {
  const suites = await loadSuites();
  if (LIST) {
    for (const s of suites) {
      console.log(`${s.file.replace('.mjs', '')}  (${s.name})  ${s.tests.length} tests`);
    }
    return 0;
  }

  const start = performance.now();
  section('wrangler-tui test suite');
  console.log(`  ${c('dim', 'repo:')} ${ctx.REPO}`);
  console.log(`  ${c('dim', 'state:')} ${ctx.STATE}`);
  console.log(`  ${c('dim', 'cli:')} ${ctx.CLI}`);
  console.log(`  ${c('dim', 'suites:')} ${suites.map((s) => s.file.replace('.mjs', '')).join(', ')}`);

  for (const suite of suites) {
    if (ONLY && !suite.name.includes(ONLY) && !suite.file.includes(ONLY)) continue;
    currentSuite = suite.name;
    section(`${suite.file.replace('.mjs', '')} — ${suite.name}`);
    for (const t of suite.tests) {
      if (ONLY && !t.name.includes(ONLY)) { skip(t.name, 'filtered'); continue; }
      const t0 = performance.now();
      try {
        await t.fn(ctx);
        record(t.name, true, { ms: performance.now() - t0 });
      } catch (err) {
        record(t.name, false, {
          ms: performance.now() - t0,
          ctx: {
            error: err.message || String(err),
            stack: (err.stack || '').split('\n').slice(1, 6).join('\n'),
            ...(err.ctx || {}),
          },
        });
      }
    }
  }

  const totalMs = performance.now() - start;
  section('summary');
  console.log(`  total:   ${total}`);
  console.log(`  ${c('pass', 'passed:')}  ${passed}`);
  console.log(`  ${c('fail', 'failed:')}  ${failed}`);
  if (skipped) console.log(`  ${c('skip', 'skipped:')} ${skipped}`);
  console.log(`  elapsed: ${totalMs.toFixed(0)}ms`);
  console.log(`  state:   ${ctx.STATE}${KEEP ? c('dim', ' (kept)') : c('dim', ' (auto-cleaned)')}`);

  if (failed > 0) {
    section('failures');
    for (const f of failures) {
      console.log(`  ${c('fail', 'FAIL')} [${f.suite}] ${f.name}`);
      if (f.detail?.ctx?.error) console.log(`       ${c('dim', 'error:')} ${f.detail.ctx.error}`);
    }
  }
  return failed > 0 ? 1 : 0;
}

process.on('exit', () => { mark('test.harness.exit'); });

run().then((code) => { process.exitCode = code; }).catch((err) => {
  console.error('harness crashed:', err);
  process.exitCode = 2;
});