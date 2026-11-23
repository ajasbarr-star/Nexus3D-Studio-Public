import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');

test('manual rig visuals use compact Blender-style octahedral bone geometry', () => {
  assert.match(app, /createBlenderOctahedralBoneGeometry/);
  assert.match(app, /nexusBlenderBoneGeometry/);
  assert.match(app, /visual\.scale\.set\(0\.052, length \* 0\.5, 0\.052\)/);
  assert.match(app, /Octahedral Bone/);
  assert.doesNotMatch(app, /new THREE\.SphereGeometry\(0\.06, 14, 10\)/);
});

test('bone colors distinguish root, child, selected, detached, and locked states', () => {
  assert.match(app, /if \(bone\.userData\.locked\) return '#ff4d64'/);
  assert.match(app, /if \(bone === active\) return '#ffffff'/);
  assert.match(app, /bone\.userData\.detached\) return '#a879ff'/);
  assert.match(app, /\? '#00d9ff' : '#36c2a0'/);
});

test('control handles use the dedicated orange color', () => {
  assert.match(app, /new THREE\.SphereGeometry\(0\.055, 12, 10\), new THREE\.MeshBasicMaterial\(\{ color: '#ffb52e'/);
});

test('compact Manual IK toolbar exposes root, child, attach, bind, handle, lock, rig detection, IK, mirror and visibility actions', () => {
  for (const action of ['Create Root Bone', 'Create Child Bone', 'Attach Root to Shape', 'Set selected Bone as Object Parent', 'Attach selected Shape or Object to the chosen Bone', 'Detach selected Object from its Rig Parent', 'Bind Mesh to Rig', 'Create Control Handle', 'Lock or Unlock Bone', 'Detect Existing Rig', 'Create IK Target', 'Create IK Pole', 'Solve Manual IK', 'Mirror Selected Bone', 'Show or Hide Bone Chain']) {
    assert.ok(app.includes(action), `missing toolbar action: ${action}`);
  }
  assert.match(css, /\.ik-rig-actions\{[^}]*display:grid/);
  assert.match(css, /grid-template-columns:repeat\(5,40px\)/);
  assert.match(css, /\.ik-rig-actions button span/);
  assert.match(app, /<span>HANDLE<\/span>/);
});


test('manual child creation supports selecting the owning Shape after root attachment', () => {
  assert.match(app, /const parentBone = selectedObject instanceof THREE\.Bone/);
  assert.match(app, /object\.userData\.rigRole === 'root'/);
  assert.match(app, /Attach the Root Bone to its Shape before adding Child Bones/);
  assert.match(app, /parentBone\.add\(child\)/);
});

test('IK target and pole resolve the selected rig instead of falling back to the last rig', () => {
  assert.match(app, /const resolveRigChainForObject = \(object\?: THREE\.Object3D\)/);
  assert.match(app, /const activeChain = resolveRigChainForObject\(selectedObject\)/);
  assert.match(app, /const chain = resolveRigChainForObject\(selectedObject\)/);
  assert.match(app, /target\.userData\.rigRootBoneId = activeChain\.bones\[0\]/);
  assert.match(app, /target\.userData\.ikEndBoneId = endBone\.userData\.editorId/);
});

test('pole handles are reused per rig and solver honors the selected rig association', () => {
  assert.match(app, /let target = chain\.pole as THREE\.Mesh \| null/);
  assert.match(app, /if \(chain\.pole && bones\.length >= 3\)/);
});

test('imported skeleton connection lines participate in bone-chain visibility', () => {
  assert.match(app, /chain\.helper\.visible = chain\.displayVisible !== false/);
  assert.match(app, /const toggleSelectedRigDisplay = \(\) =>/);
  assert.match(app, /toggleSelectedRigDisplay, restoreRigGroup/);
});

test('control-handle lock action is reachable through the shared lock tool', () => {
  assert.match(app, /if \(bone\?\.userData\.rigControlMarker\) return toggleSelectedControlLock\(\)/);
});

test('Manual root creation stays unattached until the separate Attach to Shape action', () => {
  const start = app.indexOf("const addUniversalBone = (mode: 'root' | 'child' = 'root')");
  const end = app.indexOf('const attachRootToShape = () =>', start);
  assert.ok(start >= 0 && end > start, 'Manual IK root and attach handlers must both exist');
  const rootHandler = app.slice(start, end);
  assert.match(rootHandler, /anchor\.userData\.pendingShapeAttachment = true/);
  assert.match(rootHandler, /scene\.add\(anchor\)/);
  assert.match(rootHandler, /setStatus\('Root Bone created at Shape center · Not attached · Use Attach to Shape'\)/);
  assert.doesNotMatch(rootHandler, /attachRootToShape\s*\(/);
  assert.match(app, /const attachRootToShape = \(\) =>/);
});


test('locked bones cannot be directly moved with gizmo but remain available to IK solver', () => {
  const selectionStart = app.indexOf('const selectObject = (obj?: THREE.Object3D)');
  const selectionEnd = app.indexOf('const addObject =', selectionStart);
  const selection = app.slice(selectionStart, selectionEnd);
  assert.match(selection, /obj instanceof THREE\.Bone && obj\.userData\.locked/);
  const solverStart = app.indexOf('const solveIK =');
  const solverEnd = app.indexOf('const captureRigStateFor', solverStart);
  const solver = app.slice(solverStart, solverEnd);
  assert.doesNotMatch(solver, /userData\.locked/);
});

test('dragging an unlocked child Control Handle automatically solves its connected IK chain', () => {
  assert.match(app, /activeControl\?\.userData\.rigControlMarker && !activeControl\.userData\.controlLocked/);
  assert.match(app, /const ownerBone = activeControl\.parent instanceof THREE\.Bone/);
  assert.match(app, /activeIkSpring/);
  assert.match(app, /solveIK\(activeIkSpring\.chainLength, activeIkSpring\.current\)/);
  assert.match(app, /activeControl\?\.userData\.rigControlMarker/);
  assert.match(app, /const controlBone = controlHandle\?\.parent instanceof THREE\.Bone/);
  assert.match(app, /const targetPosition = controlTarget \? controlTarget\.clone\(\)/);
});

test('bone locks restrict direct gizmo editing but do not block IK-driven hierarchy rotation', () => {
  const solverStart = app.indexOf('const solveIK =');
  const solverEnd = app.indexOf('const captureRigStateFor', solverStart);
  const solver = app.slice(solverStart, solverEnd);
  assert.doesNotMatch(solver, /bone\.userData\.locked\s*\)\s*continue/);
  assert.doesNotMatch(solver, /if\s*\(!rootBone\.userData\.locked\)/);
  assert.match(app, /obj instanceof THREE\.Bone && obj\.userData\.locked/);
});

test('spring-driven IK updates attached skinned mesh through the shared skeleton', () => {
  assert.match(app, /const skeleton = new THREE\.Skeleton\(chain\.bones\)/);
  assert.match(app, /skinned\.bind\(skeleton, skinned\.matrixWorld\.clone\(\)\)/);
  assert.match(app, /activeIkSpring/);
  assert.match(app, /solveIK\(activeIkSpring\.chainLength, activeIkSpring\.current\)/);
});
