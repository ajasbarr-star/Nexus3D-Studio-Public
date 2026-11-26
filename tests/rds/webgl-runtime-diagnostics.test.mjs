import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachShaderErrorCapture,
  attachShadowRenderCapture,
  formatShadowRenderCapture,
  collectWebGLDiagnostics,
  formatMaterialTextureAnalysis,
  formatShadowMapAnalysis,
  formatWebGLDiagnostics
} from '../../src/diagnostics/webgl-runtime-diagnostics.mjs';

function makeScene(objects) {
  const root = { visible: true, children: [], traverse(callback) {
    const visit = object => { callback(object); for (const child of object.children || []) visit(child); };
    visit(this);
  }};
  for (const object of objects) {
    object.parent = root;
    root.children.push(object);
  }
  return root;
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

test('collects WebGL limits, all-scene shadow casters and visible material slots without mutation', () => {
  const texture = { isTexture: true, name: 'albedo', uuid: 'tex-1' };
  const material = { uuid: 'mat-1', name: 'TestMat', type: 'MeshStandardMaterial', map: texture, roughnessMap: null };
  const mesh = { isMesh: true, visible: true, name: 'Cube', material };
  const light = { isLight: true, visible: true, isDirectionalLight: true, type: 'DirectionalLight', name: 'Sun', castShadow: true, shadow: { mapSize: { width: 1024, height: 1024 }, map: {} } };
  const renderer = makeRenderer();
  const snapshot = collectWebGLDiagnostics({ renderer, scene: makeScene([mesh, light]) });
  assert.equal(snapshot.webgl.fragmentTextureUnits, 16);
  assert.equal(snapshot.shadows.shadowCastingLights, 1);
  assert.equal(snapshot.shadows.visibleShadowCastingLights, 1);
  assert.equal(snapshot.shadows.hiddenShadowCastingLights, 0);
  assert.equal(snapshot.materials.materialTextureSlots, 1);
  assert.equal(snapshot.materials.uniqueTextures, 1);
  assert.equal(snapshot.render.drawCalls, 7);
  assert.equal(material.map, texture);
  assert.match(formatWebGLDiagnostics(snapshot), /WEBGL \/ SHADER DIAGNOSTICS/);
  assert.match(formatShadowMapAnalysis(snapshot), /PER-FRAME RENDER COUNT: NOT EXPOSED/);
  assert.equal(snapshot.scene.identity, snapshot.sceneIdentity);
  assert.equal(snapshot.shadows.directionalShadowCastingLights, 1);
  assert.match(formatShadowMapAnalysis(snapshot), /Directional shadow casters: 1/);
  assert.match(formatMaterialTextureAnalysis(snapshot), /albedo/);
});

test('counts shadow casters under hidden parents and reports their effective visibility', () => {
  const root = makeScene([]);
  const hiddenGroup = { visible: false, parent: root, children: [] };
  root.children.push(hiddenGroup);
  for (let index = 0; index < 17; index += 1) {
    const light = {
      isLight: true, visible: true, parent: hiddenGroup, children: [],
      type: 'DirectionalLight', castShadow: true,
      name: 'DirectionalLight_' + (index + 1),
      shadow: { mapSize: { width: 256, height: 256 }, map: {} }
    };
    hiddenGroup.children.push(light);
  }
  const snapshot = collectWebGLDiagnostics({ renderer: makeRenderer(), scene: root });
  assert.equal(snapshot.shadows.shadowCastingLights, 17);
  assert.equal(snapshot.shadows.visibleShadowCastingLights, 0);
  assert.equal(snapshot.shadows.hiddenShadowCastingLights, 17);
  assert.equal(snapshot.shadows.maps.length, 17);
  assert.equal(snapshot.shadows.directionalShadowCastingLights, 17);
  assert.equal(snapshot.shadows.directionalMaps.length, 17);
  assert.equal(snapshot.shadows.maps.every(map => map.visible === false), true);
  assert.match(formatShadowMapAnalysis(snapshot), /Shadow-casting lights \(entire scene\): 17/);
  assert.match(formatShadowMapAnalysis(snapshot), /Hidden shadow-casting lights: 17/);
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


test('keeps a stable scene identity across inventory snapshots and records changing light counts', () => {
  const scene = makeScene([]);
  const renderer = makeRenderer();
  const first = collectWebGLDiagnostics({ renderer, scene });
  const light = {
    isLight: true, isDirectionalLight: true, type: 'DirectionalLight',
    name: 'Sun', castShadow: true, visible: true,
    shadow: { mapSize: { width: 256, height: 256 }, map: null }
  };
  light.parent = scene;
  scene.children.push(light);
  const second = collectWebGLDiagnostics({ renderer, scene });
  assert.equal(first.sceneIdentity, second.sceneIdentity);
  assert.notEqual(first.snapshotId, second.snapshotId);
  assert.equal(first.shadows.directionalShadowCastingLights, 0);
  assert.equal(second.shadows.directionalShadowCastingLights, 1);
  assert.match(formatShadowMapAnalysis(second), /Scene identity:/);
});

test('captures the exact sampler location/component linking failure and event-time scene context', () => {
  const renderer = { debug: { onShaderError: null } };
  const context = {
    snapshotId: 9,
    sceneIdentity: 'scene-test-1',
    webgl: { fragmentTextureUnits: 16, combinedTextureUnits: 32 },
    shadows: { directionalShadowCastingLights: 17 }
  };
  let captured;
  const stop = attachShaderErrorCapture(renderer, value => { captured = value; }, { getContext: () => context });
  renderer.debug.onShaderError({
    getProgramInfoLog: () => 'Sampler location or component exceeds max allowed. Linking failed.',
    getShaderInfoLog: () => ''
  }, {}, {}, {});
  assert.equal(captured.category, 'SAMPLER_LIMIT');
  assert.match(captured.message, /sampler location\/component limit exceeded/i);
  assert.match(captured.details, /Sampler location or component exceeds max allowed/);
  assert.equal(captured.context, context);
  const report = formatWebGLDiagnostics({ shaderErrors: [captured] });
  assert.match(report, /directional shadow casters: 17/);
  assert.match(report, /fragment units: 16/);
  stop();
});


test('counts shadow-map update cycles per frame and restores the renderer hook', () => {
  let clock = 0;
  let step = 4;
  let invocations = 0;
  const original = function () { invocations += 1; clock += step; };
  const renderer = { shadowMap: { render: original } };
  const capture = attachShadowRenderCapture(renderer, { now: () => clock });
  renderer.shadowMap.render([], {}, {});
  capture.recordFrame(16.7);
  step = 3;
  renderer.shadowMap.render([], {}, {});
  capture.recordFrame(17.2);
  const snapshot = capture.getSnapshot();
  assert.equal(invocations, 2);
  assert.equal(snapshot.totalUpdateCycles, 2);
  assert.equal(snapshot.measuredFrames, 2);
  assert.equal(snapshot.storedSamples, 2);
  assert.equal(snapshot.averageUpdateCyclesPerFrame, 1);
  assert.equal(snapshot.averageShadowRenderMsPerFrame, 3.5);
  assert.match(formatShadowRenderCapture(snapshot), /not a count of individual lights/);
  capture.stop();
  assert.equal(renderer.shadowMap.render, original);
});

test('keeps lifetime frame averages consistent when stored samples are capped', () => {
  let clock = 0;
  const renderer = { shadowMap: { render() { clock += 1; } } };
  const capture = attachShadowRenderCapture(renderer, { now: () => clock, maxSamples: 1200 });
  for (let frame = 0; frame < 1300; frame += 1) {
    renderer.shadowMap.render();
    capture.recordFrame(16);
  }
  const snapshot = capture.getSnapshot();
  assert.equal(snapshot.totalUpdateCycles, 1300);
  assert.equal(snapshot.measuredFrames, 1300);
  assert.equal(snapshot.storedSamples, 1200);
  assert.equal(snapshot.averageUpdateCyclesPerFrame, 1);
  assert.equal(snapshot.frames, snapshot.measuredFrames);
  capture.stop();
});

test('reports shadow render instrumentation unavailable when Three.js hook is absent', () => {
  assert.throws(() => attachShadowRenderCapture({ shadowMap: {} }), /hook is unavailable/);
});
