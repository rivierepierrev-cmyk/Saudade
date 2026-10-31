// End-to-end checks in Chromium: npm run test:e2e [-- screenshot dir]
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');

const shots = process.argv[2];
const port = 4179;
const suites = (process.env.SUITES || 'holidays,timetable,sequences,agenda').split(',');

(async () => {
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(url); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  const browser = await chromium.launch();
  let failed = false;
  try {
    for (const name of suites) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'fr-FR' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => d.accept());
      await page.clock.setFixedTime(new Date('2025-10-01T10:00:00')); // school year 2025-2026
      await page.goto(url);
      try {
        await require(`./${name}.cjs`)(page, { shot: (file) => shots && page.screenshot({ path: path.join(shots, file) }) });
        if (errors.length) throw new Error(`Page errors: ${errors.join(' | ')}`);
        console.log(`${name}: ok`);
      } catch (e) {
        failed = true;
        console.error(`${name}: FAILED\n`, e);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(failed ? 1 : 0);
})();
