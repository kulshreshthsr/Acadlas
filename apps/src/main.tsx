import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

// Archivo's width axis is what gives Acadlas headings their shape, so the
// variable width file is loaded rather than the static weights.
import '@fontsource-variable/archivo/wdth.css';
import './index.css';

import { App } from './App';
import { queryClient } from './lib/api';
import { ToastProvider } from './components/ui';
import { startInstallSupport } from './lib/install';

startInstallSupport();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
