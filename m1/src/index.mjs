#!/usr/bin/env node
import * as p from '@clack/prompts';
import { mark } from './timing.mjs';
import { detect, resolveTarget, summarize } from './project.mjs';
import * as ui from './ui.mjs';
import * as auth from './auth.mjs';
import * as deploy from './deploy.mjs';
import * as tail from './tail.mjs';
import * as init from './init.mjs';
import * as test from './test.mjs';
import * as recent from './recent.mjs';
import * as pages from './pages.mjs';
import * as adopt from './adopt.mjs';
import * as session from './session.mjs';
import * as inspect from './inspect.mjs';
import { detectShape, shapeLabel } from './shape.mjs';
import { activeTasks } from './supervisor.mjs';
import { queueUrl } from './bridge.mjs';

process.on('exit', () => { mark('node.exit'); ui.restoreTerminal(); });
process.on('uncaughtException', (err) => { ui.restoreTerminal(); console.error('fatal:', err); process.exitCode = 1; });
process.on('unhandledRejection', (err) => { ui.restoreTerminal(); console.error('fatal:', err); process.exitCode = 1; });

// ── SIGINT / SIGTERM: kill children before the parent exits ──────
// Without this, if SIGINT is sent by PID (not process group),
// spawned wrangler children are orphaned. In a TTY, Ctrl-C hits
// the group so children die anyway — but scripts, supervisors,
// and test harnesses send signals by PID.
let interruptCount = 0;

