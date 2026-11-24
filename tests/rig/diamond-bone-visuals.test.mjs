import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');

test('manual rig visuals use compact spherical bone icons', () => {
  assert.match(app, /createSphereBoneGeometry/);
  assert.match(app, /nexusSphereBoneGeometry/);
  assert.match(app, /new THREE\.SphereGeometry\(0\.025, 12, 8\)/);
  assert.match(app, /Sphere Bone/);
  assert.doesNotMatch(app, /createBlenderOctahedralBoneGeometry/);
  assert.doesNotMatch(app, /nexusBlenderBoneGeometry/);
});

test('bone colors distinguish root, child, selected, detached, and locked states', () => {
  assert.match(app, /new THREE\.Color\('#579bce'\)/);
  assert.match(app, /if \(bone\.userData\.locked\) return '#ff4d64'/);
  assert.match(app, /if \(bone === active\) return '#00e5ff'/);
  assert.match(app, /bone\.userData\.detached\) return '#a879ff'/);
  assert.ok(app.includes("return bone.userData.rigRole === 'root' || !(bone.parent as any)?.isBone ? '#ffb547' : '#35d7ff'"));
});

test('control handles use a high-visibility orange material and scalable sphere marker', () => {
  assert.match(app, /new THREE\.SphereGeometry\(0\.07, 16, 12\)/);
  assert.match(app, /new THREE\.MeshBasicMaterial\(\{ color: '#ffb52e', depthTest: false, depthWrite: false/);
  assert.match(app, /marker\.renderOrder = 10000/);
  assert.match(app, /marker\.frustumCulled = false/);
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
  assert.match(app, /if \(chain\.pole && bones\.length > poleMiddleIndex\)/);
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


test('locked bones remain selectable and permit Rotate only, not Move or Scale', () => {
  const selectionStart = app.indexOf('const selectObject = (obj?: THREE.Object3D)');
  const selectionEnd = app.indexOf('const addObject =', selectionStart);
  const selection = app.slice(selectionStart, selectionEnd);
  assert.match(selection, /const lockedBone = obj instanceof THREE\.Bone && isIkBoneLocked\(obj\)/);
  assert.match(selection, /const canTransform = \(objectMode \|\| isControlHandle\) && \(!lockedBone \|\| \(objectMode && modeRef\.current === 'rotate'\)\)/);
  assert.match(selection, /transform\.attach\(obj\)/);
  assert.doesNotMatch(selection, /selectionLocked[^\n]*lockedBone/);

  const modeStart = app.indexOf('const runMode = (next:');
  const modeEnd = app.indexOf('const setAxisSpace =', modeStart);
  const mode = app.slice(modeStart, modeEnd);
  assert.match(mode, /!lockedBone \|\| \(editModeRef\.current === 'Object' && next === 'rotate'\)/);
  assert.match(mode, /if \(!canTransform && transform\.object === selectedObject\) transform\.detach\(\)/);
});


test('dragging an unlocked child Control Handle automatically solves its connected IK chain', () => {
  assert.match(app, /activeControl\?\.userData\.rigControlMarker && !activeControl\.userData\.controlLocked/);
  assert.match(app, /controlOwnerBoneId/);
  assert.match(app, /activeIkSpring/);
  assert.match(app, /solveIK\(activeIkSpring\.chainLength, activeIkSpring\.current\)/);
  assert.match(app, /controlHandle\.userData\.controlOwnerBoneId/);
  assert.match(app, /const targetPosition = controlTarget \? controlTarget\.clone\(\)/);
});

test('IK solver treats the deepest locked bone as a fixed anchor', () => {
  const solverStart = app.indexOf('const solveIK =');
  const solverEnd = app.indexOf('const captureRigStateFor', solverStart);
  const solver = app.slice(solverStart, solverEnd);
  assert.match(app, /getIkSolvePath, isIkBoneLocked/);
  assert.match(solver, /getIkSolvePath\(path\.reverse\(\), chainLength\)/);
  assert.match(solver, /const anchorLocked = isIkBoneLocked\(bones\[0\]\)/);
  assert.equal((solver.match(/if \(isIkBoneLocked\(bone\)\) continue;/g) || []).length, 2);
  assert.match(solver, /const poleBoneIndex = anchorLocked \? 1 : 0/);
  assert.match(solver, /if \(!isIkBoneLocked\(rootBone\)\)/);
});

test('spring-driven IK updates attached skinned mesh through the shared skeleton', () => {
  assert.match(app, /const skeleton = new THREE\.Skeleton\(chain\.bones\)/);
  assert.match(app, /skinned\.bind\(skeleton, skinned\.matrixWorld\.clone\(\)\)/);
  assert.match(app, /activeIkSpring/);
  assert.match(app, /solveIK\(activeIkSpring\.chainLength, activeIkSpring\.current\)/);
});


test('Manual IK spring is optional and adjustable independently from direct IK', () => {
  assert.match(app, /let ikSpringConfig = \{ enabled: false, strength: 35, damping: 75, followThrough: 40 \}/);
  assert.match(app, /const configureIkSpring = \(next: Partial<typeof ikSpringConfig>\)/);
  assert.match(app, /if \(!ikSpringConfig\.enabled\) \{\s*activeIkSpring = null;\s*solveIK\(chainLength, targetWorld\);/);
  assert.match(app, /const strength = 8 \+ ikSpringConfig\.strength \* 0\.52/);
  assert.match(app, /const damping = 4 \+ ikSpringConfig\.damping \* 0\.18/);
  assert.match(app, /aria-label="Manual IK Spring Effect settings"/);
  assert.match(app, /aria-label="Spring Strength"/);
  assert.match(app, /aria-label="Spring Damping"/);
  assert.match(app, /aria-label="Spring Follow-through"/);
  assert.match(css, /\.ik-spring-panel/);
});


test('Control Handles are independent Scene-root objects linked by owner bone ID and adjustable outward from the rig', () => {
  assert.match(app, /marker\.userData\.controlOwnerBoneId = String\(bone\.userData\.editorId\)/);
  assert.match(app, /scene\.add\(marker\)/);
  assert.match(app, /selectable\.push\(marker\)/);
  assert.match(app, /configureControlHandleDistance/);
  assert.match(app, /distance \/ 100/);
  assert.match(app, /controlOwnerBoneId\)\) as THREE\.Bone/);
  assert.match(app, /aria-label="Control Handle distance settings"/);
  assert.match(app, /aria-label="Control Handle distance"/);
});


test('Control Handles remain editable through shared lock-aware transform gating', () => {
  const selectionStart = app.indexOf('const selectObject = (obj?: THREE.Object3D)');
  const selectionEnd = app.indexOf('const addObject =', selectionStart);
  const selection = app.slice(selectionStart, selectionEnd);
  assert.match(selection, /const isControlHandle = Boolean\(obj\.userData\.rigControlMarker\)/);
  assert.match(selection, /const canTransform = \(objectMode \|\| isControlHandle\)/);
  assert.match(selection, /transform\.attach\(obj\)/);
  assert.match(selection, /transform\.enabled = true/);
  assert.match(selection, /transform\.getHelper\(\)\.visible = true/);

  const modeStart = app.indexOf('const runMode = (next:');
  const modeEnd = app.indexOf('const setAxisSpace =', modeStart);
  const mode = app.slice(modeStart, modeEnd);
  assert.match(mode, /editingSubObject \|\| isControlHandle/);
  assert.match(mode, /transform\.enabled = canTransform/);
  assert.match(mode, /transform\.getHelper\(\)\.visible = canTransform/);
});


test('Control Handles render and raycast in both viewports independent of rig scale', () => {
  assert.match(app, /marker\.visible = true/);
  assert.match(app, /marker\.layers\.enableAll\(\)/);
  assert.match(app, /marker\.frustumCulled = false/);
  assert.match(app, /marker\.scale\.setScalar\(placement\.radius \/ 0\.07\)/);
  assert.match(app, /THREE\.MathUtils\.clamp\(segmentLength \* 0\.14, 0\.05, 0\.3\)/);
  assert.match(app, /scene\.worldToLocal\(worldPosition\.clone\(\)\)/);
  assert.match(app, /const visibleControlHandles = selectable\.filter\(object => object\.userData\.rigControlMarker && object\.visible\)/);
  assert.match(app, /const roots = \[\.\.\.selectable\.filter\(object => object\.visible\), \.\.\.visibleHelpers\]/);
});

test('each Control Handle retains exact Child Bone and rig-root identity for multiple rigs', () => {
  assert.match(app, /marker\.userData\.controlOwnerBoneId = String\(bone\.userData\.editorId\)/);
  assert.match(app, /marker\.userData\.controlOwnerRigRootId = String\(placement\.rigRootBoneId \|\| ''\)/);
  assert.match(app, /const chain = resolveRigChainForObject\(owner\)/);
  assert.match(app, /const owner = selectable\.find\(object => object instanceof THREE\.Bone && String\(object\.userData\.editorId\) === String\(marker\.userData\.controlOwnerBoneId\)\)/);
});

test('orange Control Handle Rotate mode applies incremental orientation to its exact unlocked owner bone', () => {
  assert.match(app, /placeControlHandleAtBone\(marker, bone, placement\)/);
  assert.match(app, /marker\.userData\.controlLastWorldQuaternion = marker\.getWorldQuaternion\(new THREE\.Quaternion\(\)\)\.toArray\(\)/);
  assert.match(app, /controlLastWorldQuaternion/);
  assert.match(app, /if \(transform\.getMode\(\) === 'rotate'\)/);
  assert.match(app, /const rotationDelta = currentHandleWorld\.clone\(\)\.multiply\(previousHandleWorld\.clone\(\)\.invert\(\)\)/);
  assert.match(app, /!isIkBoneLocked\(ownerBone\)/);
  assert.match(app, /ownerBone\.quaternion\.copy\(parentWorld\.invert\(\)\.multiply\(desiredOwnerWorld\)\)\.normalize\(\)/);
  assert.match(app, /else if \(transform\.getMode\(\) === 'translate'\)/);
});

test('bone joint spheres and hierarchy lines use reduced visual emphasis', () => {
  assert.match(app, /new THREE\.SphereGeometry\(0\.025, 12, 8\)/);
  assert.match(app, /material\.opacity = 0\.68/);
  assert.match(app, /material\.linewidth = 1/);
});


test('selected orange Control Handle gets a transparent square with white outline, hidden and disposed on deselection', () => {
  const frameStart = app.indexOf('const updateControlHandleSelectionFrame =');
  const frameEnd = app.indexOf('const selectObject =', frameStart);
  const frame = app.slice(frameStart, frameEnd);
  assert.match(frame, /obj\?\.userData\?\.rigControlMarker/);
  assert.match(frame, /new THREE\.BoxGeometry\(0\.24, 0\.24, 0\.24\)/);
  assert.match(frame, /opacity: 0\.035/);
  assert.match(frame, /new THREE\.EdgesGeometry\(new THREE\.BoxGeometry/);
  assert.match(frame, /color: '#ffffff'/);
  assert.match(frame, /opacity: 0\.98/);
  assert.match(frame, /node\.raycast = \(\) => \{\}/);
  assert.match(frame, /previousFrame\.parent\?\.remove\(previousFrame\)/);
  assert.match(app.slice(app.indexOf('const selectObject ='), app.indexOf('const addObject =')), /updateControlHandleSelectionFrame\(obj\)/);
  assert.match(frame, /nexusControlHandleSelectionFrame/);
});


test('Control Handles created before Shape attachment are reparented to the rig owner and remain selectable in Scene Tree', () => {
  const attachStart = app.indexOf('const attachRootToShape =');
  const attachEnd = app.indexOf('const copySelectedBone =', attachStart);
  const attach = app.slice(attachStart, attachEnd);
  assert.match(attach, /chainBoneIds\.has\(String\(object\.userData\.controlOwnerBoneId \|\| ''\)\)/);
  assert.match(attach, /owner\.attach\(marker\)/);
  assert.match(attach, /marker\.visible = true/);
  assert.match(attach, /marker\.updateMatrixWorld\(true\)/);
  assert.match(attach, /syncItems\(\)/);

  const treeStart = app.indexOf("items.filter(item => {");
  const treeEnd = app.indexOf("}).map(item => {", treeStart);
  const tree = app.slice(treeStart, treeEnd);
  assert.match(tree, /item\.name\.toLowerCase\(\)/);
  const rowStart = app.indexOf("className={'tree-item ' + (selected === item.id ? 'selected' : '')}");
  assert.ok(rowStart >= 0, 'Scene Tree exposes selectable rows for all synchronized items');
  const row = app.slice(rowStart, app.indexOf('</button>}', rowStart));
  assert.match(row, /runtime\.current\?\.selectObject\(item\.object\)/);
});
