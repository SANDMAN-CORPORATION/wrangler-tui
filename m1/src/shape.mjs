// Project shape detection.
// Returns a structured description of what this directory contains
// and how (or whether) it can be deployed to Cloudflare.

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as jsonc from 'jsonc-parser';
import * as toml from 'smol-toml';

const WRANGLER_CONFIGS = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];
const FRAMEWORK_CONFIGS = [
  { pattern: /^next\.config\.(js|mjs|ts)$/, shape: 'nextjs' },
  { pattern: /^svelte\.config\.(js|mjs)$/, shape: 'sveltekit' },
  { pattern: /^nuxt\.config\.(js|mjs|ts)$/, shape: 'nuxt' },
  { pattern: /^vite\.config\.(js|mjs|ts)$/, shape: 'vite' },
  { pattern: /^astro\.config\.(js|mjs|ts)$/, shape: 'astro' },
  { pattern: /^remix\.config\.(js|mjs)$/, shape: 'remix' },
];

const SHAPE_LABELS = {
  'worker-full': 'Existing Worker project',
  'worker-assets-only': 'Worker with static assets (no main)',
  'worker-incomplete': 'Incomplete wrangler configuration',
  'worker-invalid': 'Unparseable wrangler configuration',
  'plain-static': 'Plain static site',
  'vite': 'Vite project',
  'astro': 'Astro project',
  'nextjs': 'Next.js project',
  'sveltekit': 'SvelteKit project',
  'nuxt': 'Nuxt project',
  'remix': 'Remix project',
  'built-dist': 'Built output (dist/ with no framework markers)',
  'pages-functions': 'Pages Functions',
  'empty': 'Empty directory',
  'unknown': 'Unrecognized project',
};

export function shapeLabel(s) { return SHAPE_LABELS[s] || s; }

