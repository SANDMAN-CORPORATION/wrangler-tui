// Declare an existing directory as Cloudflare-deployable, without templates.
//
// Uses shape detection (shape.mjs) to determine what the directory actually
// contains, then either:
//   • Blocks with the exact fix for unsupported frameworks
//     (Next.js without adapter, SvelteKit without adapter, etc.)
//   • Reports "already deployable" for existing Wrangler projects
//   • Guides the user through a minimal, informed adoption choice
//
// worker-assets: writes wrangler.jsonc with assets.directory (merges if exists)
// pages:         writes .wrangler-tui.json marker (Pages needs no config)

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as jsonc from 'jsonc-parser';
import * as ui from './ui.mjs';
import { detectDeployDirectory, detectProjectName } from './pages.mjs';
import { detectShape, shapeLabel } from './shape.mjs';

const MARKER = '.wrangler-tui.json';
const PAGES_MIGRATION_FILES = ['_worker.js', '_redirects', '_headers'];

// ── marker and file helpers ───────────────────────────────────────

export function readMarker(root = process.cwd()) {
  const p = join(root, MARKER);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toRelativeDir(root, abs) {
  const rel = relative(root, abs) || '.';
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function renderBlockers(blockers) {
  return blockers.map((b) =>
    `✗ ${b.what}\n\n  Fix:\n${b.fix.split('\n').map((l) => `    ${l}`).join('\n')}`
    + (b.url ? `\n\n  Docs: ${b.url}` : '')
  ).join('\n\n');
}

// ── config writers ────────────────────────────────────────────────

/**
 * Build the wrangler config object for a static-assets Worker.
 */
export function buildWorkerConfig({ root, name, assetsDir, preset, basePath }) {
  const assets = { directory: toRelativeDir(root, assetsDir) };
  if (preset === 'spa') assets.not_found_handling = 'single-page-application';
  if (basePath) assets.base_path = basePath;

  const cfg = { name, compatibility_date: today(), assets };

  // $schema only resolves when wrangler is installed locally. In our
  // environment wrangler is global, so pointing at a missing file would
  // mislead editors.
  const schema = join(root, 'node_modules', 'wrangler', 'config-schema.json');
  if (existsSync(schema)) {
    cfg.$schema = './node_modules/wrangler/config-schema.json';
  }
  return cfg;
}

/**
 * Write or merge wrangler.jsonc. Preserves existing keys and comments.
 * Returns { path, action } where action ∈ 'created' | 'merged' | 'unchanged'.
 */
export function applyWorkerConfig({ root, config }) {
  const path = join(root, 'wrangler.jsonc');

  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
    return { path, action: 'created' };
  }

  const text = readFileSync(path, 'utf8');
  const existing = jsonc.parse(text, [], { allowTrailingComma: true }) || {};

  if (existing.assets && existing.assets.directory) {
    return { path, action: 'unchanged' };
  }

  // Insert only the assets key; leave name/compat/main and comments intact.
  let updated = text;
  const assetsEdit = jsonc.modify(updated, ['assets'], config.assets, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
  updated = jsonc.applyEdits(updated, assetsEdit);

  if (!existing.name && config.name) {
    const nameEdit = jsonc.modify(updated, ['name'], config.name, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
    updated = jsonc.applyEdits(updated, nameEdit);
  }
  if (!existing.compatibility_date && config.compatibility_date) {
    const dateEdit = jsonc.modify(updated, ['compatibility_date'], config.compatibility_date, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
    updated = jsonc.applyEdits(updated, dateEdit);
  }

  writeFileSync(path, updated);
  return { path, action: 'merged' };
}

/**
 * Write .assetsignore if the assets dir contains Pages-era control files.
 * Per Cloudflare docs these must not be uploaded as public assets.
 */
export function applyAssetsIgnore({ assetsDir }) {
  const present = PAGES_MIGRATION_FILES.filter((f) => existsSync(join(assetsDir, f)));
  if (present.length === 0) return { action: 'none', path: null, entries: [] };

  const path = join(assetsDir, '.assetsignore');
  if (existsSync(path)) return { action: 'unchanged', path, entries: present };

  writeFileSync(path, present.join('\n') + '\n');
  return { action: 'created', path, entries: present };
}

export function applyPagesMarker({ root, projectName, assetsDir, branch }) {
  const path = join(root, MARKER);
  const data = {
    target: 'pages',
    projectName,
    assetsDir: toRelativeDir(root, assetsDir),
    branch: branch || 'main',
    createdAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  return { path, action: 'created' };
}

// ── flow (shape-aware) ────────────────────────────────────────────

export async function flow(opts = {}) {
  const root = resolve(opts.dir || process.cwd());

  // ── Step 1: shape detection ──────────────────────────────────
  const shape = detectShape(root);
  if (shape.evidence.length > 0) {
    ui.note(
      shape.evidence.map((e) => `• ${e}`).join('\n'),
      `Detected: ${shapeLabel(shape.shape)}`
    );
  }

  // ── Step 2: blocked? ─────────────────────────────────────────
  if (shape.blockers.length > 0) {
    ui.note(renderBlockers(shape.blockers), 'Cannot adopt');
    return { ok: false, phase: 'blocked', shape };
  }

  // ── Step 3: already deployable? ──────────────────────────────
  if (shape.deployTarget === 'already-worker') {
    ui.note(
      'This directory is already a Wrangler project.\n\n' +
      'No adoption needed. Run:\n  wrangler-tui deploy',
      'Already deployable'
    );
    return { ok: false, phase: 'already-deployable', shape };
  }

  // ── Step 4: resolve assets directory ─────────────────────────
  let assetsDir;
  try {
    if (opts.assetsDir) {
      assetsDir = detectDeployDirectory(opts.assetsDir, root);
    } else if (shape.outputDir === '.' || shape.outputDir === './') {
      assetsDir = root;
    } else if (shape.outputDir) {
      assetsDir = resolve(root, shape.outputDir);
    } else {
      assetsDir = detectDeployDirectory(null, root);
    }
  } catch (e) {
    ui.note(e.message, 'Assets directory');
    return { ok: false, phase: 'assets-dir' };
  }
  if (!assetsDir) {
    ui.note(
      'No directory of static assets found.\n\n' +
      'Looked for: dist, build, public, out, .next, .nuxt, .svelte-kit,\n' +
      'or index.html in the current directory.\n\n' +
      'Pass one explicitly:\n' +
      '  wrangler-tui adopt --assets-dir ./dist',
      'Assets directory'
    );
    return { ok: false, phase: 'assets-dir' };
  }

  // ── Step 5: target ───────────────────────────────────────────
  let target = opts.target;

  // Explicit --target must not conflict with a shape that only supports one.
  if (target && shape.deployTarget && target !== shape.deployTarget) {
    ui.note(
      `This directory can only be deployed as ${shape.deployTarget}.\n` +
      `You passed --target ${target}.`,
      'Target conflict'
    );
    return { ok: false, phase: 'target-conflict', shape };
  }

  if (!target) {
    if (shape.deployTarget) {
      // Shape knows the only valid target (e.g. pages-functions → pages).
      target = shape.deployTarget;
      const opt = shape.options.find((o) => o.target === target);
      ui.note(
        `Using ${opt?.label || target}` +
        (opt?.description ? `\n\n${opt.description}` : ''),
        'Target (from detection)'
      );
    } else if (shape.options.length === 1) {
      target = shape.options[0].target;
      ui.note(
        `Using ${shape.options[0].label}\n\n${shape.options[0].description}`,
        'Target (from detection)'
      );
    } else if (shape.options.length > 1) {
      ui.note(
        'Cloudflare has two ways to host a static site:\n\n' +
        '  Workers static assets\n' +
        '    Runs on Cloudflare Workers. URL: my-worker.<subdomain>.workers.dev\n' +
        '    Writes wrangler.jsonc to the project.\n\n' +
        '  Cloudflare Pages\n' +
        '    Dedicated static-hosting product. URL: my-site.pages.dev\n' +
        '    No config file needed.\n\n' +
        'Both are free.',
        'Choosing a hosting type'
      );
      target = await ui.prompts.select({
        message: 'How should this directory be deployed?',
        options: shape.options.map((o) => ({
          value: o.target,
          label: o.label,
          hint: o.description,
        })),
      });
      if (ui.isCancel(target)) { ui.outro('Cancelled'); return { ok: false, cancelled: true }; }
    } else {
      ui.note('No deployment options available for this directory.', 'Error');
      return { ok: false, phase: 'no-options', shape };
    }
  }

  if (!['worker-assets', 'pages'].includes(target)) {
    ui.note(`Unknown target: ${target}\nExpected: worker-assets or pages`, 'Error');
    return { ok: false, phase: 'target' };
  }

  // ── Step 6: preset (Worker assets only) ──────────────────────
  let preset = opts.preset;
  if (target === 'worker-assets' && !preset) {
    if (shape.recommendedPreset) {
      preset = shape.recommendedPreset;
      ui.note(
        `Routing: ${preset}\n\n${shape.presetReason || ''}`,
        'Preset (from detection)'
      );
    } else {
      ui.note(
        'How should unknown URL paths be handled?\n\n' +
        '  Static site\n' +
        '    Serve the exact file at the URL.\n' +
        '    /about.html → about.html\n' +
        '    /about      → 404\n\n' +
        '  Single-page app\n' +
        '    Serve index.html for any unknown path.\n' +
        '    /anywhere   → index.html\n' +
        '    Common for React / Vue / Svelte apps.',
        'How should URLs resolve?'
      );
      preset = await ui.prompts.select({
        message: 'Routing preset?',
        options: [
          { value: 'static', label: 'Static site', hint: 'one HTML file per URL' },
          { value: 'spa', label: 'Single-page app', hint: 'all unknown paths → index.html' },
        ],
      });
      if (ui.isCancel(preset)) { ui.outro('Cancelled'); return { ok: false, cancelled: true }; }
    }
  }

  // ── Step 7: name ─────────────────────────────────────────────
  const defaultName = opts.name || detectProjectName();
  let name = opts.name;
  if (!name) {
    name = await ui.prompts.text({
      message: target === 'pages' ? 'Pages project name:' : 'Worker name:',
      placeholder: defaultName,
      defaultValue: defaultName,
    });
    if (ui.isCancel(name) || !name) { ui.outro('Cancelled'); return { ok: false, cancelled: true }; }
  }

  // ── Step 8: branch (Pages only) ──────────────────────────────
  let branch = opts.branch;
  if (target === 'pages' && !branch) {
    branch = await ui.prompts.text({
      message: 'Production branch:',
      placeholder: 'main',
      defaultValue: 'main',
    });
    if (ui.isCancel(branch)) { ui.outro('Cancelled'); return { ok: false, cancelled: true }; }
  }

  // ── Step 9: preview and write ────────────────────────────────
  const fileCount = (() => {
    try { return readdirSync(assetsDir).length; } catch { return 0; }
  })();

  ui.note(
    `Target:     ${target}\n` +
    `Directory:  ${assetsDir}\n` +
    `Files:      ${fileCount}\n` +
    `Name:       ${name}` +
    (target === 'worker-assets' ? `\nPreset:     ${preset}` : `\nBranch:     ${branch || 'main'}`) +
    (opts.basePath ? `\nBase path:  ${opts.basePath}` : ''),
    'Adopting directory'
  );

  const written = [];

  if (target === 'worker-assets') {
    const config = buildWorkerConfig({ root, name, assetsDir, preset, basePath: opts.basePath });
    const r = applyWorkerConfig({ root, config });
    written.push(`${r.action}: ${r.path}`);

    const ign = applyAssetsIgnore({ assetsDir });
    if (ign.action === 'created') written.push(`created: ${ign.path} (${ign.entries.join(', ')})`);
    else if (ign.action === 'unchanged') written.push(`unchanged: ${ign.path}`);

    ui.note(
      `Config:\n  ${r.path} (${r.action})` +
      (ign.action !== 'none' && ign.path
        ? `\nAssets ignore:\n  ${ign.path} (${ign.action})`
        : '') +
      `\n\nDirectory is now deployable.\n\n` +
      `Next:\n  wrangler-tui deploy --dir ${root}`,
      'Done'
    );
  } else {
    const r = applyPagesMarker({ root, projectName: name, assetsDir, branch: branch || 'main' });
    written.push(`${r.action}: ${r.path}`);

    ui.note(
      `Marker:\n  ${r.path}\n\n` +
      `Directory is now deployable.\n\n` +
      `Next:\n  wrangler-tui pages deploy --dir ${root}\n\n` +
      `The project name and branch are remembered; no prompts on deploy.`,
      'Done'
    );
  }

  return { ok: true, target, assetsDir, name, written, shape };
}