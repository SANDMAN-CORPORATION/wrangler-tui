// Appends one TSV line per marker to WRANGLER_TUI_TIMING_FILE.
// Elapsed is measured from WRANGLER_TUI_SHIM_START_MS (set by launcher.sh).
// Degrades to a no-op when the env vars are absent (e.g. direct invocation).
import { appendFileSync } from 'node:fs';

const SHIM_START_MS = parseInt(process.env.WRANGLER_TUI_SHIM_START_MS || '0', 10);
const FILE = process.env.WRANGLER_TUI_TIMING_FILE || null;
const ENABLED = FILE !== null && SHIM_START_MS > 0;

export function isEnabled() { return ENABLED; }

export function mark(name, detail = '') {
  const ms = ENABLED ? Date.now() - SHIM_START_MS : 0;
  if (ENABLED) {
    try { appendFileSync(FILE, `${ms}\t${name}\t${detail}\n`); } catch { /* best effort */ }
  }
  return ms;
}

// Emit the earliest possible mark once this module loads. Because ESM resolves
// imports before the importer's body runs, this is the earliest node-side mark.
mark('node.module.loaded');