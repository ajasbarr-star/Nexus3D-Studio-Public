import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const activity = readFileSync('native/android/MainActivity.java', 'utf8');
const plugin = readFileSync('native/android/NexusDeviceIdentityPlugin.java', 'utf8');

test('Android foreground and background lifecycle report presence', () => {
  assert.match(activity, /public void onResume\(\)[\s\S]*?onAppForegroundChanged\(getApplicationContext\(\), true\)/);
  assert.match(activity, /public void onPause\(\)[\s\S]*?onAppForegroundChanged\(getApplicationContext\(\), false\)/);
});

test('presence heartbeats are periodic and stop on background', () => {
  assert.match(plugin, /scheduleAtFixedRate\([\s\S]*?0, 45, TimeUnit\.SECONDS/);
  assert.match(plugin, /presenceTask\.cancel\(false\)/);
  assert.match(plugin, /device-presence/);
  assert.match(plugin, /body\.put\("state", state\)/);
});

test('presence credential remains native-only and requires consent plus registration', () => {
  assert.match(plugin, /prefs\.getBoolean\(CONSENT, false\) \|\| !prefs\.getBoolean\(REGISTERED, false\)/);
  assert.match(plugin, /AndroidKeyStore/);
  assert.doesNotMatch(plugin, /result\.put\("deviceCode"/);
  assert.match(plugin, /foreground-active or backgrounded/);
});
