// Regenerates every app icon from build/logo.svg (the logo, drawn as a vector):
//   build/icon.png                 Windows / Linux (electron-builder) and the window icon
//   android/…/mipmap-*/ic_launcher*.png, drawable*/splash.png   the Android app
// Usage: node scripts/gen-icons.cjs   (uses Playwright's Chromium to draw the SVG)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(ROOT, 'build', 'logo.svg'), 'utf8');
const CREAM = '#FAF7F2';
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

/** A picture w×h: background (shape: square, rounded, circle or none) and the logo at `scale` of the smaller side. */
function page(w, h, { background = null, shape = 'none', scale = 1 } = {}) {
  const side = Math.min(w, h);
  const radius = shape === 'circle' ? '50%' : shape === 'rounded' ? `${side * 0.22}px` : '0';
  const box = shape === 'none' || shape === 'square' ? `${w}px;height:${h}px` : `${side}px;height:${side}px`;
  const logo = svg.replace('<svg ', `<svg width="${side * scale}" height="${side * scale}" `);
  return `<html><body style="margin:0;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center">
    <div style="width:${box};border-radius:${radius};background:${background ?? 'transparent'};display:flex;align-items:center;justify-content:center">${logo}</div>
  </body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  const draw = async (file, w, h, options) => {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    await p.setContent(page(w, h, options));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.screenshot({ path: file, omitBackground: true });
    await p.close();
  };

  await draw(path.join(ROOT, 'build', 'icon.png'), 1024, 1024, { scale: 0.96 });

  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [name, k] of Object.entries(densities)) {
    const dir = path.join(RES, `mipmap-${name}`);
    // Older launchers: the whole icon. Android 8+: a foreground on a 108dp canvas whose
    // central 66dp always shows, over the cream background (values/ic_launcher_background.xml).
    await draw(path.join(dir, 'ic_launcher.png'), 48 * k, 48 * k, { background: CREAM, shape: 'rounded', scale: 0.84 });
    await draw(path.join(dir, 'ic_launcher_round.png'), 48 * k, 48 * k, { background: CREAM, shape: 'circle', scale: 0.78 });
    await draw(path.join(dir, 'ic_launcher_foreground.png'), 108 * k, 108 * k, { scale: 0.6 });
  }

  for (const dir of fs.readdirSync(RES).filter((d) => d.startsWith('drawable'))) {
    const file = path.join(RES, dir, 'splash.png');
    if (!fs.existsSync(file)) continue;
    const png = fs.readFileSync(file); // keep each splash's size (PNG header: width, height)
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    await draw(file, w, h, { background: CREAM, shape: 'square', scale: 0.42 });
  }
  await browser.close();
  console.log('icons written');
})();
