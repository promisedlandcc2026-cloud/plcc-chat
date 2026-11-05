import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { reloadOnceForNewVersion } from './lib/staleBuild';
import { initInstallPrompt } from './lib/installPrompt';
import { registerAlertsWorker } from './lib/phoneAlerts';

// Catch Chrome's install event early (it can fire before React mounts).
initInstallPrompt();

// Phone alerts: the worker only shows alerts (no caching), so it is safe on every load.
if (import.meta.env.PROD) window.addEventListener('load', () => void registerAlertsWorker());

// A deploy replaced the script files this open copy expects: reload once (guarded against loops).
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForNewVersion()) event.preventDefault();
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element to mount to');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
