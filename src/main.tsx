import './index.css';

// The phone app keeps its data in the WebView's database (src/mobile/bridge.ts):
// it is put in place before anything reads the storage, as the desktop app's
// preload is.
async function start() {
  if (import.meta.env.VITE_TARGET === 'mobile') await (await import('./mobile/bridge')).installMobileBridge();
  const [{ createRoot }, { default: App }, { SaudadeStorage }, { applyTheme }] = await Promise.all([
    import('react-dom/client'),
    import('./App.tsx'),
    import('./lib/storage'),
    import('./lib/theme'),
  ]);
  // Before the first render, so the page never flashes in the wrong theme.
  applyTheme(SaudadeStorage.getSettings().theme);
  createRoot(document.getElementById('root')!).render(<App />);
}

start();
