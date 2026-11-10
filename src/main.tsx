import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import App from './App';
import './index.css';

// The native APK uses bundled assets and native display controls.
if (Capacitor.isNativePlatform()) {
  void StatusBar.hide().catch((error) => console.warn('Nexus3D status bar could not be hidden:', error));
  void ScreenOrientation.lock({ orientation: 'landscape' }).catch((error) => console.warn('Nexus3D landscape lock is unavailable:', error));
}

// Keep the existing service worker only for browser/PWA deployments.
if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((error) => {
      console.error('Nexus3D service worker registration failed:', error);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
