export const RDS_SCENE_TEST_PROFILE = Object.freeze({
  name: '17 Directional Lights + 1 Cube',
  expectedDirectionalLights: 17,
  expectedCubes: 1,
});

function objectId(item, object) {
  return String(item?.id || object?.userData?.editorId || object?.uuid || object?.id || 'UNKNOWN_ID');
}

function isDirectionalLight(object) {
  return Boolean(object?.isDirectionalLight || object?.type === 'DirectionalLight');
}

function isCube(item, object) {
  const name = String(item?.name || object?.name || '');
  return /^cube(?:[_\s-]|$)/i.test(name) ||
    String(object?.userData?.primitiveType || '').toLowerCase() === 'cube' ||
    String(object?.geometry?.type || '') === 'BoxGeometry' && /cube/i.test(name);
}

function isVisibleThroughParents(object) {
  let current = object;
  while (current) {
    if (current.visible === false) return false;
    current = current.parent;
  }
  return true;
}

function layerMatchesCamera(object, camera) {
  if (!object?.layers || !camera?.layers || typeof object.layers.test !== 'function') return null;
  return object.layers.test(camera.layers);
}

function collectSceneObjects(scene) {
  const objects = [];
  if (typeof scene?.traverse === 'function') scene.traverse(object => objects.push(object));
  return objects;
}

/**
 * Read-only comparison of the actual Scene Tree data source and the live
 * Three.js MainViewport scene. It never changes scene objects or renderer state.
 */
