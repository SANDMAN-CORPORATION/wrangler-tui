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

// Restore terminal to a sane state. Safe to call multiple times.
export function restoreTerminal() {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch { /* ignore */ }
  try {
    process.stdout.write('\x1b[?25h\x1b[0m\x1b[2K\r');
  } catch { /* ignore */ }
}