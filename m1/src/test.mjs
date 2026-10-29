import * as ui from './ui.mjs';
import { spawnTask } from './supervisor.mjs';
import { createMockProject, destroyMockProject } from './mock.mjs';
import { detect, summarize } from './project.mjs';
import * as auth from './auth.mjs';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (ok) console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? '  — ' + detail : ''}`);
  else console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? '  — ' + detail : ''}`);
}

async function runTask(cmd, args, opts = {}) {
  const t = spawnTask(cmd, args, opts).start();
  const result = await t.wait();
  return { ...result, output: t.output() };
}

export async function run({ keep = false } = {}) {
  ui.intro('wrangler-tui self-test');

  console.log('\n[1/6] Node runtime');
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  record('node.version>=22', nodeMajor >= 22, `v${process.versions.node}`);

  console.log('\n[2/6] Wrangler CLI');
  const wv = await runTask('wrangler', ['--version']);
  record('wrangler.present', wv.code === 0, wv.code === 0 ? wv.output.trim().split('\n')[0] : `exit ${wv.code}`);

  console.log('\n[3/6] Auth status (informational)');
  const st = await auth.status();
  record('auth.status',
    true,
    st.authenticated
      ? `authenticated${st.email ? ' (' + st.email + ')' : ''}, ${st.accounts?.length ?? 0} account(s)`
      : 'not authenticated — some tests will still run'
  );

  console.log('\n[4/6] Mock project scaffold');
  const mockDir = createMockProject();
  record('mock.project.created', true, mockDir);

  console.log('\n[5/6] Project detection');
  const detected = detect(mockDir);
  if (detected) {
    const s = summarize(detected);
    record('project.detection', true, `name=${s.name} config=${detected.configPath}`);
  } else {
    record('project.detection', false, 'detect() returned null');
  }

  console.log('\n[6/6] Dry-run deploy');
  const dry = await runTask('wrangler', ['deploy', '--dry-run', '--outdir', '/tmp/wrangler-tui-test-dry'], { cwd: mockDir });
  record('deploy.dry_run', dry.code === 0, `exit ${dry.code}`);
  if (dry.code !== 0) {
    console.log('--- dry-run output (last 15 lines) ---');
    console.log(dry.output.split('\n').slice(-15).join('\n'));
  }

  if (!keep) {
    console.log('\n[cleanup] removing mock project');
    destroyMockProject(mockDir);
  } else {
    console.log(`\n[cleanup] mock project preserved at: ${mockDir}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  ui.note(
    results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`).join('\n') +
    `\n\nTotal: ${passed}/${results.length} passed`,
    failed === 0 ? 'All tests passed' : `${failed} test(s) failed`
  );

  if (failed > 0) { ui.outro('FAIL'); return 1; }
  ui.outro('PASS');
  return 0;
}

// Allow direct invocation: node src/test.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const keep = process.argv.includes('--keep');
  run({ keep })
    .then((code) => { ui.restoreTerminal(); process.exitCode = code; })
    .catch((err) => { ui.restoreTerminal(); console.error('fatal:', err); process.exitCode = 1; });
}