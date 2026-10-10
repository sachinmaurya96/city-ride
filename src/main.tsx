import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './ui/styles.css';
import './ui/gameHud.css';
import './ui/theme.css';
import { installDevHooks } from './app/devHooks';

installDevHooks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
