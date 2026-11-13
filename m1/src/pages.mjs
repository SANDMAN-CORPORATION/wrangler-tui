// Cloudflare Pages deployment.
// Distinct from Worker deployment: no wrangler.jsonc required,
// operates on a directory of static files.

import { spawnTask } from './supervisor.mjs';
import * as ui from './ui.mjs';
import * as auth from './auth.mjs';
import { resolveWranglerBinary } from './wrangler-bin.mjs';
import { mark } from './timing.mjs';
import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { readMarker } from './adopt.mjs';
import * as validate from './validate.mjs';
import * as urls from './urls.mjs';

// Checked in this order. First one containing an .html file wins.
const COMMON_BUILD_DIRS = ['dist', 'build', 'public', 'out', '.next', '.nuxt', '.svelte-kit'];

function isDirectory(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function containsHtml(dir) {
  try {
    return readdirSync(dir).some((e) => e.toLowerCase().endsWith('.html'));
  } catch { return false; }
}

/**
 * Detect the directory to deploy.
 *   explicitDir:  absolute or relative path to use verbatim
 *   baseDir:      where to scan for common build dirs when explicitDir is null
 * Returns absolute path or null.
 * Throws only when an explicitDir is invalid.
 */
export function detectDeployDirectory(explicitDir, baseDir = process.cwd()) {
  if (explicitDir) {
    const abs = resolve(explicitDir);
    if (!existsSync(abs)) throw new Error(`--dir does not exist: ${abs}`);
    if (!isDirectory(abs)) throw new Error(`--dir is not a directory: ${abs}`);
    return abs;
  }
  for (const name of COMMON_BUILD_DIRS) {
    const p = join(baseDir, name);
    if (isDirectory(p) && containsHtml(p)) return p;
  }
  if (existsSync(join(baseDir, 'index.html'))) return baseDir;
  return null;
}

/**
 * Detect a sensible default project name from package.json or directory.
 */
export function detectProjectName() {
  for (const p of [join(process.cwd(), 'package.json'), join(dirname(process.cwd()), 'package.json')]) {
    if (existsSync(p)) {
      try {
        const pkg = JSON.parse(readFileSync(p, 'utf8'));
        if (pkg.name && typeof pkg.name === 'string') {
          return pkg.name.replace(/^@[^/]+\//, '');
        }
      } catch { /* fall through */ }
    }
  }
  return basename(process.cwd());
}

async function defaultConfirm(expectedName) {
  const answer = await ui.prompts.text({
    message: `Type project name to confirm deploy (${expectedName}):`,
    placeholder: expectedName,
  });
  if (ui.isCancel(answer) || answer !== expectedName) return null;
  return answer;
}

async function ensureAuth(wr) {
  const st = await auth.status({ wranglerBin: wr.path });
  if (st.authenticated) {
    if (st.cached) {
  process.stderr.write(
    `\x1b[2m   auth: cached (verified ${ui.formatAge(st.ageMs)})\x1b[0m\n`
  );
}
    return { ok: true, email: st.email };
  }
  ui.note('Authentication required.', 'Auth');
  const r = await auth.ensure({ wranglerBin: wr.path, onOutput: (x) => ui.stream(x) });
  if (!r.ok) {
    ui.note(`Login failed: ${r.reason || 'exit ' + r.exit}`, 'Error');
    return { ok: false };
  }
  return { ok: true, email: r.email };
}

/**
 * Deploy a Pages project.
 * opts: { dir, name, branch, confirmFn }
 */
export async function deployFlow(opts = {}) {
  const wr = resolveWranglerBinary({});
  if (!wr.path) {
    ui.note(wr.error, 'Wrangler not found');
    return { ok: false, phase: 'wrangler-bin' };
  }

  const authResult = await ensureAuth(wr);
  if (!authResult.ok) return { ok: false, phase: 'auth' };

  // Determine where the marker lives and where assets are.
const markerRoot = opts.dir ? resolve(opts.dir) : process.cwd();
const marker = readMarker(markerRoot);

let deployDir = null;
if (opts.dir) {
  if (!existsSync(markerRoot)) {
    ui.note(`--dir does not exist: ${markerRoot}`, 'Deploy directory');
    return { ok: false, phase: 'dir' };
  }
  if (!isDirectory(markerRoot)) {
    ui.note(`--dir is not a directory: ${markerRoot}`, 'Deploy directory');
    return { ok: false, phase: 'dir' };
  }
  if (marker?.assetsDir) {
    deployDir = resolve(markerRoot, marker.assetsDir);
  } else {
    try {
      deployDir = detectDeployDirectory(null, markerRoot) || markerRoot;
    } catch (e) {
      ui.note(e.message, 'Deploy directory');
      return { ok: false, phase: 'dir' };
    }
  }
} else {
  if (marker?.assetsDir) {
    deployDir = resolve(markerRoot, marker.assetsDir);
  } else {
    try {
      deployDir = detectDeployDirectory(null, markerRoot);
    } catch (e) {
      ui.note(e.message, 'Deploy directory');
      return { ok: false, phase: 'dir' };
    }
  }
}
  if (!deployDir) {
    ui.note(
      'No deployable directory found.\n\n' +
      'Looked for: ' + COMMON_BUILD_DIRS.join(', ') + ',\n' +
      'or index.html in the current directory.\n\n' +
      'Pass an explicit directory:\n' +
      '  wrangler-tui pages deploy ./dist',
      'Deploy directory'
    );
    return { ok: false, phase: 'dir' };
  }

  // ── Pre-deploy validation ────────────────────────────────────
const validation = validate.validatePagesDeploy(deployDir);
if (!validate.render(validation, ui, 'Pages pre-deploy check')) {
  return { ok: false, phase: 'validation', errors: validation.errors };
}
  
  const defaultName = opts.name || marker?.projectName || detectProjectName();
let projectName = opts.name || marker?.projectName;
  if (!projectName) {
    projectName = await ui.prompts.text({
      message: 'Pages project name:',
      placeholder: defaultName,
      defaultValue: defaultName,
    });
    if (ui.isCancel(projectName) || !projectName) {
      ui.outro('Cancelled');
      return { ok: false, cancelled: true };
    }
  }

  let branch = opts.branch || marker?.branch;
  if (!branch) {
    branch = await ui.prompts.text({
      message: 'Branch (production URL uses this):',
      placeholder: 'main',
      defaultValue: 'main',
    });
    if (ui.isCancel(branch)) {
      ui.outro('Cancelled');
      return { ok: false, cancelled: true };
    }
  }

  const fileCount = (() => {
    try { return readdirSync(deployDir, { recursive: true }).length; }
    catch { return null; }
  })();

  ui.note(
    `Project:     ${projectName}\n` +
    `Directory:   ${deployDir}${fileCount != null ? `\nFiles:       ~${fileCount}` : ''}\n` +
    `Branch:      ${branch}\n` +
    `Account:     ${authResult.email || '(authenticated)'}\n\n` +
    `Note: Cloudflare Pages does not support dry-run.\n` +
    `Deployment begins immediately after confirmation.`,
    'Deployment target'
  );

  const confirmFn = opts.confirmFn || defaultConfirm;
  const confirmed = await confirmFn(projectName);
  if (!confirmed || confirmed !== projectName) {
    ui.note('Deploy cancelled (name did not match).', 'Cancelled');
    return { ok: false, cancelled: true };
  }

  ui.note('Deploying to Pages...', 'Starting');
  mark('pages.deploy.start');
  const dep = spawnTask(wr.path, [
    'pages', 'deploy', deployDir,
    '--project-name', projectName,
    '--branch', branch,
  ], {}).start();
  dep.on('data', (chunk) => ui.stream(chunk));
  const depResult = await dep.wait();
  mark('pages.deploy.done', `exit=${depResult.code}`);

  if (depResult.code === 0) {
  const deployedUrl = urls.extractDeployedUrl(dep.output());
  const dashboardUrl = urls.pagesDashboardUrl(projectName);
  const lines = ['Deployed successfully.'];
  if (deployedUrl) lines.push('', `Live:       ${deployedUrl}`);
  if (dashboardUrl) lines.push(`Dashboard:  ${dashboardUrl}`);
  ui.note(lines.join('\n'), 'Success');
  return { ok: true, deployedUrl, dashboardUrl, projectName };
}
  ui.note(`Deploy failed (exit ${depResult.code}).`, 'Error');
  return { ok: false, phase: 'deploy', exit: depResult.code };
}

/**
 * List Pages projects. Read-only.
 */
export async function listFlow() {
  const wr = resolveWranglerBinary({});
  if (!wr.path) {
    ui.note(wr.error, 'Wrangler not found');
    return { ok: false, phase: 'wrangler-bin' };
  }

  const authResult = await ensureAuth(wr);
  if (!authResult.ok) return { ok: false, phase: 'auth' };

  ui.note('Listing Pages projects...', 'Query');
  mark('pages.list.start');
  const t = spawnTask(wr.path, ['pages', 'project', 'list'], {}).start();
  t.on('data', (chunk) => ui.stream(chunk));
  const result = await t.wait();
  mark('pages.list.done', `exit=${result.code}`);

  if (result.code === 0) return { ok: true };
  ui.note(`Listing failed (exit ${result.code}).`, 'Error');
  return { ok: false, phase: 'list', exit: result.code };
}

/**
 * Create a Pages project (empty — no deployment).
 * opts: { name, branch, confirmFn }
 */
export async function createFlow(opts = {}) {
  const wr = resolveWranglerBinary({});
  if (!wr.path) {
    ui.note(wr.error, 'Wrangler not found');
    return { ok: false, phase: 'wrangler-bin' };
  }

  const authResult = await ensureAuth(wr);
  if (!authResult.ok) return { ok: false, phase: 'auth' };

  let name = opts.name;
  if (!name) {
    name = await ui.prompts.text({
      message: 'New Pages project name:',
      placeholder: 'my-site',
    });
    if (ui.isCancel(name) || !name) {
      ui.outro('Cancelled');
      return { ok: false, cancelled: true };
    }
  }

  let branch = opts.branch || marker?.branch;
  if (!branch) {
    branch = await ui.prompts.text({
      message: 'Production branch:',
      placeholder: 'main',
      defaultValue: 'main',
    });
    if (ui.isCancel(branch)) {
      ui.outro('Cancelled');
      return { ok: false, cancelled: true };
    }
  }

  ui.note(
    `Project:            ${name}\n` +
    `Production branch:  ${branch}\n\n` +
    `Creating empty project (no deployment yet)...`,
    'New Pages project'
  );

  mark('pages.create.start');
  const t = spawnTask(wr.path, [
    'pages', 'project', 'create', name,
    '--production-branch', branch,
  ], {}).start();
  t.on('data', (chunk) => ui.stream(chunk));
  const result = await t.wait();
  mark('pages.create.done', `exit=${result.code}`);

  if (result.code === 0) {
    ui.note(
      `Created ${name}.\n\n` +
      `Next:\n` +
      `  wrangler-tui pages deploy <dir> --name ${name}`,
      'Created'
    );
    return { ok: true };
  }
  ui.note(`Create failed (exit ${result.code}).`, 'Error');
  return { ok: false, phase: 'create', exit: result.code };
}

/**
 * Dispatch pages subcommand. Called from index.mjs.
 */
export async function dispatch(subcommand, opts = {}) {
  if (subcommand === 'list') return listFlow();
  if (subcommand === 'create') return createFlow({ name: opts.name, branch: opts.branch });
  if (subcommand === 'deploy' || subcommand === null) {
    return deployFlow({ dir: opts.dir, name: opts.name, branch: opts.branch });
  }
  ui.note(
    `Unknown pages subcommand: ${subcommand}\n\n` +
    `Usage:\n` +
    `  wrangler-tui pages deploy [<dir>]\n` +
    `  wrangler-tui pages list\n` +
    `  wrangler-tui pages create <name>`,
    'Error'
  );
  return { ok: false, phase: 'usage' };
}