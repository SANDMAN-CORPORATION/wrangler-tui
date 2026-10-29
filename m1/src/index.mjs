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

process.on('exit', () => { mark('node.exit'); ui.restoreTerminal(); });
process.on('uncaughtException', (err) => { ui.restoreTerminal(); console.error('fatal:', err); process.exitCode = 1; });
process.on('unhandledRejection', (err) => { ui.restoreTerminal(); console.error('fatal:', err); process.exitCode = 1; });

const VERSION = '0.1.0-m1';
const KNOWN = ['auth', 'logout', 'init', 'deploy', 'tail', 'test'];

const HELP = `wrangler-tui ${VERSION} — interactive Cloudflare Workers agent

Usage:
  wrangler-tui              interactive menu (requires project)
  wrangler-tui auth         authenticate (uses cache up to 5m)
  wrangler-tui auth --refresh   force a fresh auth check
  wrangler-tui logout       sign out (to switch accounts)
  wrangler-tui init         create a new Wrangler project
  wrangler-tui deploy       deploy to Cloudflare (requires project)
  wrangler-tui tail         stream logs (requires project)
  wrangler-tui test         self-test against a mock project
  wrangler-tui --version    print version
  wrangler-tui help         show this message

Options:
  --dir <path>              operate on a specific project directory
                            (relative paths resolve against cwd)
  --refresh                 (auth only) ignore cached status
  --fresh                   (deploy only) ignore dry-run cache
  --keep                    (test only) preserve the mock project

Environment:
  WRANGLER_TUI_STATE_DIR    shared state (default ~/.local/state/wrangler-tui)
  WRANGLER_TUI_AUTO_CONFIRM skip deploy confirmation if value matches worker name
                            (for automation only)
`;

function parseArgs(argv) {
  const out = {
    command: null, dir: null, keep: false, help: false, version: false,
    refresh: false, fresh: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') {
      const v = argv[++i];
      if (!v) throw new Error('--dir requires an argument');
      out.dir = v; continue;
    }
    if (a === '--keep')    { out.keep = true;    continue; }
    if (a === '--refresh') { out.refresh = true; continue; }
    if (a === '--fresh')   { out.fresh = true;   continue; }
    if (a === '--version' || a === '-v') { out.version = true; continue; }
    if (a === '--help' || a === '-h' || a === 'help') { out.help = true; continue; }
    if (a.startsWith('-')) throw new Error(`unknown flag: ${a}`);
    if (out.command) throw new Error(`unexpected argument: ${a}`);
    out.command = a;
  }
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

  if (args.dir && ['auth', 'logout', 'test'].includes(args.command)) {
    ui.note(`--dir is ignored for '${args.command}'`, 'Note');
  }
  if (args.fresh && args.command !== 'deploy') {
    ui.note(`--fresh is ignored for '${args.command}'`, 'Note');
  }

  // ── auth ────────────────────────────────────────────────────────
  if (args.command === 'auth') {
    mark('node.dispatch.auth');
    ui.stage(1, 3, args.refresh ? 'checking auth status (forced)' : 'checking auth status');
    const st = await auth.status({ force: args.refresh });
    mark('node.auth.status', st.cached ? `cached ${Math.round(st.ageMs / 1000)}s` : 'fresh');
    if (st.authenticated) {
      const age = st.cached ? `verified ${Math.round(st.ageMs / 1000)}s ago` : 'verified now';
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
    if (r.ok) {
      ui.stage(2, 2, 'verified');
      ui.outro('Logged out');
      return 0;
    }
    ui.outro(`Logout failed: ${r.reason || 'exit ' + r.exit}`);
    return 1;
  }

  // ── init ────────────────────────────────────────────────────────
  if (args.command === 'init') {
    mark('node.dispatch.init');
    ui.stage(1, 2, 'scaffolding');
    const r = await init.flow({ prefillDir: args.dir });
    mark('node.init', r.ok ? 'ok' : 'cancel');
    if (r.ok) {
      ui.stage(2, 2, 'created', r.dir || '');
      ui.outro('Done');
      return 0;
    }
    ui.outro('Init cancelled or failed');
    return 1;
  }

  // ── test ────────────────────────────────────────────────────────
  if (args.command === 'test') {
    mark('node.dispatch.test');
    ui.outro('');
    return await test.run({ keep: args.keep });
  }

  // ── project-required commands ──────────────────────────────────
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
    const picked = recent.load();
    if (picked.length > 0) {
      ui.note(
        'No wrangler.jsonc / wrangler.json / wrangler.toml found in this\n' +
        'directory or any parent. Pick a recent project, or cancel and\n' +
        'use --dir <path>.',
        'Project not detected'
      );
      const choice = await p.select({
        message: 'Recent projects:',
        options: [
          ...picked.map((path) => ({ value: path, label: path })),
          { value: '__cancel__', label: 'Cancel' },
        ],
      });
      if (ui.isCancel(choice) || choice === '__cancel__') {
        ui.outro('Exiting');
        return 1;
      }
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
        '  wrangler-tui init                   create a new project\n' +
        '  wrangler-tui deploy --dir <path>    target a specific project\n' +
        '  wrangler-tui auth                   authenticate (no project)\n' +
        '  wrangler-tui test                   self-test',
        'Project not detected'
      );
      ui.outro('Exiting');
      return 1;
    }
  }

  const s = summarize(target);
  ui.note(
    `Name:     ${s.name}\n` +
    `Source:   ${s.source}${s.source === 'explicit' ? ' (--dir)' : ' (cwd ancestry)'}\n` +
    `Config:   ${s.configPath}\n` +
    `Main:     ${s.main}\n` +
    `Env:      ${s.environments.length ? s.environments.join(', ') : '(none)'}`,
    'Project'
  );

  let action = args.command;
  if (!action) {
    ui.stage(2, 4, 'choosing action');
    action = await p.select({
      message: 'Action?',
      options: [
        { value: 'deploy', label: 'Deploy' },
        { value: 'tail',   label: 'Tail logs' },
        { value: 'auth',   label: 'Check auth / re-authenticate' },
        { value: 'logout', label: 'Sign out (switch accounts)' },
        { value: 'quit',   label: 'Quit' },
      ],
    });
    if (ui.isCancel(action) || action === 'quit') { ui.outro('Bye'); return 0; }
  }

  let env = '';
  if ((action === 'deploy' || action === 'tail') && s.environments.length) {
    ui.stage(3, 4, 'choosing environment');
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
  if (action === 'auth') {
    mark('node.dispatch.auth');
    const st = await auth.status();
    if (st.authenticated) {
      const age = st.cached ? `verified ${Math.round(st.ageMs / 1000)}s ago` : 'verified now';
      ui.note(
        `${st.email ? st.email + '\n' : ''}${st.accounts?.length ?? 0} account(s) authenticated\n${age}`,
        'Already authenticated'
      );
      result = { ok: true };
    } else {
      result = await auth.login({ onOutput: (c) => ui.stream(c) });
    }
  } else if (action === 'logout') {
    mark('node.dispatch.logout');
    result = await auth.logout();
  } else if (action === 'deploy') {
    mark('node.dispatch.deploy');
    result = await deploy.flow(target, env, { fresh: args.fresh });
  } else if (action === 'tail') {
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