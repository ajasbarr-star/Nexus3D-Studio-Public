import test from 'node:test';
import assert from 'node:assert/strict';
import { configureDirectionalShadow, DEFAULT_DIRECTIONAL_SHADOW_MAP_SIZE } from '../../src/lighting/shadow-optimization.mjs';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');

function mockDirectionalLight() {
  return {
    isDirectionalLight: true,
    visible: true,
    castShadow: true,
    shadow: {
      mapSize: { width: 512, height: 512, set(width, height) { this.width = width; this.height = height; } },
      needsUpdate: false
    }
  };
}

test('Directional Lights use a lower 256px shadow map by default', () => {
  const light = mockDirectionalLight();
  assert.equal(DEFAULT_DIRECTIONAL_SHADOW_MAP_SIZE, 256);
  assert.equal(configureDirectionalShadow(light), true);
  assert.deepEqual([light.shadow.mapSize.width, light.shadow.mapSize.height], [256, 256]);
  assert.equal(light.shadow.needsUpdate, true);
});

test('shadow optimization preserves independent shadow casting and illumination visibility', () => {
  const light = mockDirectionalLight();
  configureDirectionalShadow(light);
  assert.equal(light.castShadow, true);
  assert.equal(light.visible, true);
});

test('shadow optimization does not modify Point, Spot, or non-light objects', () => {
  const point = { isPointLight: true, castShadow: true, shadow: { mapSize: { set() { throw new Error('must not run'); } } } };
  assert.equal(configureDirectionalShadow(point), false);
  assert.equal(configureDirectionalShadow(null), false);
});

test('invalid custom map sizes are rejected without changing the light', () => {
  const light = mockDirectionalLight();
  assert.equal(configureDirectionalShadow(light, 0), false);
  assert.equal(configureDirectionalShadow(light, Number.NaN), false);
  assert.deepEqual([light.shadow.mapSize.width, light.shadow.mapSize.height], [512, 512]);
});

test('Nexus3D applies the lower shadow-map budget to new and restored Directional Lights', () => {
  assert.match(app, /configureDirectionalShadow\(l\)/);
  assert.match(app, /if \(node\.isDirectionalLight\) configureDirectionalShadow\(node\)/);
  assert.match(app, /configureDirectionalShadow\(light\)/);
});

test('RDS reports directional shadow map sizes and real GPU texture-unit limits', () => {
  assert.match(app, /Directional Shadow Capacity/);
  assert.match(app, /MAX_TEXTURE_IMAGE_UNITS/);
  assert.match(app, /MAX_COMBINED_TEXTURE_IMAGE_UNITS/);
  assert.match(app, /not an exact shader sampler total/);
});
