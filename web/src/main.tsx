import { inject } from '@vercel/analytics';
import { StrictMode } from 'react';
import { installAnalytics } from './analytics';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startUrlSync } from './url/sync';
import './styles/global.css';

inject();
// A no-op unless VITE_GA_ID holds a valid GA4 id, so a developer's clone is silent by default.
installAnalytics(import.meta.env);
startUrlSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
