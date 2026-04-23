// Entry point for the v2 renderer.
// Boots React, applies the initial theme (respecting user preference and
// system scheme), and mounts the App shell into #root.

import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import 'xterm/css/xterm.css';
import { App } from './App';

function applyInitialTheme(): void {
  // Later we'll sync with the main-process theme store. For now fall back to
  // the system media query so the app launches correctly in either mode.
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('theme-dark', Boolean(prefersDark));
}

applyInitialTheme();

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
