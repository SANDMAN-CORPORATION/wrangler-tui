// Pre-deploy validation.
// Catches misconfigurations before spawning wrangler, so the user
// sees a specific problem instead of a 30-second wrangler error.

import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PAGES_ONLY_FILES = ['_worker.js', '_redirects', '_headers'];

function isDirectory(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function countFiles(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .length;
  } catch { return -1; }
}

function readAssetsIgnore(assetsDir) {
  const p = join(assetsDir, '.assetsignore');
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch { return []; }
}

/**
 * Validate a Worker deploy.
 *   target: { root, configPath, config }
 * Returns { ok, errors: [{ what, fix }], warnings: [{ what, fix }] }
 */
export function validateWorkerDeploy(target) {
  const errors = [];
  const warnings = [];
  const c = target.config || {};
  const root = target.root;

  if (!c.main && !(c.assets && c.assets.directory)) {
    errors.push({
      what: 'Config declares neither a Worker entry (main) nor static assets (assets.directory).',
      fix: 'Add one to wrangler.jsonc:\n' +
           '  "main": "src/index.js"                (Worker code)\n' +
           '  "assets": { "directory": "./dist" }  (static files)',
    });
    return { ok: false, errors, warnings };
  }

  if (c.main) {
    const mainPath = resolve(root, c.main);
    if (!existsSync(mainPath)) {
      errors.push({
        what: `Worker entry point not found: ${c.main}`,
        fix: `Either create ${c.main}, or remove "main" from wrangler.jsonc.`,
      });
    }
  }

  if (c.assets && c.assets.directory) {
    const assetsDir = resolve(root, c.assets.directory);
    if (!existsSync(assetsDir)) {
      errors.push({
        what: `Assets directory not found: ${c.assets.directory}`,
        fix: `Either build your assets so ${c.assets.directory} exists, or update the path in wrangler.jsonc.`,
      });
    } else if (!isDirectory(assetsDir)) {
      errors.push({
        what: `Assets path is not a directory: ${c.assets.directory}`,
        fix: 'Change assets.directory in wrangler.jsonc to point at a folder.',
      });
    } else {
      const fileCount = countFiles(assetsDir);
      if (fileCount === 0) {
        errors.push({
          what: `Assets directory is empty: ${c.assets.directory}`,
          fix: 'Build your site before deploying, or point assets.directory somewhere with files.',
        });
      } else {
        const ignored = readAssetsIgnore(assetsDir);
        const notIgnored = PAGES_ONLY_FILES.filter(
          (f) => existsSync(join(assetsDir, f)) && !ignored.includes(f)
        );
        if (notIgnored.length > 0) {
          warnings.push({
            what: `These files in ${c.assets.directory} will be uploaded and served publicly:\n  ${notIgnored.join('\n  ')}`,
            fix: 'These are Pages-specific — Workers does not interpret them.\n' +
                 '_worker.js will be served as a text file. _redirects and _headers are ignored.\n\n' +
                 `To exclude them from upload, add these lines to ${join(c.assets.directory, '.assetsignore')}:\n  ` +
                 notIgnored.join('\n  '),
          });
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Validate a Pages deploy.
 *   dir: absolute path to the deploy directory
 * Returns { ok, errors, warnings }
 */
export function validatePagesDeploy(dir) {
  const errors = [];
  const warnings = [];

  if (!existsSync(dir)) {
    errors.push({
      what: `Directory does not exist: ${dir}`,
      fix: 'Check the path and try again.',
    });
    return { ok: false, errors, warnings };
  }

  if (!isDirectory(dir)) {
    errors.push({
      what: `Path is not a directory: ${dir}`,
      fix: 'Point --dir at a folder containing your site.',
    });
    return { ok: false, errors, warnings };
  }

  const fileCount = countFiles(dir);
  if (fileCount === 0) {
    errors.push({
      what: `Directory is empty: ${dir}`,
      fix: 'Build your site before deploying.',
    });
    return { ok: false, errors, warnings };
  }

  if (existsSync(join(dir, '_worker.js'))) {
    warnings.push({
      what: '_worker.js found — it will run as a Pages Function.',
      fix: 'No action needed; this is the expected Pages behaviour.',
      severity: 'info',
    });
  }

  const functionsDir = join(dir, '..', 'functions');
  if (existsSync(functionsDir) && isDirectory(functionsDir)) {
    warnings.push({
      what: 'functions/ directory found alongside the deploy directory — Pages Functions will be uploaded.',
      fix: 'No action needed; this is expected.',
      severity: 'info',
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Render validation results to the user.
 * Returns true if deployment should proceed.
 */
export function render(result, ui, title = 'Pre-deploy check') {
  if (result.errors.length > 0) {
    ui.note(
      result.errors.map((e) =>
        `✗ ${e.what}\n\n  Fix:\n${e.fix.split('\n').map((l) => `    ${l}`).join('\n')}`
      ).join('\n\n'),
      `${title} — blocked`
    );
    return false;
  }

  const actionable = result.warnings.filter((w) => w.severity !== 'info');
  const informational = result.warnings.filter((w) => w.severity === 'info');

  if (actionable.length > 0) {
    ui.note(
      actionable.map((w) =>
        `⚠  ${w.what}\n\n  ${w.fix.split('\n').join('\n  ')}`
      ).join('\n\n'),
      `${title} — warnings`
    );
  }
  if (informational.length > 0) {
    ui.note(
      informational.map((w) => `ℹ  ${w.what}`).join('\n\n'),
      `${title} — notes`
    );
  }
  return true;
}