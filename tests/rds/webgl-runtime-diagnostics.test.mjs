import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachShaderErrorCapture,
  collectWebGLDiagnostics,
  formatMaterialTextureAnalysis,
  formatShadowMapAnalysis,
  formatWebGLDiagnostics
} from '../../src/diagnostics/webgl-runtime-diagnostics.mjs';

function makeScene(objects) {
  return { traverseVisible(callback) { objects.forEach(object => callback(object)); } };
}
function makeRenderer() {
  const values = new Map([
    ['VERSION', 'WebGL 2.0'], ['RENDERER', 'Test GPU'], ['VENDOR', 'Test Vendor'],
    ['MAX_TEXTURE_SIZE', 4096], ['MAX_TEXTURE_IMAGE_UNITS', 16],
    ['MAX_VERTEX_TEXTURE_IMAGE_UNITS', 16], ['MAX_COMBINED_TEXTURE_IMAGE_UNITS', 32],
    ['MAX_FRAGMENT_UNIFORM_VECTORS', 1024], ['MAX_VERTEX_UNIFORM_VECTORS', 1024]
  ]);
  const gl = { isContextLost: () => false, getParameter(key) { return values.get(key) ?? null; } };
  for (const key of values.keys()) gl[key] = key;
  return {
    getContext: () => gl,
    shadowMap: { enabled: true, autoUpdate: true },
    info: { render: { calls: 7, triangles: 120 }, memory: { geometries: 3, textures: 2 } },
    debug: { onShaderError: null }
  };
}

test('collects WebGL limits, visible shadow casters and material texture slots without mutation', () => {
  const texture = { isTexture: true, name: 'albedo', uuid: 'tex-1' };
  const material = { uuid: 'mat-1', name: 'TestMat', type: 'MeshStandardMaterial', map: texture, roughnessMap: null };
  const mesh = { isMesh: true, visible: true, name: 'Cube', material };
  const light = { isLight: true, visible: true, isDirectionalLight: true, type: 'DirectionalLight', name: 'Sun', castShadow: true, shadow: { mapSize: { width: 1024, height: 1024 }, map: {} } };
  const renderer = makeRenderer();
  const snapshot = collectWebGLDiagnostics({ renderer, scene: makeScene([mesh, light]) });
  assert.equal(snapshot.webgl.fragmentTextureUnits, 16);
  assert.equal(snapshot.shadows.shadowCastingLights, 1);
  assert.equal(snapshot.materials.materialTextureSlots, 1);
  assert.equal(snapshot.materials.uniqueTextures, 1);
  assert.equal(snapshot.render.drawCalls, 7);
  assert.equal(material.map, texture);
  assert.match(formatWebGLDiagnostics(snapshot), /WEBGL \/ SHADER DIAGNOSTICS/);
  assert.match(formatShadowMapAnalysis(snapshot), /PER-FRAME RENDER COUNT: NOT EXPOSED/);
  assert.match(formatMaterialTextureAnalysis(snapshot), /albedo/);
});

test('captures shader error logs and restores the previous Three.js callback', () => {
  const calls = [];
  const previous = () => calls.push('previous');
  const renderer = { debug: { onShaderError: previous } };
  let captured;
  const stop = attachShaderErrorCapture(renderer, value => { captured = value; });
  renderer.debug.onShaderError({
    getProgramInfoLog: () => 'too many texture image units for this shader',
    getShaderInfoLog: () => ''
  }, {}, {}, {});
  assert.deepEqual(calls, ['previous']);
  assert.match(captured.message, /sampler or texture-unit overflow/);
  assert.match(captured.details, /too many texture image units/);
  stop();
  assert.equal(renderer.debug.onShaderError, previous);
});
