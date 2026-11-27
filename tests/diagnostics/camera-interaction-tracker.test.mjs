import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCameraPointer, createCameraInteractionTracker } from '../../src/diagnostics/camera-interaction-tracker.mjs';

test('camera pointer classification separates orbit, pan, zoom and pinch', () => {
  assert.equal(classifyCameraPointer({ pointerType: 'touch', button: 0 }), 'ORBIT');
  assert.equal(classifyCameraPointer({ pointerType: 'mouse', button: 0 }), 'ORBIT');
  assert.equal(classifyCameraPointer({ pointerType: 'mouse', button: 2 }), 'PAN');
  assert.equal(classifyCameraPointer({ pointerType: 'mouse', button: 1 }), 'ZOOM');
  assert.equal(classifyCameraPointer({ pointerType: 'mouse', button: 0, shiftKey: true }), 'PAN');
  assert.equal(classifyCameraPointer({ pointerType: 'touch' }, 2), 'PINCH');
});

test('camera update and first rendered frame latency use monotonic timestamps and one interaction ID', () => {
  let clock = 100;
  const records = [];
  const tracker = createCameraInteractionTracker({
    emit: event => records.push(event),
    now: () => clock,
    createId: () => 'camera-01',
  });
  tracker.onPointerDown({ pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 }, 'MainViewport');
  clock = 116;
  assert.equal(tracker.cameraChanged('MainOrbit', 'MainViewport'), 'camera-01');
  clock = 132;
  assert.equal(tracker.markRendered('MainViewport'), 'camera-01');
  clock = 150;
  tracker.onPointerUp({ pointerId: 1, clientX: 10, clientY: 10 });
  assert.equal(records[0].event, 'CAMERA_UPDATE');
  assert.equal(records[0].inputToCameraUpdateMs, 16);
  assert.equal(records[1].event, 'CAMERA_FIRST_RENDERED_FRAME');
  assert.equal(records[1].inputToFirstRenderedFrameMs, 32);
  assert.equal(records[1].cameraUpdateToFirstRenderedFrameMs, 16);
  assert.equal(records[0].interactionId, records[1].interactionId);
  assert.equal(records[2].event, 'CAMERA_GESTURE_COMPLETE');
});

test('two touch pointers are classified as pinch and double tap is distinguished', () => {
  let clock = 0;
  let sequence = 0;
  const records = [];
  const tracker = createCameraInteractionTracker({
    emit: event => records.push(event),
    now: () => clock,
    createId: () => 'gesture-' + (++sequence),
  });
  tracker.onPointerDown({ pointerId: 1, pointerType: 'touch', clientX: 5, clientY: 5 }, 'MainViewport');
  clock = 10;
  tracker.onPointerDown({ pointerId: 2, pointerType: 'touch', clientX: 25, clientY: 5 }, 'MainViewport');
  clock = 20;
  tracker.onPointerUp({ pointerId: 1, clientX: 5, clientY: 5 });
  clock = 30;
  tracker.onPointerUp({ pointerId: 2, clientX: 25, clientY: 5 });
  tracker.markRendered('MainViewport');
  clock = 40;
  tracker.markRendered('MainViewport');
  assert.equal(records.at(-1).gesture, 'PINCH');

  clock = 100;
  tracker.onPointerDown({ pointerId: 3, pointerType: 'touch', clientX: 10, clientY: 10 }, 'MainViewport');
  clock = 120;
  tracker.onPointerUp({ pointerId: 3, clientX: 10, clientY: 10 });
  clock = 250;
  tracker.onPointerDown({ pointerId: 4, pointerType: 'touch', clientX: 11, clientY: 10 }, 'MainViewport');
  clock = 270;
  tracker.onPointerUp({ pointerId: 4, clientX: 11, clientY: 10 });
  tracker.markRendered('MainViewport');
  clock = 290;
  tracker.markRendered('MainViewport');
  assert.equal(records.at(-1).gesture, 'DOUBLE_TAP');
});

