import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// Archivo's width axis is what gives Acadlas headings their shape, so the
// variable width file is loaded rather than the static weights.
import '@fontsource-variable/archivo/wdth.css';
import './index.css';

import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