function isDirectory(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function readPackageJson(dir) {
  const p = join(dir, 'package.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function parseWranglerConfig(dir, filename) {
  const p = join(dir, filename);
  const raw = readFileSync(p, 'utf8');
  if (filename.endsWith('.toml')) return toml.parse(raw);
  const errors = [];
  const result = jsonc.parse(raw, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`JSONC errors: ${JSON.stringify(errors)}`);
  return result;
}

/**
 * Detect the shape of a project directory.
 * Returns { shape, root, evidence, deployable, deployTarget, outputDir,
 *           recommendedPreset, presetReason, blockers, options }
 */
export function detectShape(dir) {
  const root = resolve(dir);
  const evidence = [];

  // Priority 1: Existing wrangler config
  for (const name of WRANGLER_CONFIGS) {
    if (existsSync(join(root, name))) {
      evidence.push(`${name} found`);
      let config;
      try {
        config = parseWranglerConfig(root, name);
      } catch (e) {
        evidence.push(`but could not parse: ${e.message}`);
        return {
          shape: 'worker-invalid', root, evidence,
          deployable: false, deployTarget: null, outputDir: null,
          recommendedPreset: null, presetReason: null,
          blockers: [{
            what: `${name} exists but could not be parsed.`,
            fix: `Fix the syntax error in ${name}, then re-run.`,
          }],
          options: [],
        };
      }
      const hasMain = !!config.main;
      const hasAssets = !!(config.assets && config.assets.directory);
      if (hasMain && hasAssets) {
        evidence.push('config has both "main" and "assets.directory"');
        return { shape: 'worker-full', root, evidence, deployable: true, deployTarget: 'already-worker', outputDir: null, recommendedPreset: null, presetReason: null, blockers: [], options: [] };
      }
      if (hasMain) {
        evidence.push('config has "main" but no "assets.directory"');
        return { shape: 'worker-full', root, evidence, deployable: true, deployTarget: 'already-worker', outputDir: null, recommendedPreset: null, presetReason: null, blockers: [], options: [] };
      }
      if (hasAssets) {
        evidence.push('config has "assets.directory" (assets-only Worker)');
        return { shape: 'worker-assets-only', root, evidence, deployable: true, deployTarget: 'already-worker', outputDir: config.assets.directory, recommendedPreset: null, presetReason: null, blockers: [], options: [] };
      }
      evidence.push('config has neither "main" nor "assets.directory"');
      return {
        shape: 'worker-incomplete', root, evidence,
        deployable: false, deployTarget: null, outputDir: null,
        recommendedPreset: null, presetReason: null,
        blockers: [{
          what: `${name} exists but declares neither a Worker entry (main) nor static assets (assets.directory).`,
          fix: 'Add one of:\n  "main": "src/index.js"                (for Worker code)\n  "assets": { "directory": "./dist" }  (for static assets)',
        }],
        options: [],
      };
    }
  }

  // Priority 2: Framework configs
  let files = [];
  try { files = readdirSync(root); } catch { /* ignore */ }
  for (const fw of FRAMEWORK_CONFIGS) {
    for (const f of files) {
      if (fw.pattern.test(f)) {
        evidence.push(`${f} found`);
        return detectFramework(root, fw.shape, evidence);
      }
    }
  }

  // Priority 3: dist/ with no framework markers
  if (existsSync(join(root, 'dist', 'index.html'))) {
    evidence.push('dist/index.html found');
    evidence.push('no framework config detected');
    return {
      shape: 'built-dist', root, evidence,
      deployable: true, deployTarget: null, outputDir: './dist',
      recommendedPreset: 'static',
      presetReason: 'No client-side router detected. Files will be served as-is.',
      blockers: [],
      options: [
        { target: 'worker-assets', preset: 'static', label: 'Workers static assets', description: 'Serves dist/ from Cloudflare Workers' },
        { target: 'pages', label: 'Cloudflare Pages', description: 'Serves dist/ from Cloudflare Pages' },
      ],
    };
  }

  // Priority 4: Pages Functions
  if (isDirectory(join(root, 'functions'))) {
    evidence.push('functions/ directory found');
    return {
      shape: 'pages-functions', root, evidence,
      deployable: true, deployTarget: 'pages', outputDir: '.',
      recommendedPreset: null, presetReason: null,
      blockers: [],
      options: [
        { target: 'pages', label: 'Cloudflare Pages', description: 'Required for functions/ — Workers assets cannot deploy Pages Functions' },
      ],
    };
  }

  // Priority 5: Plain static
  if (existsSync(join(root, 'index.html'))) {
    evidence.push('index.html found at root');
    evidence.push('no framework config detected');
    return {
      shape: 'plain-static', root, evidence,
      deployable: true, deployTarget: null, outputDir: '.',
      recommendedPreset: null, presetReason: null,
      blockers: [],
      options: [
        { target: 'worker-assets', preset: 'static', label: 'Workers static assets', description: 'Serves index.html and siblings from Workers' },
        { target: 'pages', label: 'Cloudflare Pages', description: 'Serves index.html from Pages' },
      ],
    };
  }

  // Priority 6: Empty
  const visible = files.filter((f) => !f.startsWith('.'));
  if (visible.length === 0) {
    return {
      shape: 'empty', root, evidence,
      deployable: false, deployTarget: null, outputDir: null,
      recommendedPreset: null, presetReason: null,
      blockers: [{
        what: 'Directory is empty.',
        fix: 'Nothing to deploy. If you meant a subdirectory, pass --assets-dir <path>.',
      }],
      options: [],
    };
  }

  return {
    shape: 'unknown', root, evidence,
    deployable: false, deployTarget: null, outputDir: null,
    recommendedPreset: null, presetReason: null,
    blockers: [{
      what: `No recognizable web project detected (${visible.length} files found).`,
      fix: 'Looked for:\n' +
           '  index.html, dist/index.html   (static content)\n' +
           '  next.config.*, vite.config.*, astro.config.*, svelte.config.*, nuxt.config.*, remix.config.*  (frameworks)\n' +
           '  wrangler.jsonc                (existing Worker project)\n\n' +
           'If your deployable assets are in a subdirectory, pass:\n' +
           '  wrangler-tui adopt --assets-dir <path>',
    }],
    options: [],
  };
}

function detectFramework(root, shape, evidence) {
  const pkg = readPackageJson(root);

  if (shape === 'vite' || shape === 'astro') {
    if (existsSync(join(root, 'dist', 'index.html'))) {
      evidence.push('dist/index.html found');
      const preset = shape === 'astro' ? 'static' : 'spa';
      const presetReason = shape === 'astro'
        ? 'Astro produces one HTML file per route — static routing'
        : 'Vite projects usually use client-side routing — SPA fallback recommended';
      return {
        shape, root, evidence,
        deployable: true, deployTarget: null, outputDir: './dist',
        recommendedPreset: preset, presetReason,
        blockers: [],
        options: [
          { target: 'worker-assets', preset, label: 'Workers static assets', description: `Deploys ./dist as a Worker` },
          { target: 'pages', label: 'Cloudflare Pages', description: `Deploys ./dist as Pages` },
        ],
      };
    }
    return {
      shape, root, evidence,
      deployable: false, deployTarget: null, outputDir: null,
      recommendedPreset: null, presetReason: null,
      blockers: [{
        what: `${shapeLabel(shape)} detected, but dist/ does not exist yet.`,
        fix: 'Run `npm run build` first, then re-run this command.',
      }],
      options: [],
    };
  }

  if (shape === 'nextjs') {
    if (existsSync(join(root, 'out', 'index.html'))) {
      evidence.push('out/index.html found (static export)');
      return {
        shape, root, evidence,
        deployable: true, deployTarget: null, outputDir: './out',
        recommendedPreset: 'static',
        presetReason: 'Next.js static export — each route has its own HTML file',
        blockers: [],
        options: [
          { target: 'worker-assets', preset: 'static', label: 'Workers static assets', description: 'Deploys ./out as a Worker' },
          { target: 'pages', label: 'Cloudflare Pages', description: 'Deploys ./out as Pages' },
        ],
      };
    }
    return {
      shape, root, evidence,
      deployable: false, deployTarget: null, outputDir: null,
      recommendedPreset: null, presetReason: null,
      blockers: [{
        what: 'Next.js detected. Cloudflare requires an adapter for non-static Next.js apps.',
        fix: 'Either:\n' +
             '  A) Install the adapter:\n' +
             '       npm install @opennextjs/cloudflare\n' +
             '       Follow: https://opennext.js.org/cloudflare/get-started\n\n' +
             '  B) Export as static site:\n' +
             '       Add to next.config.js:  output: "export"\n' +
             '       Run: npm run build\n' +
             '       Then re-run — out/ will be detected automatically.',
        url: 'https://opennext.js.org/cloudflare',
      }],
      options: [],
    };
  }

  if (shape === 'sveltekit') {
    const hasCf = !!(pkg?.devDependencies?.['@sveltejs/adapter-cloudflare']
                  || pkg?.dependencies?.['@sveltejs/adapter-cloudflare']);
    const hasStatic = !!(pkg?.devDependencies?.['@sveltejs/adapter-static']
                      || pkg?.dependencies?.['@sveltejs/adapter-static']);
    if (hasCf && existsSync(join(root, '.svelte-kit', 'cloudflare'))) {
      evidence.push('@sveltejs/adapter-cloudflare installed');
      evidence.push('.svelte-kit/cloudflare/ found');
      return {
        shape, root, evidence,
        deployable: true, deployTarget: 'pages', outputDir: './.svelte-kit/cloudflare',
        recommendedPreset: null, presetReason: null,
        blockers: [],
        options: [
          { target: 'pages', label: 'Cloudflare Pages', description: 'SvelteKit with adapter-cloudflare deploys to Pages' },
        ],
      };
    }
    if (hasStatic && existsSync(join(root, 'build', 'index.html'))) {
      evidence.push('@sveltejs/adapter-static installed');
      evidence.push('build/index.html found');
      return {
        shape, root, evidence,
        deployable: true, deployTarget: null, outputDir: './build',
        recommendedPreset: 'static',
        presetReason: 'Static adapter produces one HTML file per route',
        blockers: [],
        options: [
          { target: 'worker-assets', preset: 'static', label: 'Workers static assets', description: 'Deploys ./build as a Worker' },
          { target: 'pages', label: 'Cloudflare Pages', description: 'Deploys ./build as Pages' },
        ],
      };
    }
    return {
      shape, root, evidence,
      deployable: false, deployTarget: null, outputDir: null,
      recommendedPreset: null, presetReason: null,
      blockers: [{
        what: 'SvelteKit detected. Cloudflare requires a Cloudflare-compatible adapter.',
        fix: 'Install @sveltejs/adapter-cloudflare:\n' +
             '  npm install -D @sveltejs/adapter-cloudflare\n' +
             'Configure it in svelte.config.js, then run npm run build.\n' +
             'See: https://kit.svelte.dev/docs/adapter-cloudflare',
        url: 'https://kit.svelte.dev/docs/adapter-cloudflare',
      }],
      options: [],
    };
  }

  if (shape === 'nuxt') {
    if (existsSync(join(root, '.output', 'public', 'index.html'))) {
      evidence.push('.output/public/index.html found');
      return {
        shape, root, evidence,
        deployable: true, deployTarget: 'pages', outputDir: './.output/public',
        recommendedPreset: null, presetReason: null,
        blockers: [],
        options: [
          { target: 'pages', label: 'Cloudflare Pages', description: 'Deploys Nuxt .output/public as Pages' },
        ],
      };
    }
    return {
      shape, root, evidence,
      deployable: false, deployTarget: null, outputDir: null,
      recommendedPreset: null, presetReason: null,
      blockers: [{
        what: 'Nuxt detected. Cloudflare requires the Cloudflare Nitro preset.',
        fix: 'Build with the Cloudflare preset:\n' +
             '  NITRO_PRESET=cloudflare-pages npm run build\n' +
             'Then re-run — .output/public will be detected automatically.',
        url: 'https://nitro.build/deploy/providers/cloudflare',
      }],
      options: [],
    };
  }

  if (shape === 'remix') {
    return {
      shape, root, evidence,
      deployable: false, deployTarget: null, outputDir: null,
      recommendedPreset: null, presetReason: null,
      blockers: [{
        what: 'Remix detected. Cloudflare requires @remix-run/cloudflare.',
        fix: 'Follow the Remix + Cloudflare guide:\n' +
             '  https://developers.cloudflare.com/pages/framework-guides/deploy-a-remix-site/',
        url: 'https://developers.cloudflare.com/pages/framework-guides/deploy-a-remix-site/',
      }],
      options: [],
    };
  }

  return {
    shape, root, evidence,
    deployable: false, deployTarget: null, outputDir: null,
    recommendedPreset: null, presetReason: null,
    blockers: [{ what: `${shapeLabel(shape)} detected, but no deployable output found.`, fix: 'Build the project first, then re-run.' }],
    options: [],
  };
}