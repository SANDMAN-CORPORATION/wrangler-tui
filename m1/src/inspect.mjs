// Read-only inspection: what does wrangler-tui see in this directory?
// Does not mutate anything. Safe to run anywhere.

import { resolve } from 'node:path';
import * as ui from './ui.mjs';
import { detectShape, shapeLabel } from './shape.mjs';

export async function flow(opts = {}) {
  const root = resolve(opts.dir || process.cwd());
  ui.intro('inspect');

  const shape = detectShape(root);

  ui.note(
    `Directory: ${root}\n` +
    `Detected:  ${shapeLabel(shape.shape)}` +
    (shape.evidence.length
      ? `\n\nEvidence:\n${shape.evidence.map((e) => `  • ${e}`).join('\n')}`
      : ''),
    'Analysis'
  );

  if (shape.blockers.length > 0) {
    ui.note(
      shape.blockers.map((b) =>
        `✗ ${b.what}\n\n  Fix:\n${b.fix.split('\n').map((l) => `    ${l}`).join('\n')}`
        + (b.url ? `\n\n  Docs: ${b.url}` : '')
      ).join('\n\n'),
      'Blockers'
    );
    ui.outro('Cannot be deployed as-is');
    return 1;
  }

  if (shape.deployTarget === 'already-worker') {
    ui.note(
      'This directory is already a Wrangler project.\n\n' +
      'No adoption needed. Run:\n  wrangler-tui deploy',
      'Ready to deploy'
    );
    ui.outro('Ready');
    return 0;
  }

  if (shape.options.length > 0) {
    const rec = shape.recommendedPreset
      ? `\n\nRecommended routing: ${shape.recommendedPreset}\n  ${shape.presetReason}`
      : '';
    ui.note(
      `Output directory: ${shape.outputDir || '(current directory)'}\n\n` +
      `Deployment options:\n` +
      shape.options.map((o) => `  • ${o.label}\n    ${o.description}`).join('\n\n') +
      rec +
      `\n\nTo make this directory deployable:\n  wrangler-tui adopt`,
      'Recommendation'
    );
    ui.outro('Adopt available');
    return 0;
  }

  ui.outro('No deployment path detected');
  return 1;
}