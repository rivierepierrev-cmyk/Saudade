import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { SaudadeStorage } from './lib/storage';
import { applyTheme } from './lib/theme';

// Before the first render, so the page never flashes in the wrong theme.
applyTheme(SaudadeStorage.getSettings().theme);

createRoot(document.getElementById('root')!).render(<App />);
