// Dashboard: state computation + action menu.
import * as ui from './ui.mjs';
import * as auth from './auth.mjs';
import * as dryrun from './dryrun.mjs';
import * as sessionState from './session-state.mjs';
import { resolveWranglerBinary } from './wrangler-bin.mjs';
import { summarize } from './project.mjs';

export async function computeState(target) {
  const summary = summarize(target);
  const wr = resolveWranglerBinary({ target });

  const authView = auth.peek();

  let preflightInfo = null;
  if (wr.path && wr.version !== 'unknown') {
    const cached = dryrun.lookup({
      target,
      env: '',
      wranglerVersion: wr.version,
      wranglerBinaryPath: wr.path,
    });
    if (cached.hit) {
      const ageSec = Math.round(cached.ageMs / 1000);
      preflightInfo = `preflight valid (verified ${ageSec}s ago) — files unchanged`;
    } else if (cached.reason === 'unknown-version') {
      preflightInfo = 'wrangler version unknown — preflight will run fresh';
    } else {
      preflightInfo = 'files changed since last preflight';
    }
  }

  const lastAction = sessionState.load(target.root);

  let typeLabel;
  if (summary.assets) typeLabel = `Worker (assets: ${summary.assets})`;
  else if (summary.main) typeLabel = 'Worker';
  else typeLabel = 'unknown';

  let account;
  if (authView.authenticated) {
    account = authView.email || `${authView.accounts?.length || 1} account(s)`;
    if (authView.cached) {
  const age = ui.formatAge(authView.ageMs);
  account += authView.stale
    ? ` (cached ${age} — stale, will refresh on action)`
    : ` (cached ${age})`;
}
  } else if (authView.cached) {
    account = 'not authenticated (cached)';
  } else {
    account = 'not checked — will check on first action';
  }

  return {
    name: summary.name,
    type: typeLabel,
    account,
    authCached: authView.cached,
    authStale: authView.stale,
    authAuthenticated: authView.authenticated,
    preflightInfo,
    lastAction: sessionState.formatLast(lastAction),
    summary,
  };
}

export function renderHeader(state, version) {
  const lines = [
    `wrangler-tui ${version}`,
    `Project:  ${state.name}`,
    `Type:     ${state.type}`,
    `Account:  ${state.account}`,
    `Last:     ${state.lastAction}`,
  ];
  if (state.preflightInfo) lines.push(`State:    ${state.preflightInfo}`);
  return lines.join('\n');
}

export async function show(state, version, { selectFn } = {}) {
  const select = selectFn || ui.prompts.select;

  process.stderr.write('\n' + renderHeader(state, version) + '\n\n');

  const options = [];
  if (state.summary.assets || state.summary.main) {
    options.push({
      value: 'deploy',
      label: 'Deploy',
      hint: state.preflightInfo && state.preflightInfo.includes('valid')
        ? 'dry-run will be skipped (cache valid)'
        : 'runs dry-run, then live deploy',
    });
  } else {
    options.push({
      value: 'deploy',
      label: 'Deploy',
      hint: 'no main or assets in config — check wrangler.jsonc',
    });
  }
  options.push(
    { value: 'tail',   label: 'Tail logs',                    hint: 'stream remote logs; Ctrl-C stops' },
    { value: 'open',   label: 'Open in Cloudflare dashboard', hint: 'opens browser to the worker page' },
    { value: 'auth',   label: 'Re-authenticate',              hint: state.authAuthenticated ? 'refresh the cached auth' : 'start device flow' },
    { value: 'switch', label: 'Switch project',               hint: 'choose from recent projects' },
    { value: 'quit',   label: 'Quit',                         hint: 'exit wrangler-tui' },
  );

  const choice = await select({ message: 'What would you like to do?', options });
  return ui.isCancel(choice) ? 'quit' : choice;
}