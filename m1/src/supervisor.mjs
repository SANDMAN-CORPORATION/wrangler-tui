import { spawn } from 'node:child_process';

const MAX_BUFFER_CHUNKS = 500;

export class Task {
  constructor(cmd, args, opts = {}) {
    this.cmd = cmd;
    this.args = args;
    this.opts = opts;
    this.state = 'idle';
    this.exitCode = null;
    this.exitSignal = null;
    this.buffer = [];
    this.listeners = { data: [], exit: [], state: [] };
    this.child = null;
  }

  on(event, fn) { this.listeners[event].push(fn); return this; }
  emit(event, ...args) { for (const fn of this.listeners[event]) fn(...args); }

  setState(s) { this.state = s; this.emit('state', s); }

  start() {
    if (this.state !== 'idle') throw new Error(`cannot start in state ${this.state}`);
    this.setState('starting');
    this.child = spawn(this.cmd, this.args, {
      cwd: this.opts.cwd,
      env: { ...process.env, ...(this.opts.env || {}) },
      shell: false,
      stdio: this.opts.stdio || ['ignore', 'pipe', 'pipe'],
    });
    this.pid = this.child.pid;
    this.setState('running');

    const onData = (chunk) => {
      const text = chunk.toString();
      this.buffer.push(text);
      while (this.buffer.length > MAX_BUFFER_CHUNKS) this.buffer.shift();
      this.emit('data', text);
    };
    this.child.stdout?.on('data', onData);
    this.child.stderr?.on('data', onData);

    this.child.on('error', (err) => {
      this.error = err.message;
      this.setState('failed');
      this.emit('exit', { code: -1, error: err.message });
    });

    this.child.on('exit', (code, signal) => {
      this.exitCode = code;
      this.exitSignal = signal;
      this.setState(signal ? 'killed' : code === 0 ? 'succeeded' : 'failed');
      this.emit('exit', { code, signal });
    });
    return this;
  }

  wait() {
    return new Promise((resolve) => {
      if (['succeeded', 'failed', 'killed'].includes(this.state)) {
        return resolve({ code: this.exitCode, signal: this.exitSignal });
      }
      this.on('exit', resolve);
    });
  }

  async stop(graceMs = 10000) {
    if (!this.child || ['succeeded', 'failed', 'killed'].includes(this.state)) return;
    this.setState('stopping');
    this.child.kill('SIGINT');
    await new Promise((resolve) => {
      const start = Date.now();
      const tick = setInterval(() => {
        if (this.child.exitCode !== null) { clearInterval(tick); return resolve(); }
        const elapsed = Date.now() - start;
        if (elapsed > graceMs && !this.sentTerm) {
          this.sentTerm = true;
          this.child.kill('SIGTERM');
        }
        if (elapsed > graceMs + 5000) {
          this.child.kill('SIGKILL');
          clearInterval(tick);
          resolve();
        }
      }, 200);
    });
  }

  output() { return this.buffer.join(''); }
}

export function spawnTask(cmd, args, opts) {
  return new Task(cmd, args, opts);
}