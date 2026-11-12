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
  assert.match(source, /applyGeometryTool\(tool, tool === 'Extrude' \? 0 : cutAmount\)/);
  assert.match(source, /Extrude ready · use Move \/ Rotate \/ Scale on the selected cap/);
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
  assert.match(source, /Face tap accepted · selecting face/);
  assert.match(source, /FIRST FACE LOCKED/);
  assert.match(source, /DUAL FACES LOCKED/);
  assert.match(source, /tap the opposite face/);
  assert.doesNotMatch(source, /heldForMs < 420/);
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


test('Generated Sphere quad grid uses radial smooth normals for non-indexed cells', () => {
  assert.match(source, /const positions: number\[\] = \[\], uvs: number\[\] = \[\], normals: number\[\] = \[\]/);
  assert.match(source, /const smoothNormal = p\.clone\(\)\.normalize\(\)/);
  assert.match(source, /normals\.push\(smoothNormal\.x, smoothNormal\.y, smoothNormal\.z\)/);
  assert.match(source, /result\.setAttribute\('normal', new THREE\.Float32BufferAttribute\(normals, 3\)\)/);
});


test('Primitive triangle pairing orders the quad around the shared diagonal without exposing it as a border', () => {
  assert.match(source, /const corners = \[edgeA, opposite, edgeB, remaining\]/);
  assert.doesNotMatch(source, /const corners = \[edgeA, edgeB, opposite, remaining\]/);
});


test('Primitive quad reconstruction prefers the longest shared diagonal over outer cell edges', () => {
  assert.match(source, /const edgeLength = \(a: number, b: number\) =>/);
  assert.match(source, /sharedLength: edgeLength\(triangle\.indices\[edge\], triangle\.indices\[\(edge \+ 1\) % 3\]\)/);
  assert.match(source, /candidates\.sort\(\(a, b\) => b\.sharedLength - a\.sharedLength\)/);
});


test('Repeated Extrude preserves the verified quad-grid marker and emits six-vertex side-wall cells', () => {
  assert.match(source, /const beforeQuadGridState = captureQuadGridState\(\)/);
  assert.match(source, /const afterQuadGridState = tool === 'Subdivide'[\s\S]*: captureQuadGridState\(\)/);
  assert.match(source, /restoreQuadGridState\(afterQuadGridState\)/);
  assert.match(source, /\[a, b, bn, a, bn, an\]\.forEach\(v => data\.push\(v\.x, v\.y, v\.z\)\)/);
  assert.match(source, /source\.count % 6 !== 0/);
});

test('Quad topology marker and layout survive Nexus project save and load', () => {
  assert.match(source, /quadGrid: Boolean\(obj\.userData\.nexusQuadGrid\)/);
  assert.match(source, /quadGridLayout: obj\.userData\.nexusQuadGridLayout \|\| null/);
  assert.match(source, /if \(saved\.meshTopology\.quadGrid === true\)/);
  assert.match(source, /obj\.userData\.nexusQuadGridLayout = saved\.meshTopology\.quadGridLayout/);
});


