import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { createQueryClient } from '@/queries';
import { applyTheme, readStoredTheme } from '@/lib/theme';
import './styles/index.css';

// Apply the stored theme before first paint to avoid a flash of the default.
applyTheme(readStoredTheme());

/**
 * One client for the life of the page, created OUTSIDE the render.
 *
 * Created inside it, StrictMode's double render would build two — and the
 * second would throw away the first's cache on every remount, so nothing would
 * ever be served warm and every navigation would refetch.
 */
const queryClient = createQueryClient();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
