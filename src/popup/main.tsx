import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/styles.css';
import { bootTheme } from '../ui/theme';
import { ToastProvider } from '../ui/components/Toast';
import { Popup } from './Popup';

bootTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <Popup />
    </ToastProvider>
  </StrictMode>,
);
