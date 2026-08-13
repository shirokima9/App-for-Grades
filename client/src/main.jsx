import React from 'react';
import { createRoot } from 'react-dom/client';
// الخط العربي مضمَّن محليًا من الحزمة — لا تحميل من الإنترنت
import '@fontsource/cairo/arabic-400.css';
import '@fontsource/cairo/arabic-600.css';
import '@fontsource/cairo/arabic-700.css';
import './styles.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
