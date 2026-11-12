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
  assert.match(source, /target\.userData\.nexusQuadGrid === true \|\| \(target\.userData\.kind === 'Cube' && Boolean\(geometry\.index\)\)/);
  assert.match(source, /including extruded quad side walls/);
  assert.match(source, /!geometry\.index && target\.userData\.nexusQuadGrid === true/);
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


test('Built-in non-Cube primitives are marked quad-grid only after a complete triangle-pair conversion', () => {
  assert.match(source, /const buildPrimitiveQuadGrid = \(sourceGeometry: THREE\.BufferGeometry\) => \{/);
  assert.match(source, /if \(pairedCount !== triangles\.length \|\| !outputPositions\.length\) return null;/);
  assert.match(source, /if \(kind !== 'Cube'\) \{/);
  assert.match(source, /if \(kind !== 'Cube' && geometry\.userData\.nexusPrimitiveQuadGrid === true\)/);
  assert.match(source, /result\.userData\.nexusPrimitiveQuadGrid = true/);
});

test('Primitive quad conversion preserves UV coordinates and emits the editor six-vertex quad layout', () => {
  assert.match(source, /outputUvs\.push\(\.\.\.adjustedUvs\[cornerIndex\]\)/);
  assert.match(source, /\[0, 1, 2, 0, 2, 3\]\.forEach\(cornerIndex =>/);
  assert.match(source, /result\.computeVertexNormals\(\)/);
  assert.match(source, /obj\.userData\.nexusQuadGrid = true/);
});


test('Sphere primitives use a pole-safe six-face quad grid instead of triangle-fan pairing', () => {
  assert.match(source, /const buildSphereQuadGrid = \(radius: number, divisions = 16\)/);
  assert.match(source, /kind === 'Sphere' \? buildSphereQuadGrid\(0\.68\) : buildPrimitiveQuadGrid\(geometry\)/);
  assert.match(source, /result\.userData\.nexusPrimitiveQuadGrid = true/);
  assert.match(source, /const outward = corners\[1\]\.clone\(\)\.sub\(corners\[0\]\)\.cross\(corners\[3\]\.clone\(\)\.sub\(corners\[0\]\)\)\.dot\(corners\[0\]\)/);
});


test('Primitive quad pairing respects hard-normal seams and preserves source normals', () => {
  assert.match(source, /const normal = source\.getAttribute\('normal'\)/);
  assert.match(source, /normalA\.dot\(otherA\) < 0\.65 \|\| normalB\.dot\(otherB\) < 0\.65/);
  assert.match(source, /outputNormals\.push\(\.\.\.corners\[cornerIndex\]\.normal\)/);
  assert.match(source, /if \(normal\) result\.setAttribute\('normal', new THREE\.Float32BufferAttribute\(outputNormals, 3\)\)/);
});