async function handleInterrupt(signal) {
  interruptCount += 1;
  ui.restoreTerminal();

  if (interruptCount > 1) {
    for (const t of activeTasks) {
      try { t.child?.kill('SIGKILL'); } catch { /* ignore */ }
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  }

  process.stderr.write(`\n\x1b[33m[${signal}] stopping children… (press Ctrl-C again to force)\x1b[0m\n`);

  for (const t of activeTasks) {
    try { t.child?.kill('SIGTERM'); } catch { /* ignore */ }
  }

  const deadline = Date.now() + 3000;
  while (activeTasks.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const t of activeTasks) {
    try { t.child?.kill('SIGKILL'); } catch { /* ignore */ }
  }
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.on('SIGINT', () => { handleInterrupt('SIGINT'); });
process.on('SIGTERM', () => { handleInterrupt('SIGTERM'); });

const VERSION = '0.8.0-m2';
const KNOWN = ['auth', 'logout', 'init', 'adopt', 'deploy', 'tail', 'test', 'pages', 'inspect'];

const HELP = `wrangler-tui ${VERSION} — interactive Cloudflare agent

Usage:
  wrangler-tui              open interactive session (recommended)
  wrangler-tui inspect      analyze current directory (read-only)
  wrangler-tui auth         one-shot: authenticate
  wrangler-tui logout       one-shot: sign out
  wrangler-tui init         one-shot: create a project from template
  wrangler-tui adopt        one-shot: make existing directory deployable
  wrangler-tui deploy       one-shot: deploy a Worker
  wrangler-tui tail         one-shot: stream Worker logs
  wrangler-tui pages        one-shot: Cloudflare Pages operations
  wrangler-tui test         self-test
  wrangler-tui --version    print version
  wrangler-tui help         show this message

Session vs one-shot:
  Running wrangler-tui with no command opens a persistent session.
  Each action returns to the dashboard. Press 'q' to quit.
  One-shot commands are for scripting and CI.

Adopt an existing directory (no template download):
  wrangler-tui adopt                   interactive (uses shape detection)
  wrangler-tui adopt --target worker-assets --preset spa
  wrangler-tui adopt --target pages --name my-site

Shape detection automatically recognizes:
  • Existing Worker projects (wrangler.jsonc)
  • Vite / Astro / SvelteKit / Nuxt / Next.js / Remix projects
  • Pre-built dist/ folders
  • Plain static sites (index.html)
  • Pages Functions (functions/)
  • Frameworks requiring an adapter — blocks with install instructions

Pages commands:
  wrangler-tui pages deploy [<dir>]
  wrangler-tui pages list
  wrangler-tui pages create <name>

Options:
  --dir <path>              operate on a specific project directory
  --assets-dir <path>       (adopt) static assets directory
  --target <t>              (adopt) worker-assets | pages
  --preset <p>              (adopt) static | spa
  --base-path <path>        (adopt) serve assets under a URL subpath
  --name <name>             project name
  --branch <branch>         Pages production branch
  --refresh                 (auth) ignore cached status
  --fresh                   (deploy) ignore dry-run cache
  --open                    (deploy) open dashboard after success
  --keep                    (test) preserve mock project

Environment:
  WRANGLER_TUI_STATE_DIR    shared state (default ~/.local/state/wrangler-tui)
  WRANGLER_TUI_WRANGLER_BIN explicit Wrangler executable path
  WRANGLER_TUI_AUTH_TTL_MS  auth cache TTL in ms (default 900000 = 15 min;
                            set to 0 to disable caching)
`;

function parseArgs(argv) {
  const out = {
    command: null, subcommand: null,
    dir: null, name: null, branch: null,
    target: null, preset: null, assetsDir: null, basePath: null,
    keep: false, help: false, version: false, refresh: false, fresh: false, open: false,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('-')) throw new Error(`${a} requires an argument`);
      return v;
    };
    if (a === '--dir')        { out.dir = value(); continue; }
    if (a === '--name')       { out.name = value(); continue; }
    if (a === '--branch')     { out.branch = value(); continue; }
    if (a === '--target')     { out.target = value(); continue; }
    if (a === '--preset')     { out.preset = value(); continue; }
    if (a === '--assets-dir') { out.assetsDir = value(); continue; }
    if (a === '--base-path')  { out.basePath = value(); continue; }
    if (a === '--keep')    { out.keep = true;    continue; }
    if (a === '--refresh') { out.refresh = true; continue; }
    if (a === '--fresh')   { out.fresh = true;   continue; }
    if (a === '--open')    { out.open = true;    continue; }
    if (a === '--version' || a === '-v') { out.version = true; continue; }
    if (a === '--help' || a === '-h' || a === 'help') { out.help = true; continue; }
    if (a.startsWith('-')) throw new Error(`unknown flag: ${a}`);
    positionals.push(a);
  }
  if (positionals.length > 0) out.command = positionals[0];
  if (positionals.length > 1) {
    if (out.command !== 'pages') throw new Error(`unexpected argument: ${positionals[1]}`);
    out.subcommand = positionals[1];
  }
  if (positionals.length > 2) {
    const extra = positionals[2];
    if (out.command === 'pages' && out.subcommand === 'create' && !out.name) out.name = extra;
    else throw new Error(`unexpected argument: ${extra}`);
  }
  if (positionals.length > 3) throw new Error(`unexpected argument: ${positionals[3]}`);
  return out;
}

