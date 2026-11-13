import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');

test('native Capacitor APK is excluded from the PWA install prompt flow', () => {
  assert.match(app, /const isNativeApp = Capacitor\.isNativePlatform\(\)/);
  assert.match(app, /if \(!isNativeApp\) window\.addEventListener\('beforeinstallprompt', onInstall\)/);
  assert.match(app, /const timer = !isNativeApp && !alreadyStandalone/);
  assert.match(app, /showInstall && !Capacitor\.isNativePlatform\(\)/);
  assert.match(app, /!Capacitor\.isNativePlatform\(\) && <button className="menu-option"/);
});

test('web PWA install prompt remains available outside the native APK', () => {
  assert.match(app, /window\.addEventListener\('beforeinstallprompt', onInstall\)/);
  assert.match(app, /Install Nexus3D App \/ APK for fullscreen desktop-like experience/);
});
