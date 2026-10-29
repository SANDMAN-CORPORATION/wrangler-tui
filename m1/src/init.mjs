import { mkdirSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute, dirname, basename, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as ui from './ui.mjs';
import { spawnTask } from './supervisor.mjs';
import { mark } from './timing.mjs';

const SELF_FILE = fileURLToPath(import.meta.url);
const SELF_SRC  = dirname(SELF_FILE);
const SELF_M1   = dirname(SELF_SRC);
const SELF_REPO = dirname(SELF_M1);

const CONFIG_FILES = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];
const DEFAULT_SUGGESTION = join(homedir(), 'projects', 'my-worker');

const MINIMAL_CONFIG = `{
  "name": "__NAME__",
  "main": "src/index.js",
  "compatibility_date": "__DATE__"
}
`;
const MINIMAL_INDEX = `export default {
  async fetch(request) {
    return new Response("Hello from __NAME__!");
  }
};
`;
const MINIMAL_PKG = `{
  "name": "__NAME__",
  "type": "module",
  "private": true
}
`;

function isInside(child, parent) {
  const c = resolve(child);
  const p = resolve(parent);
  if (c === p) return true;
  const prefix = p.endsWith(sep) ? p : p + sep;
  return c.startsWith(prefix);
}

function resolveDestination(input) {
  if (isAbsolute(input)) return resolve(input);
  return resolve(join(process.cwd(), input));
}

export async function flow({ prefillDir } = {}) {
  const suggestion = prefillDir || DEFAULT_SUGGESTION;

  mark('init.start');
  const input = await ui.prompts.text({
    message: 'Destination directory (absolute, or relative to cwd):',
    placeholder: suggestion,
    defaultValue: suggestion,
  });
  if (ui.isCancel(input)) return { ok: false, cancelled: true };

  const dest = resolveDestination(input);

  if (dest === SELF_REPO || dest === SELF_M1 || isInside(dest, join(SELF_REPO, 'm0'))) {
    ui.note(
      `Destination resolves into the wrangler-tui source tree:\n  ${dest}\n\n` +
      `Choose a location outside the repo, e.g. ~/projects/<name>.`,
      'Invalid destination'
    );
    return { ok: false, cancelled: true };
  }

  if (isInside(dest, SELF_REPO)) {
    ui.note(
      `Destination is inside the wrangler-tui repository:\n  ${dest}\n\n` +
      `Recommended: ~/projects/<name>`,
      'Destination warning'
    );
    const cont = await ui.prompts.confirm({
      message: 'Create here anyway?',
      initialValue: false,
    });
    if (ui.isCancel(cont) || !cont) return { ok: false, cancelled: true };
  }

  if (existsSync(dest) && statSync(dest).isDirectory() && readdirSync(dest).length > 0) {
    const cont = await ui.prompts.confirm({
      message: `${dest} exists and is not empty. Continue anyway?`,
      initialValue: false,
    });
    if (ui.isCancel(cont) || !cont) return { ok: false, cancelled: true };
  }

  const name = await ui.prompts.text({
    message: 'Worker name:',
    placeholder: basename(dest),
    defaultValue: basename(dest),
  });
  if (ui.isCancel(name)) return { ok: false, cancelled: true };

  const template = await ui.prompts.select({
    message: 'Template?',
    options: [
      { value: 'minimal', label: 'Minimal (offline, fast, agent-generated scaffold)' },
      { value: 'cf-create', label: 'Official Cloudflare template (npx create-cloudflare@latest)' },
    ],
  });
  if (ui.isCancel(template)) return { ok: false, cancelled: true };

  mark('init.prompts.done', `template=${template}`);

  if (template === 'cf-create') return runCfwCreate(dest, name);

  mark('init.scaffold.start');
  const result = scaffoldMinimal(dest, name);
  mark('init.scaffold.done');
  return result;
}

function scaffoldMinimal(destDir, name) {
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(join(destDir, 'src'), { recursive: true });
  writeFileSync(join(destDir, 'wrangler.jsonc'), MINIMAL_CONFIG.replace(/__NAME__/g, name).replace(/__DATE__/g, date));
  writeFileSync(join(destDir, 'src', 'index.js'), MINIMAL_INDEX.replace(/__NAME__/g, name));
  writeFileSync(join(destDir, 'package.json'), MINIMAL_PKG.replace(/__NAME__/g, name));
  ui.note(
    `Created at ${destDir}\n\n` +
    `Next (from any directory):\n` +
    `  wrangler-tui deploy --dir ${destDir}`,
    'Project created'
  );
  return { ok: true, dir: destDir };
}

async function runCfwCreate(destDir, name) {
  const parent = dirname(destDir);
  const projectName = basename(destDir);
  mkdirSync(parent, { recursive: true });

  if (existsSync(destDir) && readdirSync(destDir).length > 0) {
    const cont = await ui.prompts.confirm({
      message: `${destDir} already exists and is not empty.\n` +
               `create-cloudflare may refuse to overwrite it.\n` +
               `Delete it first or choose a different destination. Continue anyway?`,
      initialValue: false,
    });
    if (ui.isCancel(cont) || !cont) return { ok: false, cancelled: true };
  }

  ui.note(
    `Running: npx -y create-cloudflare@latest ${projectName}\n` +
    `Working directory: ${parent}\n\n` +
    `Some templates attempt to start a local dev server. On Termux/PRoot\n` +
    `that cannot run (workerd/PRoot VA limit). If it hangs, press Ctrl-C\n` +
    `after scaffolding completes.`,
    'Official Cloudflare template'
  );

  mark('init.cf-create.start');
  const t = spawnTask('npx', ['-y', 'create-cloudflare@latest', projectName], {
    cwd: parent,
    stdio: 'inherit',
  }).start();
  const { code } = await t.wait();
  mark('init.cf-create.done', `exit=${code}`);

  if (code !== 0) {
    return { ok: false, phase: 'cf-create', exit: code };
  }

  const created = CONFIG_FILES.some((n) => existsSync(join(destDir, n)));
  if (!created) {
    return {
      ok: false,
      phase: 'cf-create',
      reason: `create-cloudflare exited 0 but no wrangler config found at ${destDir}. ` +
              `Was the interactive prompt cancelled?`,
    };
  }

  ui.note(
    `Created at ${destDir}\n\n` +
    `Next (from any directory):\n` +
    `  wrangler-tui deploy --dir ${destDir}`,
    'Project created'
  );
  return { ok: true, dir: destDir };
}