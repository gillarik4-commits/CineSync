import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../styles/base.css';
import './setup.css';
import SetupApp from './SetupApp';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SetupApp />
  </StrictMode>
);