async function main() {
  mark('node.main.start');
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(e.message); return 2; }

  if (args.version) { console.log(`wrangler-tui ${VERSION}`); return 0; }
  if (args.help) { console.log(HELP); return 0; }

  if (args.command && !KNOWN.includes(args.command)) {
    ui.intro('wrangler-tui');
    ui.note(`Unknown command: ${args.command}\n\nRun 'wrangler-tui help' for usage.`, 'Error');
    ui.outro('Exiting');
    return 2;
  }

  ui.intro(`wrangler-tui ${VERSION}`);
  mark('node.first_frame');

  // ── auth ────────────────────────────────────────────────────────
  if (args.command === 'auth') {
    mark('node.dispatch.auth');
    ui.stage(1, 3, args.refresh ? 'checking auth status (forced)' : 'checking auth status');
    const st = await auth.status({ force: args.refresh });
    mark('node.auth.status', st.cached ? `cached ${ui.formatAge(st.ageMs)}` : 'fresh');
    if (st.authenticated) {
      const age = st.cached ? `verified ${ui.formatAge(st.ageMs)}` : 'verified now';
      ui.note(
        `${st.email ? st.email + '\n' : ''}${st.accounts?.length ?? 0} account(s) authenticated\n${age}`,
        'Already authenticated'
      );
      ui.outro('Done');
      return 0;
    }
    ui.stage(2, 3, 'starting device login');
    const r = await auth.login({ onOutput: (c) => ui.stream(c) });
    mark('node.auth.login', r.ok ? 'ok' : 'fail');
    if (r.ok) {
      ui.stage(3, 3, 'verified');
      ui.outro(`Authenticated${r.email ? ' as ' + r.email : ''}`);
      return 0;
    }
    ui.outro(`Auth failed: ${r.reason || 'exit ' + r.exit}`);
    return 1;
  }

  // ── logout ──────────────────────────────────────────────────────
  if (args.command === 'logout') {
    mark('node.dispatch.logout');
    ui.stage(1, 2, 'signing out');
    const r = await auth.logout();
    mark('node.logout', r.ok ? 'ok' : 'fail');
    if (r.ok) { ui.stage(2, 2, 'verified'); ui.outro('Logged out'); return 0; }
    ui.outro(`Logout failed: ${r.reason || 'exit ' + r.exit}`);
    return 1;
  }

  // ── init ────────────────────────────────────────────────────────
  if (args.command === 'init') {
    mark('node.dispatch.init');
    ui.stage(1, 2, 'scaffolding');
    const r = await init.flow({ prefillDir: args.dir });
    mark('node.init', r.ok ? 'ok' : 'cancel');
    if (r.ok) { ui.stage(2, 2, 'created', r.dir || ''); ui.outro('Done'); return 0; }
    ui.outro('Init cancelled or failed');
    return 1;
  }

  // ── inspect ─────────────────────────────────────────────────────
  if (args.command === 'inspect') {
    mark('node.dispatch.inspect');
    const code = await inspect.flow({ dir: args.dir });
    mark('node.inspect.done', String(code));
    return code;
  }

  // ── adopt ───────────────────────────────────────────────────────
  if (args.command === 'adopt') {
    mark('node.dispatch.adopt');
    const r = await adopt.flow({
      dir: args.dir, assetsDir: args.assetsDir, target: args.target,
      preset: args.preset, name: args.name, branch: args.branch, basePath: args.basePath,
    });
    mark('node.adopt.done', r.ok ? 'ok' : (r.phase || 'fail'));
    if (r.ok) { ui.outro('Done'); return 0; }
    if (r.phase === 'already-deployable') { ui.outro('Already deployable'); return 0; }
    ui.outro(`Failed: ${r.phase || 'unknown'}`);
    return 1;
  }

  // ── test ────────────────────────────────────────────────────────
  if (args.command === 'test') {
    mark('node.dispatch.test');
    ui.outro('');
    return await test.run({ keep: args.keep });
  }

  // ── pages ───────────────────────────────────────────────────────
  if (args.command === 'pages') {
    mark('node.dispatch.pages', args.subcommand || 'deploy');
    const r = await pages.dispatch(args.subcommand, {
      dir: args.dir, name: args.name, branch: args.branch,
    });
    mark('node.pages.done', r.ok ? 'ok' : (r.phase || 'fail'));
    if (r.ok) { ui.outro('Done'); return 0; }
    ui.outro(`Failed: ${r.phase || 'unknown'}`);
    return 1;
  }

  // ── resolve project (session or one-shot deploy/tail) ──────────
  ui.stage(1, 4, 'resolving project', args.dir ? `(--dir ${args.dir})` : '');
  let target;
  try {
    target = resolveTarget({ dir: args.dir });
  } catch (e) {
    mark('node.project.error', e.message);
    ui.note(e.message, 'Project resolution failed');
    ui.outro('Exiting');
    return 1;
  }
  mark('node.project.resolved', target ? target.configPath : 'none');

  if (target) recent.record(target.root);

  if (!target) {
    const shape = detectShape(args.dir || process.cwd());
    if (shape.deployable && shape.deployTarget !== 'already-worker') {
      ui.note(
        `No wrangler config found, but ${shapeLabel(shape.shape)} detected.\n\n` +
        `Evidence:\n${shape.evidence.map((e) => `  • ${e}`).join('\n')}\n\n` +
        `To make this directory deployable:\n  wrangler-tui adopt` +
        (shape.recommendedPreset ? `\n\nDetection recommends preset: ${shape.recommendedPreset}` : ''),
        'Adopt available'
      );
      ui.outro('Exiting');
      return 1;
    }

    const picked = recent.load();
    if (picked.length > 0) {
      ui.note(
        'No wrangler.jsonc / wrangler.json / wrangler.toml found in this\n' +
        'directory or any parent. Pick a recent project, or cancel.',
        'Project not detected'
      );
      const choice = await p.select({
        message: 'Recent projects:',
        options: [
          ...picked.map((path) => ({ value: path, label: path })),
          { value: '__cancel__', label: 'Cancel' },
        ],
      });
      if (ui.isCancel(choice) || choice === '__cancel__') { ui.outro('Exiting'); return 1; }
      try {
        target = resolveTarget({ dir: choice });
        recent.record(target.root);
      } catch (e) {
        ui.note(`Failed to resolve ${choice}:\n\n${e.message}`, 'Error');
        ui.outro('Exiting');
        return 1;
      }
      mark('node.project.picked', target.configPath);
    } else {
      ui.note(
        'No wrangler.jsonc / wrangler.json / wrangler.toml found in this\n' +
        'directory or any parent.\n\n' +
        'Options:\n' +
        '  wrangler-tui inspect                  analyze this directory\n' +
        '  wrangler-tui init                     create a Worker project\n' +
        '  wrangler-tui adopt                    make this directory deployable\n' +
        '  wrangler-tui pages deploy             deploy a static site\n' +
        '  wrangler-tui deploy --dir <path>      target a specific project\n' +
        '  wrangler-tui auth                     authenticate (no project)\n' +
        '  wrangler-tui test                     self-test',
        'Project not detected'
      );
      ui.outro('Exiting');
      return 1;
    }
  }

  // ── session mode (no command) ──────────────────────────────────
  if (!args.command) {
    mark('node.session.start');
    return await session.run({
      target,
      version: VERSION,
      options: { fresh: args.fresh },
    });
  }

  // ── one-shot deploy / tail ─────────────────────────────────────
  const s = summarize(target);
  ui.note(
    `Name:     ${s.name}\n` +
    `Source:   ${s.source}${s.source === 'explicit' ? ' (--dir)' : ' (cwd ancestry)'}\n` +
    `Config:   ${s.configPath}\n` +
    (s.assets ? `Assets:   ${s.assets}\n` : '') +
    (s.main ? `Main:     ${s.main}\n` : '') +
    `Env:      ${s.environments.length ? s.environments.join(', ') : '(none)'}`,
    'Project'
  );

  let env = '';
  if ((args.command === 'deploy' || args.command === 'tail') && s.environments.length) {
    env = await p.select({
      message: 'Environment?',
      options: [
        { value: '', label: 'default' },
        ...s.environments.map((e) => ({ value: e, label: e })),
      ],
    });
    if (ui.isCancel(env)) { ui.outro('Cancelled'); return 1; }
  }

  let result = { ok: false, phase: 'unknown' };
  if (args.command === 'deploy') {
    mark('node.dispatch.deploy');
    result = await deploy.flow(target, env, { fresh: args.fresh });
    if (result.ok && args.open && result.dashboardUrl) {
      queueUrl(result.dashboardUrl);
      ui.note(`Opening: ${result.dashboardUrl}`, 'Dashboard');
    }
  } else if (args.command === 'tail') {
    mark('node.dispatch.tail');
    result = await tail.flow(target, env);
  }

  mark('node.action.done', result.ok ? 'ok' : (result.phase || 'fail'));
  if (result.ok) { ui.outro('Done'); return 0; }
  ui.outro(`Failed: ${result.phase || 'unknown'}`);
  return 1;
}

main()
  .then((code) => { ui.restoreTerminal(); process.exitCode = code; })
  .catch((err) => {
    ui.restoreTerminal();
    console.error('fatal:', err);
    process.exitCode = 1;
  });