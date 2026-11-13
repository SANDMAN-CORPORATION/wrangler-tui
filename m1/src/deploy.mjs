import { spawnTask } from './supervisor.mjs';
import * as ui from './ui.mjs';
import * as auth from './auth.mjs';
import * as dryrun from './dryrun.mjs';
import * as validate from './validate.mjs';
import * as urls from './urls.mjs';
import { mark } from './timing.mjs';
import { resolveWranglerBinary } from './wrangler-bin.mjs';

async function defaultConfirm(expectedName) {
  const answer = await ui.prompts.text({
    message: `Type worker name to confirm deploy (${expectedName}):`,
    placeholder: expectedName,
  });
  if (ui.isCancel(answer) || answer !== expectedName) return null;
  return answer;
}

export async function flow(target, env, opts = {}) {
  const c = target.config;
  const envArgs = env ? ['--env', env] : [];
  const confirmFn = opts.confirmFn || defaultConfirm;

  // ── 1. Resolve wrangler binary (single source for version + execution) ─
  mark('deploy.wrangler.resolve.start');
  const wr = resolveWranglerBinary({ target });
  if (wr.versionSource === 'package.json') {
    mark('deploy.wrangler.version.fast', `${wr.version} ${wr.path}`);
  } else if (wr.versionSource === 'spawn') {
    mark('deploy.wrangler.version.spawn', `${wr.version}`);
  } else {
    mark('deploy.wrangler.version.unknown');
  }
  mark('deploy.wrangler.resolve.done', `source=${wr.source}`);

  if (!wr.path) {
    ui.note(wr.error, 'Wrangler not found');
    return { ok: false, phase: 'wrangler-bin' };
  }
  process.stderr.write(
    `\x1b[2m   wrangler: ${wr.path}\n` +
    `   source: ${wr.source}   version: ${wr.version} (${wr.versionSource})\x1b[0m\n`
  );

  // ── 2. Auth (same binary) ────────────────────────────────────────
  const authStatus = await auth.status({ wranglerBin: wr.path });
  if (!authStatus.authenticated) {
    ui.note('Authentication required.', 'Auth');
    const r = await auth.ensure({ wranglerBin: wr.path, onOutput: (x) => ui.stream(x) });
    if (!r.ok) {
      ui.note(`Login failed: ${r.reason || 'exit ' + r.exit}`, 'Error');
      return { ok: false, phase: 'auth' };
    }
  } else if (authStatus.cached) {
  process.stderr.write(
    `\x1b[2m   auth: cached (verified ${ui.formatAge(authStatus.ageMs)})\x1b[0m\n`
  );
}

  // ── 3. Target display ────────────────────────────────────────────
  const targetLines = [
    `Worker:       ${c.name || '(unnamed)'}`,
    `Environment:  ${env || 'default'}`,
  ];
  if (c.main) targetLines.push(`Main:         ${c.main}`);
  if (c.assets?.directory) targetLines.push(`Assets:       ${c.assets.directory}`);
  if (c.assets?.not_found_handling) targetLines.push(`Routing:      ${c.assets.not_found_handling}`);
  if (c.assets?.base_path) targetLines.push(`Base path:    ${c.assets.base_path}`);
  targetLines.push(`Compat date:  ${c.compatibility_date || '(none)'}`);
  targetLines.push(`Config:       ${target.configPath}`);
  ui.note(targetLines.join('\n'), 'Deployment target');

  // ── 4. Pre-deploy validation (before any wrangler spawn) ─────────
  mark('deploy.validate.start');
  const validation = validate.validateWorkerDeploy(target);
  mark('deploy.validate.done', validation.ok ? 'ok' : 'fail');
  if (!validate.render(validation, ui, 'Pre-deploy check')) {
    return { ok: false, phase: 'validation', errors: validation.errors };
  }

  // ── 5. Preflight (cache-aware dry-run) ───────────────────────────
  mark('deploy.preflight.start');
  let fromCache = false;

  if (!opts.fresh) {
    const cached = dryrun.lookup({
      target, env,
      wranglerVersion: wr.version,
      wranglerBinaryPath: wr.path,
    });
    if (cached.hit) {
      const ageSec = Math.round(cached.ageMs / 1000);
      const durSec = Math.round(cached.durationMs / 1000);
      ui.note(
        `dry-run: verified ${ageSec}s ago (source unchanged)\n` +
        `Skipping ${durSec}s preflight. Use --fresh to force.`,
        'Preflight cached'
      );
      fromCache = true;
      mark('deploy.dryrun.cached', `age=${ageSec}s`);
    } else if (cached.reason === 'unknown-version') {
      process.stderr.write(
        `\x1b[2m   dry-run: wrangler version unknown, cache disabled\x1b[0m\n`
      );
    }
  }

  if (!fromCache) {
    const spin = ui.prompts.spinner();
    spin.start('Running dry-run');
    const t0 = Date.now();
    const dry = spawnTask(wr.path, ['deploy', '--dry-run', ...envArgs], {
      cwd: target.root,
    }).start();
    const dryResult = await dry.wait();
    const durationMs = Date.now() - t0;

    if (dryResult.code !== 0) {
      spin.stop('Dry-run failed');
      ui.note(dry.output().slice(-2000), 'Dry-run output');
      mark('deploy.dryrun.failed', `exit=${dryResult.code}`);
      return { ok: false, phase: 'dry_run', exit: dryResult.code };
    }
    spin.stop('Dry-run passed');

    try {
      dryrun.store({
        target, env,
        wranglerVersion: wr.version,
        wranglerBinaryPath: wr.path,
        dryRunExit: dryResult.code,
        durationMs,
      });
    } catch { /* best-effort */ }
    mark('deploy.dryrun.fresh', `duration=${Math.round(durationMs / 1000)}s`);
  }

  mark('deploy.preflight.done');

  // ── 6. Confirmation (via injected confirmFn) ─────────────────────
  const expectedName = c.name;
  const confirmed = await confirmFn(expectedName);
  if (!confirmed || confirmed !== expectedName) {
    ui.note('Deploy cancelled (name did not match).', 'Cancelled');
    return { ok: false, cancelled: true };
  }

  // ── 7. Live deploy (same binary) ─────────────────────────────────
  ui.note('Deploying live...', 'Starting');
  mark('deploy.live.start');
  const dep = spawnTask(wr.path, ['deploy', ...envArgs], {
    cwd: target.root,
  }).start();

  let streamedUrl = null;
  let scanBuffer = '';
  dep.on('data', (chunk) => {
    ui.stream(chunk);
    if (!streamedUrl) {
      scanBuffer += chunk.toString();
      streamedUrl = urls.extractDeployedUrl(scanBuffer);
      if (scanBuffer.length > 50000) scanBuffer = scanBuffer.slice(-25000);
    }
  });

  const depResult = await dep.wait();
  mark('deploy.live.done', `exit=${depResult.code}`);

  if (depResult.code === 0) {
    const deployedUrl = streamedUrl || urls.extractDeployedUrl(dep.output());
    const dashboardUrl = urls.workerDashboardUrl(c.name);
    const lines = ['Deployed successfully.'];
    if (deployedUrl) lines.push('', `Live:       ${deployedUrl}`);
    if (dashboardUrl) lines.push(`Dashboard:  ${dashboardUrl}`);
    ui.note(lines.join('\n'), 'Success');
    return { ok: true, deployedUrl, dashboardUrl, name: c.name };
  }

  try { dryrun.invalidate(target); } catch { /* ignore */ }
  const out = dep.output();
  if (/not authenticated|not logged in|auth.*expired|\b401\b|unauthorized/i.test(out)) {
    try { auth.invalidate(); } catch { /* ignore */ }
  }

  ui.note(`Deploy failed (exit ${depResult.code}).`, 'Error');
  return { ok: false, phase: 'deploy', exit: depResult.code };
}