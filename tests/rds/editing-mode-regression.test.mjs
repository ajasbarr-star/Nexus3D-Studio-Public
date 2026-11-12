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
