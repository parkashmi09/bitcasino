import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme, readStoredTheme } from '@/lib/theme';
import './styles/index.css';

// Apply the stored theme before first paint to avoid a flash of the default.
applyTheme(readStoredTheme());

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
