// Runs the end-to-end suites against the development build (npm run build &&
// npm run build:server first). On Linux without a display, use xvfb-run.
const { execFileSync } = require('child_process');
const path = require('path');
for (const suite of ['storage', 'reading', 'imports', 'polish', 'math', 'workflow', 'browse', 'finish', 'contrast']) {
  console.log(`\n▶ ${suite}`);
  execFileSync(process.execPath, [path.join(__dirname, `${suite}.cjs`)], { stdio: 'inherit' });
}