test('wheel zoom is separately identified and inactive controls do not produce camera updates', () => {
  let clock = 50;
  const records = [];
  const tracker = createCameraInteractionTracker({ emit: event => records.push(event), now: () => clock, createId: () => 'wheel-01' });
  tracker.onWheel({ deltaY: 20 }, 'CameraViewport');
  clock = 60;
  assert.equal(tracker.cameraChanged('InactiveMainOrbit', 'CameraViewport', false), null);
  assert.equal(tracker.cameraChanged('ActiveCameraOrbit', 'CameraViewport', true), 'wheel-01');
  clock = 70;
  tracker.markRendered('CameraViewport');
  assert.equal(records[0].gesture, 'ZOOM');
  assert.equal(records[0].controller, 'ActiveCameraOrbit');
  assert.equal(records[1].inputToFirstRenderedFrameMs, 20);
});

test('a gesture without a camera response is explicitly reported, not assigned a latency', () => {
  let clock = 0;
  const records = [];
  const tracker = createCameraInteractionTracker({ emit: event => records.push(event), now: () => clock, createId: () => 'no-response' });
  tracker.onPointerDown({ pointerId: 1, pointerType: 'mouse', button: 0 }, 'MainViewport');
  clock = 25;
  tracker.onPointerUp({ pointerId: 1 });
  tracker.markRendered('MainViewport');
  clock = 50;
  tracker.markRendered('MainViewport');
  assert.equal(records[0].status, 'NO_CAMERA_UPDATE');
  assert.equal(records.some(item => Number.isFinite(item.inputToCameraUpdateMs)), false);
});

test('attach registers and removes canvas and OrbitControls listeners', () => {
  const listeners = new Map();
  const controlListeners = new Map();
  const element = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const controls = {
    addEventListener(type, callback) { controlListeners.set(type, callback); },
    removeEventListener(type) { controlListeners.delete(type); },
  };
  const tracker = createCameraInteractionTracker();
  const detach = tracker.attach({ element, controls: [{ name: 'MainOrbit', controls }] });
  assert.ok(listeners.has('pointerdown'));
  assert.ok(controlListeners.has('change'));
  detach();
  assert.equal(listeners.size, 0);
  assert.equal(controlListeners.size, 0);
});


test('camera interaction reuses the shared RIT pointer Interaction ID', () => {
  let clock = 5;
  const records = [];
  const tracker = createCameraInteractionTracker({
    emit: event => records.push(event),
    now: () => clock,
    createId: () => 'fallback-camera-id',
    resolveInteractionId: pointerId => 'rit-pointer-' + pointerId,
  });
  tracker.onPointerDown({ pointerId: 9, pointerType: 'touch', clientX: 1, clientY: 1 }, 'MainViewport');
  clock = 10;
  tracker.cameraChanged('MainOrbit', 'MainViewport');
  assert.equal(records[0].interactionId, 'rit-pointer-9');
});

test('camera tracker emits no records while the capture gate is off', () => {
  let clock = 0;
  let enabled = false;
  const records = [];
  const tracker = createCameraInteractionTracker({
    emit: event => records.push(event),
    now: () => clock,
    createId: () => 'gated-camera',
    enabled: () => enabled,
  });
  assert.equal(tracker.onPointerDown({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 }, 'MainViewport'), null);
  tracker.cameraChanged('MainOrbit', 'MainViewport');
  tracker.markRendered('MainViewport');
  assert.equal(tracker.onWheel({ deltaY: 10 }, 'MainViewport'), null);
  assert.equal(records.length, 0);
  enabled = true;
  tracker.onPointerDown({ pointerId: 2, pointerType: 'touch', clientX: 0, clientY: 0 }, 'MainViewport');
  clock = 12;
  tracker.cameraChanged('MainOrbit', 'MainViewport');
  tracker.markRendered('MainViewport');
  assert.equal(records.length, 2);
});
