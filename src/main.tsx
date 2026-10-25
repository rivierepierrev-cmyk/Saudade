import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { GemmaStorage } from './lib/storage';
import { applyTheme } from './lib/theme';

// Before the first render, so the page never flashes in the wrong theme.
applyTheme(GemmaStorage.getSettings().theme);

createRoot(document.getElementById('root')!).render(<App />);
