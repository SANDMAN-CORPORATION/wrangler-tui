import * as p from '@clack/prompts';

export const prompts = p;

export function intro(text)   { p.intro(text); }
export function outro(text)   { p.outro(text); }
export function note(msg, title) { p.note(msg, title); }

export function stream(text) {
  process.stdout.write(text);
}

export function isCancel(v) { return p.isCancel(v); }

// NEW: stage marker. Writes a dim line to stderr before an await begins.
// The user sees progress; stdout is not polluted; scripts piping stdout are unaffected.
export function stage(n, total, label, detail = '') {
  const prefix = `[${n}/${total}]`;
  const line = detail ? `${prefix} ${label}…  ${detail}` : `${prefix} ${label}…`;
  process.stderr.write(`\x1b[2m${line}\x1b[0m\n`);
}

/**
 * Format an age in ms for display.
 *   500          → "now"
 *   45000        → "45s ago"
 *   840000       → "14m ago"
 *   5400000      → "1h ago"
 *   172800000    → "2d ago"
 */
export function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const s = Math.round(ms / 1000);
  if (s < 1) return 'now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Restore terminal to a sane state. Safe to call multiple times.
export function restoreTerminal() {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch { /* ignore */ }
  try {
    process.stdout.write('\x1b[?25h\x1b[0m\x1b[2K\r');
  } catch { /* ignore */ }
}