// Session loop. Stays open until the user picks Quit.
import * as ui from './ui.mjs';
import * as auth from './auth.mjs';
import * as deploy from './deploy.mjs';
import * as tail from './tail.mjs';
import * as dashboard from './dashboard.mjs';
import * as sessionState from './session-state.mjs';
import * as recent from './recent.mjs';
import { resolveTarget } from './project.mjs';
import { queueUrl } from './bridge.mjs';
import * as urls from './urls.mjs';

export async function run({ target, version, options = {}, dashboardSelectFn } = {}) {
  let currentTarget = target;

  for (;;) {
    let state;
    try {
      state = await dashboard.computeState(currentTarget);
    } catch (e) {
      ui.note(`Failed to compute state: ${e.message}`, 'Error');
      return 1;
    }

    const action = await dashboard.show(state, version, { selectFn: dashboardSelectFn });

    if (action === 'quit') {
      ui.outro('Bye');
      return 0;
    }

    let switchTo = null;
    try {
      switchTo = await dispatch(action, currentTarget, state, options);
    } catch (e) {
      ui.note(`Action failed: ${e.message}`, 'Error');
    }

    if (switchTo) {
      try {
        const newTarget = resolveTarget({ dir: switchTo });
        if (newTarget) {
          currentTarget = newTarget;
          recent.record(newTarget.root);
          ui.note(`Switched to ${newTarget.root}`, 'Project');
        } else {
          ui.note(`Could not resolve ${switchTo}`, 'Error');
        }
      } catch (e) {
        ui.note(`Failed to switch: ${e.message}`, 'Error');
      }
    }

    // Brief pause so the user can see the result before the panel re-renders.
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function dispatch(action, target, state, options) {
  if (action === 'deploy') {
    const r = await deploy.flow(target, '', { fresh: options.fresh });
    if (r.ok) {
      sessionState.record(target.root, 'deploy', 'ok');
    } else if (r.cancelled) {
      ui.note('Deploy cancelled — nothing was changed on Cloudflare.', 'Info');
    } else {
      sessionState.record(target.root, 'deploy', `fail: ${r.phase || 'unknown'}`);
      ui.note(
        `Deploy failed (${r.phase || 'unknown'}).\n\nThe Cloudflare state was not changed.`,
        'Error'
      );
    }
    return null;
  }

  if (action === 'tail') {
    sessionState.record(target.root, 'tail');
    await tail.flow(target, '');
    return null;
  }

  if (action === 'open') {
  const worker = state.summary.name;
  const url = urls.workerDashboardUrl(worker);
  if (!url) {
    ui.note('No worker name in config — cannot build a dashboard URL.', 'Error');
    return null;
  }
  queueUrl(url);
  ui.note(`Opening: ${url}\n\nIf the browser does not open, use this URL manually.`, 'Dashboard');
  sessionState.record(target.root, 'open-dashboard');
  return null;
}

  if (action === 'auth') {
    const r = await auth.login({ onOutput: (c) => ui.stream(c) });
    if (r.ok) {
      sessionState.record(target.root, 'auth', 'ok');
      ui.note(`Authenticated${r.email ? ' as ' + r.email : ''}`, 'Done');
    } else {
      ui.note(`Auth failed: ${r.reason || 'exit ' + r.exit}`, 'Error');
    }
    return null;
  }

  if (action === 'switch') {
    const picked = recent.load().filter((p) => p !== target.root);
    if (picked.length === 0) {
      ui.note(
        'No other recent projects yet.\n\n' +
        'Launch with --dir <path> to target a different project,\n' +
        'or use `wrangler-tui init` to create one.',
        'No other projects'
      );
      return null;
    }
    const choice = await ui.prompts.select({
      message: 'Switch to:',
      options: [
        ...picked.map((p) => ({ value: p, label: p })),
        { value: '__cancel__', label: 'Cancel' },
      ],
    });
    if (ui.isCancel(choice) || choice === '__cancel__') return null;
    return choice;
  }

  return null;
}