export function buildSceneVerificationSnapshot({
  treeItems = [],
  selectableObjects = null,
  scene = null,
  renderer = null,
  camera = null,
  frameDiagnostics = null,
  testProfile = RDS_SCENE_TEST_PROFILE,
} = {}) {
  const sceneAvailable = Boolean(scene && typeof scene.traverse === 'function');
  const treeAvailable = Array.isArray(treeItems);
  const sceneObjects = collectSceneObjects(scene);
  const sceneObjectSet = new Set(sceneObjects);
  const sceneEditorObjects = sceneObjects.filter(object => object?.userData?.editorId);
  const selectableInventory = Array.isArray(selectableObjects) ? selectableObjects : sceneEditorObjects;
  const selectableSceneObjects = selectableInventory.filter(object => sceneObjectSet.has(object));
  const normalizedTreeItems = treeItems.map(item => ({ item, object: item?.object })).filter(entry => entry.object);
  const treeObjectSet = new Set(normalizedTreeItems.map(entry => entry.object));

  const records = normalizedTreeItems.map(({ item, object }) => {
    const inScene = sceneObjectSet.has(object);
    const visible = inScene ? isVisibleThroughParents(object) : false;
    const layerMatch = inScene ? layerMatchesCamera(object, camera) : false;
    const directional = isDirectionalLight(object);
    const cube = isCube(item, object);
    let renderStatus = 'NOT_APPLICABLE';
    if (inScene && visible && layerMatch !== false) {
      if (directional) renderStatus = 'SCENE_LIGHT_REGISTERED; PER_LIGHT_SHADER_CONTRIBUTION_NOT_MEASURED';
      else if (object.isMesh) renderStatus = 'MESH_RENDER_CANDIDATE; PER_OBJECT_DRAW_NOT_MEASURED';
    } else if (inScene && !visible) renderStatus = 'NOT_VISIBLE';
    else if (inScene && layerMatch === false) renderStatus = 'CAMERA_LAYER_MISMATCH';
    else if (!inScene) renderStatus = 'NOT_IN_MAINVIEWPORT_SCENE';

    return {
      id: objectId(item, object),
      name: String(item?.name || object.name || object.type || 'Unnamed Object'),
      kind: String(item?.kind || object.userData?.kind || object.type || 'Object'),
      directionalLight: directional,
      cube,
      sceneTreePresent: true,
      mainViewportPresent: inScene,
      visible,
      cameraLayerMatch: layerMatch,
      renderStatus,
    };
  });

  const sceneOnlyObjects = selectableSceneObjects.filter(object => !treeObjectSet.has(object));
  const treeOnlyObjects = normalizedTreeItems.filter(({ object }) => !sceneObjectSet.has(object));
  const editorIds = new Map();
  for (const object of selectableSceneObjects) {
    const id = String(object.userData?.editorId || '');
    if (id) editorIds.set(id, (editorIds.get(id) || 0) + 1);
  }
  const duplicateEditorIds = [...editorIds.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));

  const treeDirectionalLights = records.filter(record => record.directionalLight).length;
  const treeCubes = records.filter(record => record.cube).length;
  const mainDirectionalLights = selectableSceneObjects.filter(isDirectionalLight).length;
  const mainCubes = selectableSceneObjects.filter(object => isCube(null, object)).length;
  const treeReconciled = sceneAvailable && treeAvailable && treeOnlyObjects.length === 0 &&
    sceneOnlyObjects.length === 0 && duplicateEditorIds.length === 0;
  const expectedDirectionalLights = Number(testProfile?.expectedDirectionalLights ?? 17);
  const expectedCubes = Number(testProfile?.expectedCubes ?? 1);
  const scenarioMatches = treeReconciled &&
    treeDirectionalLights === expectedDirectionalLights &&
    treeCubes === expectedCubes &&
    mainDirectionalLights === expectedDirectionalLights &&
    mainCubes === expectedCubes;

  return {
    schemaVersion: 1,
    testProfile: String(testProfile?.name || 'Custom Scene Verification'),
    expected: { directionalLights: expectedDirectionalLights, cubes: expectedCubes },
    available: { scene: sceneAvailable, sceneTree: treeAvailable },
    sceneTree: {
      totalItems: normalizedTreeItems.length,
      directionalLights: treeDirectionalLights,
      cubes: treeCubes,
    },
    mainViewport: {
      editorObjects: selectableSceneObjects.length,
      directionalLights: mainDirectionalLights,
      cubes: mainCubes,
      renderCalls: Number.isFinite(renderer?.info?.render?.calls) ? renderer.info.render.calls : null,
      triangles: Number.isFinite(renderer?.info?.render?.triangles) ? renderer.info.render.triangles : null,
      frameDiagnostics: frameDiagnostics || null,
    },
    reconciliation: {
      status: !sceneAvailable || !treeAvailable ? 'UNAVAILABLE' : treeReconciled ? 'MATCH' : 'MISMATCH',
      treeOnlyCount: treeOnlyObjects.length,
      mainViewportOnlyCount: sceneOnlyObjects.length,
      duplicateEditorIds,
    },
    scenarioMatches,
    records,
    treeOnly: treeOnlyObjects.map(({ item, object }) => ({ id: objectId(item, object), name: String(item?.name || object.name || 'Unnamed Object') })),
    mainViewportOnly: sceneOnlyObjects.map(object => ({ id: objectId(null, object), name: String(object.name || object.type || 'Unnamed Object') })),
  };
}

