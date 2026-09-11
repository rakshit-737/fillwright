import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@/ui/base.css';
import './options.css';

const container = document.getElementById('root');
if (!container) throw new Error('Options root element is missing');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
