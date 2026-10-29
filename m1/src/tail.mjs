import { spawnTask } from './supervisor.mjs';
import * as ui from './ui.mjs';
import * as auth from './auth.mjs';
import { resolveWranglerBinary } from './wrangler-bin.mjs';

export async function flow(target, env) {
  const c = target.config;
  const envArgs = env ? ['--env', env] : [];

  const wr = resolveWranglerBinary({ target });
  if (!wr.path) {
    ui.note(wr.error, 'Wrangler not found');
    return { ok: false, phase: 'wrangler-bin' };
  }

  const authStatus = await auth.status({ wranglerBin: wr.path });
  if (!authStatus.authenticated) {
    ui.note('Authentication required.', 'Auth');
    const r = await auth.ensure({ wranglerBin: wr.path, onOutput: (x) => ui.stream(x) });
    if (!r.ok) {
      ui.note(`Login failed: ${r.reason || 'exit ' + r.exit}`, 'Error');
      return { ok: false, phase: 'auth' };
    }
  }

  ui.note(
    `Tailing ${c.name}${env ? ` (${env})` : ''}\n` +
    `Config: ${target.configPath}\n` +
    `Press Ctrl-C to stop.`,
    'Starting'
  );

  const t = spawnTask(wr.path, ['tail', ...envArgs], { cwd: target.root }).start();
  t.on('data', (chunk) => ui.stream(chunk));

  const onSigint = () => { t.stop(); };
  process.on('SIGINT', onSigint);
  const result = await t.wait();
  process.off('SIGINT', onSigint);

  ui.note(`Tail ended (exit ${result.code}).`, 'Done');
  return { ok: result.code === 0 };
}