test('Primitive quad pairing rejects folded and non-convex triangle pairs', () => {
  assert.match(source, /const convexTurns = \[/);
  assert.match(source, /const isConvex = perimeterNormal\.lengthSq\(\) > 1e-10/);
  assert.match(source, /convexTurns\.every\(turn => turn\.dot\(perimeterNormal\) > 1e-10\)/);
  assert.match(source, /currentNormal\.dot\(pairedNormal\) > 0\.65/);
});

test('Unsupported shape topology cancels without creating triangle subdivision lines', () => {
  assert.match(source, /else if \(tool === 'Subdivide'\) \{[\s\S]*?this mesh does not have verified quad topology[\s\S]*?No triangles were split/);
  assert.match(source, /Subdivide cancelled: this shape has no verified square-quad layout/);
});


test('Primitive quad UV coordinates remain continuous across U and V parameter seams', () => {
  assert.match(source, /const baseUvU = corners\[0\]\.uv\[0\], baseUvV = corners\[0\]\.uv\[1\]/);
  assert.match(source, /while \(u - baseUvU > 0\.5\) u -= 1/);
  assert.match(source, /while \(v - baseUvV > 0\.5\) v -= 1/);
  assert.match(source, /return \[u, v\]/);
});


test('Legacy triangle-clipping code is reserved for Loop Cut and cannot run for Subdivide', () => {
  assert.match(source, /else if \(tool === 'LoopCut'\) \{[\s\S]*?Loop Cut remains a separate operation/);
  assert.doesNotMatch(source, /else if \(tool === 'Subdivide' \|\| tool === 'LoopCut'\)/);
  assert.doesNotMatch(source, /Subdivide needs a mesh with valid triangles/);
});

test('Face Extrude reconstructs and verifies each triangle pair as a planar quad before enabling Subdivide', () => {
  assert.match(source, /let extrudeQuadGridVerified = false/);
  assert.match(source, /Reconstruct each existing pair of triangles as one canonical quad cell/);
  assert.match(source, /const triBMatchesWinding = triB\.some/);
  assert.match(source, /if \(!triBMatchesWinding\) \{ verified = false; break; \}/);
  assert.match(source, /extrudeQuadGridVerified = verified/);
  assert.match(source, /tool === 'Extrude'[\s\S]*enabled: extrudeQuadGridVerified/);
  assert.match(source, /Triangle pairs could not be reconstructed as verified planar quads/);
  assert.doesNotMatch(source, /canonicalFaceOrder/);
  assert.doesNotMatch(source, /canonicalCubeExtrude/);
});

test('Extruded side walls receive UVs and keep the verified quad topology stream', () => {
  assert.match(source, /const uvData: number\[\] \| null = uvAttribute \? Array\.from\(uvAttribute\.array as ArrayLike<number>\) : null/);
  assert.match(source, /if \(uvData\) geometry\.setAttribute\('uv', new THREE\.Float32BufferAttribute\(uvData, 2\)\)/);
  assert.match(source, /\[a, b, bn, a, bn, an\]\.forEach\(v => data\.push\(v\.x, v\.y, v\.z\)\)/);
});

test('RDS and RIT expose clickable icon-only actions while preserving live trace capture', () => {
  assert.match(source, /aria-label="Realtime Interaction Trace"/);
  assert.match(source, /'Interaction Trace'/);
  assert.match(source, /aria-label="Copy all RIT logs"/);
  assert.match(source, /aria-label="Clear all RIT logs"/);
  assert.match(source, /const clearInteractionTraceLogs = \(\) =>/);
  assert.match(source, /previous\.filter\(entry => entry\.source !== 'Interaction Trace'\)/);
  assert.match(source, /aria-label="Copy filtered RDS logs"/);
  assert.match(source, /aria-label="Copy all RDS logs"/);
  assert.match(source, /aria-label="Clear all RDS logs"/);
  assert.match(source, /aria-label="Show all logs"/);
  assert.match(source, /aria-label="Show errors"/);
  assert.match(source, /aria-label="Show warnings"/);
  assert.match(source, /aria-label="Show info logs"/);
  assert.match(source, /Viewport pointer down/);
  assert.match(source, /Scene Tree selection/);
  assert.match(source, /Geometry tool requested/);
});


test('Face Mode blocks expensive geometry operations above the mobile vertex safety limit', () => {
  assert.match(source, /const mobileGeometryVertexLimit = 65_536/);
  assert.match(source, /\(tool === 'Subdivide' \|\| tool === 'Smooth'\) && currentVertexCount > mobileGeometryVertexLimit/);
  assert.match(source, /blocked above mobile vertex limit/);
  assert.match(source, /const safeVertexBudget = 65_536/);
});


test('Subdivision topology overlay refreshes bounds and keeps quad grid lines visible', () => {
  assert.match(source, /mesh\.geometry\.computeBoundingSphere\(\);[\s\S]*?const bounds = mesh\.geometry\.boundingSphere/);
  assert.match(source, /const lineOffset = Math\.max\(0\.0012, \(bounds\?\.radius \|\| 1\) \* 0\.002\)/);
  assert.match(source, /color: 0x000000, transparent: false, opacity: 1, depthTest: true, depthWrite: false/);
});

test('Topology overlay offsets fallback hard edges outward after Extrude and keeps them depth-tested', () => {
  assert.match(source, /mesh\.geometry\.computeBoundingSphere\(\);[\s\S]*?const lineOffset = Math\.max\(0\.0012, \(bounds\?\.radius \|\| 1\) \* 0\.002\)/);
  assert.match(source, /new THREE\.EdgesGeometry\(mesh\.geometry, 1\)/);
  assert.match(source, /const normalSums = new Map<string, \{ normal: THREE\.Vector3; count: number \}>\(\)/);
  assert.match(source, /edgePosition\.setXYZ\(vertex, x \+ normal\.x \* lineOffset, y \+ normal\.y \* lineOffset, z \+ normal\.z \* lineOffset\)/);
  assert.match(source, /depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1/);
});


test('Dual Faces selection requires opposite faces and shares one transform pivot', () => {
  assert.match(source, /selectedFaceParts: number\[\]\[\]/);
  assert.match(source, /previousNormal\.dot\(currentNormal\) < -0\.8/);
  assert.match(source, /both faces share one transform pivot/);
  assert.match(source, /worldPivot\.copy\(mesh\.localToWorld\(pivotLocal\.clone\(\)\)\)/);
  assert.match(source, /previousLocalNormal\.applyMatrix3\(new THREE\.Matrix3\(\)\.getNormalMatrix\(hit\.object\.matrixWorld\)\)/);
  assert.match(source, /const faceHighlightColor = 0x00e5ff/);
  assert.match(source, /color: faceHighlightColor, side: THREE\.DoubleSide, transparent: true, opacity: 0\.42, depthTest: false/);
});

test('Dual Faces extrude inward together and Faces Cut removes opposing caps even when separated', () => {
  assert.match(source, /dualFaceExtrude = editModeRef\.current === 'Face' && selectedFaceParts\.length === 2/);
  assert.match(source, /inwardCenter\.clone\(\)\.sub\(tri\[0\]\.clone\(\)\.add\(tri\[1\]\)\.add\(tri\[2\]\)/);
  assert.match(source, /tool === 'FacesCut'/);
  assert.match(source, /hasBothOpposingCaps = capGroups\[0\]\.count >= 6 && capGroups\[1\]\.count >= 6/);
  assert.match(source, /Their centers do NOT need to touch/);
  assert.doesNotMatch(source, /capMeetTolerance/);
  assert.match(source, /Faces Cut rejected · opposing cap geometry not found/);
  assert.match(source, /Faces Cut committed/);
  assert.match(source, /\['Extrude', 'Subdivide', 'Smooth', 'Loop Cut', 'Faces Cut'\]/);
});


test('Face Extrude is available for one face and begins without automatic displacement', () => {
  assert.match(source, /faceParts\?\.length \|\| 0\) < 1/);
  assert.match(source, /applyGeometryTool\(tool, tool === 'Extrude' \? 0 : cutAmount\)/);
  assert.match(source, /const depth = Math\.max\(0, rawAmount \/ 100\) \* 0\.8/);
  assert.doesNotMatch(source, /Extrude is locked · hold and lock two opposite faces first/);
});

test('Extruded cap and side-wall upper corners follow Move, Rotate and Scale without moving the perimeter base', () => {
  assert.match(source, /linkedIndices\?: number\[\]/);
  assert.match(source, /const isolatedTransformIndices = selection\.linkedIndices/);
  assert.match(source, /extrudedWallCapIndices\.push\(wallStartIndex \+ 2, wallStartIndex \+ 4, wallStartIndex \+ 5\)/);
  assert.match(source, /restoreExtrudedFaceSelection\?\.\(target, extrudedCapIndices, selectedExtrudedFaceParts, extrudedWallCapIndices\)/);
  assert.match(source, /extrudeContext\.current = null/);
});

test('Extruded Single and Dual Face highlights follow the newly created cap geometry', () => {
  assert.match(source, /selectedFacePointKeySets = selectedFaceParts\.map/);
  assert.match(source, /selectedExtrudedFaceParts\[selectedPartIndex\]\.push/);
  assert.match(source, /selection\.faceParts\.forEach\(part =>/);
  assert.match(source, /color: 0x00e5ff, side: THREE\.DoubleSide, transparent: true, opacity: 0\.42/);
});