export function formatSceneVerificationReport(snapshot) {
  if (!snapshot) return '[SCENE VERIFICATION]\nStatus: UNAVAILABLE\nNo snapshot was supplied.';
  const lines = [
    '[SCENE VERIFICATION]',
    'Reference Test Profile: ' + snapshot.testProfile,
    'Expected: ' + snapshot.expected.directionalLights + ' Directional Lights + ' + snapshot.expected.cubes + ' Cube(s)',
    'Scene Tree List: ' + (snapshot.available.sceneTree ? 'AVAILABLE' : 'UNAVAILABLE') +
      ' · items=' + snapshot.sceneTree.totalItems +
      ' · Directional Lights=' + snapshot.sceneTree.directionalLights +
      ' · Cubes=' + snapshot.sceneTree.cubes,
    '3D Scene MainViewport: ' + (snapshot.available.scene ? 'AVAILABLE' : 'UNAVAILABLE') +
      ' · editor objects=' + snapshot.mainViewport.editorObjects +
      ' · Directional Lights=' + snapshot.mainViewport.directionalLights +
      ' · Cubes=' + snapshot.mainViewport.cubes,
    'Tree ↔ MainViewport Identity Reconciliation: ' + snapshot.reconciliation.status +
      ' · Tree-only=' + snapshot.reconciliation.treeOnlyCount +
      ' · MainViewport-only=' + snapshot.reconciliation.mainViewportOnlyCount +
      ' · Duplicate editor IDs=' + snapshot.reconciliation.duplicateEditorIds.length,
    'Reference Scenario Match: ' + (snapshot.scenarioMatches ? 'YES' : 'NO / NOT VERIFIED'),
    'Renderer counters: draw calls=' + (snapshot.mainViewport.renderCalls ?? 'unavailable') +
      ' · triangles=' + (snapshot.mainViewport.triangles ?? 'unavailable'),
    'Render evidence note: Scene membership and visibility are recorded separately from per-object draw or per-light shader contribution; those are not inferred from object presence.',
    '',
    '[OBJECT-BY-OBJECT RECORDS]',
    ...snapshot.records.map(record =>
      record.id + ' | ' + record.name + ' | ' + record.kind +
      ' | SCENE_TREE=' + (record.sceneTreePresent ? 'PRESENT' : 'MISSING') +
      ' | MAINVIEWPORT=' + (record.mainViewportPresent ? 'PRESENT' : 'MISSING') +
      ' | VISIBLE=' + (record.visible ? 'YES' : 'NO') +
      ' | CAMERA_LAYER=' + (record.cameraLayerMatch === null ? 'UNKNOWN' : record.cameraLayerMatch ? 'MATCH' : 'NO_MATCH') +
      ' | RENDER=' + record.renderStatus
    ),
  ];
  if (snapshot.treeOnly.length) {
    lines.push('', '[TREE-ONLY OBJECTS]', ...snapshot.treeOnly.map(item => item.id + ' | ' + item.name));
  }
  if (snapshot.mainViewportOnly.length) {
    lines.push('', '[MAINVIEWPORT-ONLY EDITOR OBJECTS]', ...snapshot.mainViewportOnly.map(item => item.id + ' | ' + item.name));
  }
  if (snapshot.reconciliation.duplicateEditorIds.length) {
    lines.push('', '[DUPLICATE EDITOR IDS]', ...snapshot.reconciliation.duplicateEditorIds.map(item => item.id + ' | count=' + item.count));
  }
  return lines.join('\n');
}

export function buildSceneVerificationMetadata(snapshot) {
  if (!snapshot) return {
    sceneVerificationStatus: 'UNAVAILABLE',
    sceneTestProfile: RDS_SCENE_TEST_PROFILE.name,
  };
  return {
    sceneVerificationStatus: snapshot.reconciliation.status,
    sceneTestProfile: snapshot.testProfile,
    expectedDirectionalLights: snapshot.expected.directionalLights,
    expectedCubes: snapshot.expected.cubes,
    sceneTreeItems: snapshot.sceneTree.totalItems,
    sceneTreeDirectionalLights: snapshot.sceneTree.directionalLights,
    sceneTreeCubes: snapshot.sceneTree.cubes,
    mainViewportEditorObjects: snapshot.mainViewport.editorObjects,
    mainViewportDirectionalLights: snapshot.mainViewport.directionalLights,
    mainViewportCubes: snapshot.mainViewport.cubes,
    treeOnlyObjects: snapshot.reconciliation.treeOnlyCount,
    mainViewportOnlyObjects: snapshot.reconciliation.mainViewportOnlyCount,
    duplicateEditorIdCount: snapshot.reconciliation.duplicateEditorIds.length,
    referenceScenarioMatches: snapshot.scenarioMatches,
    rendererDrawCalls: snapshot.mainViewport.renderCalls,
    rendererTriangles: snapshot.mainViewport.triangles,
    sceneVerificationSummary: 'SCList ' + snapshot.sceneTree.directionalLights + ' Directional Lights/' +
      snapshot.sceneTree.cubes + ' Cube(s); MainViewport ' + snapshot.mainViewport.directionalLights +
      ' Directional Lights/' + snapshot.mainViewport.cubes + ' Cube(s); reconciliation=' +
      snapshot.reconciliation.status + '; reference profile=' + snapshot.testProfile,
  };
}
