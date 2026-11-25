import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSceneVerificationSnapshot,
  buildSceneVerificationMetadata,
  formatSceneVerificationReport,
} from '../../src/diagnostics/scene-verification.mjs';

function makeObject({ id, name, type = 'Mesh', visible = true, parent = null, layers = 1 } = {}) {
  const object = {
    id, uuid: 'uuid-' + id, name, type, visible, parent,
    userData: { editorId: id, kind: type === 'DirectionalLight' ? 'Light' : 'Shape' },
    isDirectionalLight: type === 'DirectionalLight',
    isMesh: type === 'Mesh',
    geometry: type === 'Mesh' ? { type: 'BoxGeometry' } : null,
    layers: { test: cameraLayers => (layers & cameraLayers.mask) !== 0 },
  };
  return object;
}

function makeScene(objects) {
  const scene = { children: objects, traverse(callback) {
    const visit = object => { callback(object); (object.children || []).forEach(visit); };
    visit(this);
  }};
  objects.forEach(object => { object.parent = scene; });
  return scene;
}

const camera = { layers: { mask: 1 } };

test('compares 17 Directional Lights and one Cube between Scene Tree and MainViewport', () => {
  const lights = Array.from({ length: 17 }, (_, index) => makeObject({
    id: 'light-' + (index + 1), name: 'DirectionalLight_' + (index + 1), type: 'DirectionalLight',
  }));
  const cube = makeObject({ id: 'cube-1', name: 'Cube_01' });
  const scene = makeScene([...lights, cube]);
  const treeItems = [...lights, cube].map(object => ({ id: object.userData.editorId, name: object.name, kind: object.userData.kind, object }));
  const snapshot = buildSceneVerificationSnapshot({
    treeItems, scene, camera,
    renderer: { info: { render: { calls: 1, triangles: 12 } } },
  });
  assert.equal(snapshot.sceneTree.directionalLights, 17);
  assert.equal(snapshot.sceneTree.cubes, 1);
  assert.equal(snapshot.mainViewport.directionalLights, 17);
  assert.equal(snapshot.mainViewport.cubes, 1);
  assert.equal(snapshot.reconciliation.status, 'MATCH');
  assert.equal(snapshot.scenarioMatches, true);
  assert.equal(snapshot.records.length, 18);
  assert.ok(snapshot.records.every(record => record.mainViewportPresent && record.visible));
  assert.match(formatSceneVerificationReport(snapshot), /Reference Scenario Match: YES/);
  assert.match(formatSceneVerificationReport(snapshot), /DirectionalLight_17/);
});

test('reports tree-only and MainViewport-only objects without falsely passing reconciliation', () => {
  const inScene = makeObject({ id: 'light-1', name: 'DirectionalLight_01', type: 'DirectionalLight' });
  const absentFromScene = makeObject({ id: 'cube-1', name: 'Cube_01' });
  const sceneOnly = makeObject({ id: 'light-2', name: 'DirectionalLight_02', type: 'DirectionalLight' });
  const scene = makeScene([inScene, sceneOnly]);
  const snapshot = buildSceneVerificationSnapshot({
    treeItems: [
      { id: 'light-1', name: inScene.name, object: inScene },
      { id: 'cube-1', name: absentFromScene.name, object: absentFromScene },
    ],
    scene, camera,
  });
  assert.equal(snapshot.reconciliation.status, 'MISMATCH');
  assert.equal(snapshot.reconciliation.treeOnlyCount, 1);
  assert.equal(snapshot.reconciliation.mainViewportOnlyCount, 1);
  assert.equal(snapshot.scenarioMatches, false);
  const report = formatSceneVerificationReport(snapshot);
  assert.match(report, /MAINVIEWPORT=MISSING/);
  assert.match(report, /MAINVIEWPORT-ONLY EDITOR OBJECTS/);
});

test('distinguishes hidden objects and camera-layer mismatch from scene presence', () => {
  const hiddenParent = { visible: false, parent: null, children: [] };
  const hiddenLight = makeObject({ id: 'light-hidden', name: 'DirectionalLight_hidden', type: 'DirectionalLight', parent: hiddenParent });
  hiddenParent.children.push(hiddenLight);
  const layerLight = makeObject({ id: 'light-layer', name: 'DirectionalLight_layer', type: 'DirectionalLight', layers: 2 });
  const scene = makeScene([hiddenParent, layerLight]);
  const snapshot = buildSceneVerificationSnapshot({
    treeItems: [hiddenLight, layerLight].map(object => ({ id: object.userData.editorId, name: object.name, object })),
    scene, camera,
  });
  assert.equal(snapshot.records[0].mainViewportPresent, true);
  assert.equal(snapshot.records[0].visible, false);
  assert.equal(snapshot.records[0].renderStatus, 'NOT_VISIBLE');
  assert.equal(snapshot.records[1].mainViewportPresent, true);
  assert.equal(snapshot.records[1].cameraLayerMatch, false);
  assert.equal(snapshot.records[1].renderStatus, 'CAMERA_LAYER_MISMATCH');
});

test('metadata keeps observed counts distinct from the expected reference profile', () => {
  const cube = makeObject({ id: 'cube-1', name: 'Cube_01' });
  const snapshot = buildSceneVerificationSnapshot({
    treeItems: [{ id: 'cube-1', name: 'Cube_01', object: cube }],
    scene: makeScene([cube]), camera,
  });
  const metadata = buildSceneVerificationMetadata(snapshot);
  assert.equal(metadata.expectedDirectionalLights, 17);
  assert.equal(metadata.sceneTreeDirectionalLights, 0);
  assert.equal(metadata.mainViewportDirectionalLights, 0);
  assert.equal(metadata.referenceScenarioMatches, false);
  assert.match(metadata.sceneVerificationSummary, /reference profile=17 Directional Lights \+ 1 Cube/);
});

test('unavailable scene is explicitly marked unavailable', () => {
  const snapshot = buildSceneVerificationSnapshot({ treeItems: [] });
  assert.equal(snapshot.reconciliation.status, 'UNAVAILABLE');
  assert.equal(snapshot.scenarioMatches, false);
  assert.match(formatSceneVerificationReport(snapshot), /MainViewport: UNAVAILABLE/);
});
