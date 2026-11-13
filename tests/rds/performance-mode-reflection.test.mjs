import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');

test('Performance Mode suppresses expensive live cube reflection updates only while enabled', () => {
  assert.match(app, /let performanceModeActive = false/);
  assert.match(app, /setPerformanceMode: \(enabled: boolean\) => \{ performanceModeActive = enabled;/);
  assert.match(app, /if \(!performanceModeActive && mirrorObject\) \{/);
  assert.match(app, /reflectionCamera\.update\(renderer, scene\)/);
});
