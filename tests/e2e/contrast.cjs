// Contrast audit: on every screen, in light and dark themes, each visible text is
// measured against its actual background (semi-transparent layers composited).
// Fails when the dark theme has contrast problems the light theme doesn't have.
const { _electron } = require('playwright'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const APP = path.resolve(__dirname, '../..');
const OUT = process.env.SAUDADE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-contrast-'));

function audit() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (css) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, bottom) => { const a = top[3] + bottom[3] * (1 - top[3]); if (a === 0) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a); };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; }
    let color = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) color = over(layers[i], color);
    return color;
  };
  const fails = []; let checked = 0;
  for (const el of document.querySelectorAll('body *')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const st = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || r.bottom < 0 || r.top > innerHeight) continue;
    if (el.closest('[disabled], [aria-disabled="true"], kbd, svg')) continue;
    let opacity = 1; for (let e = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    if (opacity < 0.6) continue;
    const bg = bgOf(el); const fg = over(rgba(st.color), bg);
    const size = parseFloat(st.fontSize); const bold = Number(st.fontWeight) >= 700;
    const min = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const cr = ratio(fg, bg); checked++;
    if (cr < min) fails.push({ text: el.textContent.trim().slice(0, 40), ratio: Math.round(cr * 100) / 100, min, fg: st.color, bg: `rgb(${bg.slice(0, 3).map(Math.round)})` });
  }
  return { checked, fails };
}

const screens = [
  ['queue', async (p) => p.getByRole('button', { name: /File de lecture/ }).first().click()],
  ['editor', async (p) => { await p.getByRole('button', { name: /File de lecture/ }).first().click(); await p.getByTitle(/Modifier l'extrait/).first().click(); }],
  ['reader', async (p) => { await p.keyboard.press('Escape'); await p.getByRole('button', { name: /^Lecteur/ }).first().click(); }],
  ['review-card', async (p) => { await p.getByRole('button', { name: /Révision du jour/ }).first().click(); await p.keyboard.press('Space'); }],
  ['library', async (p) => p.getByRole('button', { name: /Bibliothèque/ }).first().click()],
  ['viewer', async (p) => { await p.getByRole('tab', { name: 'Par type' }).click(); await p.getByRole('button', { name: /^Extraits/ }).first().click(); await p.getByTitle("Lire l'extrait").first().click(); }],
  ['stats', async (p) => { await p.keyboard.press('Escape'); await p.getByRole('button', { name: /Statistiques/ }).first().click(); }],
  ['settings', async (p) => p.getByRole('button', { name: 'Réglages' }).click()],
  ['reader-typo', async (p) => { await p.getByRole('button', { name: /^Lecteur/ }).first().click(); await p.getByRole('button', { name: 'Police et taille du texte' }).click(); }],
  ['import', async (p) => p.getByRole('button', { name: /Ajouter une source/ }).click()],
  ['import-paste', async (p) => p.getByRole('button', { name: 'Coller du texte' }).click()],
];

(async () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'saudade-contrast-cfg-'));
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForSelector('nav');
  const report = {};
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.keyboard.press('Escape');
    for (const [name, go] of screens) {
      await go(page); await page.waitForTimeout(300);
      const r = await page.evaluate(audit);
      report[`${theme}/${name}`] = r;
      await page.screenshot({ path: path.join(OUT, `${theme}-${name}.png`) });
    }
    await page.getByRole('button', { name: /Annuler/ }).first().click().catch(() => {});
  }
  await app.close();
  let regressions = [];
  for (const [name] of screens) {
    const light = report[`light/${name}`], dark = report[`dark/${name}`];
    const lightTexts = new Set(light.fails.map((f) => f.text));
    console.log(`${name.padEnd(13)} light: ${light.fails.length}/${light.checked} below AA · dark: ${dark.fails.length}/${dark.checked}`);
    for (const f of dark.fails) if (!lightTexts.has(f.text)) regressions.push({ screen: name, ...f });
  }
  if (process.env.VERBOSE) console.log(JSON.stringify(report, null, 1));
  console.log('screenshots:', OUT);
  assert.deepEqual(regressions, [], 'dark-only contrast problems:\n' + JSON.stringify(regressions, null, 1));
  console.log('CONTRAST OK');
})().catch((e) => { console.error(e.message || e); process.exit(1); });
