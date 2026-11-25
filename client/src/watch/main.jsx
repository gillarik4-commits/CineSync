import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/base.css';
import './watch.css';
import WatchApp from './WatchApp';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WatchApp />
  </StrictMode>
);
