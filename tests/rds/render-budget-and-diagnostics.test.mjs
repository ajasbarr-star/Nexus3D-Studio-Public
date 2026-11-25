import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getNexusRenderPixelRatio } from '../../src/performance/render-budget.mjs';

const app = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');

test('Android render budget caps standard DPR while retaining desktop quality', () => {
  assert.equal(getNexusRenderPixelRatio(3, { native: true }), 1.5);
  assert.equal(getNexusRenderPixelRatio(1, { native: true }), 1);
  assert.equal(getNexusRenderPixelRatio(3, { native: false }), 2);
});

test('performance mode applies the lower render budget on every platform', () => {
  assert.equal(getNexusRenderPixelRatio(3, { native: true, performanceMode: true }), 1.15);
  assert.equal(getNexusRenderPixelRatio(3, { native: false, performanceMode: true }), 1.15);
});

test('invalid device pixel ratios fall back safely', () => {
  assert.equal(getNexusRenderPixelRatio(0, { native: true }), 1);
  assert.equal(getNexusRenderPixelRatio(Number.NaN, { native: false }), 1);
});

test('renderer initialization and Performance Mode use the shared render budget', () => {
  assert.match(app, /renderer\.setPixelRatio\(getNexusRenderPixelRatio\(window\.devicePixelRatio \|\| 1, \{ native: Capacitor\.isNativePlatform\(\) \}\)\)/);
  assert.match(app, /const pixelRatio = getNexusRenderPixelRatio\(window\.devicePixelRatio \|\| 1, \{ native: Capacitor\.isNativePlatform\(\), performanceMode: enabled \}\)/);
});

test('diagnostic flush batches updates at a lower frequency than pointer trace sampling', () => {
  assert.match(app, /setInterval\(flush, 1000\)/);
  assert.doesNotMatch(app, /setInterval\(flush, 180\)/);
});
