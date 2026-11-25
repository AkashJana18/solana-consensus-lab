import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { inject } from '@vercel/analytics';
import { installAnalytics } from '../analytics';
import { App } from './App';
import '../styles/global.css';
import './svm.css';

document.body.classList.add('svm-body');
inject();
installAnalytics(import.meta.env);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
