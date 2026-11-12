import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');

test('Face Mode pointer handler reads the current tool through a ref', () => {
  assert.match(source, /if \(activeEditToolRef\.current === 'Cutting'\)/);
  assert.match(source, /const setEditTool = \(tool: .*activeEditToolRef\.current = tool; setActiveEditTool\(tool\)/);
});

test('Extrude depth is rebuilt from its pre-extrusion geometry snapshot', () => {
  assert.match(source, /extrudeBaseGeometry\.current = target\.geometry\.clone\(\)/);
  assert.match(source, /useExtrudeBaseline \? extrudeBaseGeometry\.current!\.clone\(\)/);
  assert.match(source, /extrudeHistoryUpdate\.current\(after, afterCutLoops\)/);
  assert.match(source, /onPointerUp=\{\(\) => applyGeometryTool\('Extrude', editAmount, undefined, true\)\}/);
});

test('Loop Cut slider commits once on release rather than every input tick', () => {
  assert.match(source, /onPointerUp=\{\(\) => \{ const context = loopCutContext\.current/);
  assert.doesNotMatch(source, /onChange=\{e => \{ const amount = Number\(e\.target\.value\); setEditAmount\(amount\); const context = loopCutContext\.current/);
});

test('Pointer cancellation and window blur restore both orbit controllers', () => {
  assert.match(source, /orbit\.enabled = orbitBeforeLoopCut;\s*activeOrbit\.enabled = activeOrbitBeforeLoopCut;/);
  assert.match(source, /if \(loopCutGesture\) \{ loopCutGesture = null; pointerStart = null; clearLoopCutPreview\(\); orbit\.enabled = orbitBeforeLoopCut; activeOrbit\.enabled = activeOrbitBeforeLoopCut; \}/);
});

test('Geometry operations detach the gizmo when the active sub-selection is cleared', () => {
  assert.match(source, /runtime\.current\?\.clearSubSelection\?\.\(\); const gizmo = runtime\.current\?\.transform; if \(gizmo\) \{ gizmo\.detach\(\); gizmo\.enabled = false; gizmo\.getHelper\(\)\.visible = false; \}/);
});


test('IK viewport selection handler is isolated from MainViewport taps', () => {
  assert.match(source, /const onIKPointerDown = \(event: PointerEvent\) => \{ if \(!runtime\.current\?\.riggingView \|\| !ikOrbit\.enabled\)/);
  assert.match(source, /const onIKPointerUp = \(event: PointerEvent\) => \{\s*if \(!runtime\.current\?\.riggingView \|\| !ikOrbit\.enabled\)/);
});

test('IK pointercancel listener is named and removed during runtime cleanup', () => {
  assert.match(source, /const onIKPointerCancel = \(\) => \{ ikTapStart = null; \}/);
  assert.match(source, /removeEventListener\('pointercancel', onIKPointerCancel\)/);
  assert.doesNotMatch(source, /addEventListener\('pointercancel', \(\) => \{ ikTapStart = null; \}\)/);
});

test('runtime API object is registered once before the render loop', () => {
  const registration = source.indexOf('runtime.current = { ...(runtime.current || {}), scene, camera');
  const loop = source.indexOf('const frameLoop = () => {');
  assert.ok(registration >= 0 && loop > registration, 'runtime API must be registered before the RAF callback');
  assert.doesNotMatch(source.slice(loop), /runtime.current = \{ \...\(runtime.current \|\| \{\}\), scene, camera/);
});

test('runtime cleanup releases the renderer reference', () => {
  assert.match(source, /if \(runtime\.current\?\.renderer === renderer\) runtime\.current = null;/);
});


test('Manual rig bone deletion is undoable and rebuilds the SkeletonHelper', () => {
  const start = source.indexOf('const deleteSelectedBone = () => {');
  const end = source.indexOf("transform.addEventListener('objectChange'", start);
  assert.ok(start >= 0 && end > start, 'deleteSelectedBone implementation must exist');
  const block = source.slice(start, end);
  assert.match(block, /const chainSnapshots = rigChains\.filter\(chain => chain\.bones\.includes\(bone\)\)/);
  assert.match(block, /childBones\.forEach\(child => parent\.attach\(child\)\)/);
  assert.match(block, /childBones\.forEach\(child => bone\.attach\(child\)\)/);
  assert.match(block, /rebuildRigHelper\(chain\)/);
  assert.match(block, /recordSceneAction\(/);
  assert.match(block, /undo: restoreDelete/);
  assert.match(block, /redo: applyDelete/);
});


test('Deleting a rig owner or root preserves IK handles and rig-chain state for Undo', () => {
  assert.match(source, /const captureRigStateFor = \(obj: THREE\.Object3D\) => \{/);
  assert.match(source, /const restoreRigState = \(snapshots: ReturnType<typeof captureRigStateFor>\)/);
  assert.match(source, /target: chain\.target \|\| null,[\s\S]*pole: chain\.pole \|\| null/);
  assert.match(source, /if \(!rigChains\.includes\(chain\)\) rigChains\.push\(chain\)/);
  assert.equal((source.match(/r\.captureRigStateFor\?\.\(obj\)/g) || []).length, 2);
  assert.equal((source.match(/r\.restoreRigState\?\.\(rigSnapshot\)/g) || []).length, 2);
});

test('New Modeling Workspace replaces the legacy panel presentation without deleting tool handlers', () => {
  assert.match(source, /nexus-modeling-workspace/);
  assert.match(source, /MODELING WORKSPACE/);
  assert.match(source, /ACTIVE OBJECT/);
  assert.match(source, /LIVE MESH EDITOR/);
  assert.match(source, /FACE OPERATIONS/);
  for (const tool of ['Extrude', 'Subdivide', 'Smooth', 'Loop Cut']) {
    assert.ok(source.includes("'" + tool + "'") || source.includes('"' + tool + '"'), tool + ' action must remain wired');
  }
  assert.match(source, /Select a face before Loop Cut/);
  assert.match(source, /requires a highlighted mesh component/);
});

test('Subdivide fails closed when the current mesh has no verified quad topology', () => {
  assert.match(source, /target\.userData\.kind === 'Cube' && \(geometry\.index \|\| target\.userData\.nexusQuadGrid === true\)/);
  assert.match(source, /Fail closed for meshes without a verified quad-cell topology/);
  assert.match(source, /No triangles were split and the original mesh was preserved/);
  assert.doesNotMatch(source, /const triangleCount = sourcePosition\.count \/ 3/);
  assert.doesNotMatch(source, /genericSubdivideApplied/);
});

test('Subdivide blocks skinned and morph-target meshes before geometry mutation', () => {
  assert.match(source, /target instanceof THREE\.SkinnedMesh/);
  assert.match(source, /Boolean\(target\.geometry\.getAttribute\('skinIndex'\)\)/);
  assert.match(source, /Boolean\(target\.geometry\.getAttribute\('skinWeight'\)\)/);
  assert.match(source, /Object\.values\(target\.geometry\.morphAttributes\)/);
  assert.match(source, /tool === 'Subdivide' && \(hasSkinning \|\| hasMorphTargets\)/);
  assert.match(source, /No mesh, bones, weights, or animation data was changed/);
});
