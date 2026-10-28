// Runs the end-to-end suites against the development build (npm run build &&
// npm run build:server first). On Linux without a display, use xvfb-run.
// Each suite has a time limit. In GitHub Actions, a failure or a timeout is also
// reported as an annotation (readable from the API even when logs aren't).
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = ['storage', 'reading', 'imports', 'polish', 'math', 'workflow', 'browse', 'finish', 'cleanup', 'notes', 'readercards', 'sync', 'contrast'];
const TIME_LIMIT_MS = 8 * 60 * 1000;
const inCi = process.env.GITHUB_ACTIONS === 'true';
const only = process.argv.slice(2);

const annotate = (suite, message) => {
  if (!inCi) return;
  // Annotations are one line: newlines are encoded as %0A.
  const escaped = message.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
  console.log(`::error title=E2E ${suite}::${escaped}`);
};

let failures = 0;
for (const suite of SUITES.filter((s) => only.length === 0 || only.includes(s))) {
  console.log(inCi ? `::group::${suite}` : `\n▶ ${suite}`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(__dirname, `${suite}.cjs`)], {
    encoding: 'utf8',
    timeout: TIME_LIMIT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  if (inCi) console.log('::endgroup::');
  const seconds = Math.round((Date.now() - started) / 1000);
  // Chromium's own noise (GPU, D-Bus) isn't useful in a summary.
  const tail = output
    .split('\n')
    .filter((l) => l.trim() && !/ERROR:.*(dbus|bus\.cc|gpu|viz)/.test(l))
    .slice(-25)
    .join('\n');
  if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGKILL') {
    failures++;
    console.log(`✗ ${suite}: no result after ${seconds} s (stopped)`);
    annotate(suite, `Timed out after ${seconds} s. Last output:\n${tail}`);
  } else if (result.status !== 0) {
    failures++;
    console.log(`✗ ${suite}: failed (exit ${result.status}) after ${seconds} s`);
    annotate(suite, `Failed after ${seconds} s:\n${tail}`);
  } else {
    console.log(`✓ ${suite} (${seconds} s)`);
  }
}
process.exit(failures ? 1 : 0);
