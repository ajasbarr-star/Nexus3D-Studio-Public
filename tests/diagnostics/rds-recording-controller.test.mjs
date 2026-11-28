import test from 'node:test';
import assert from 'node:assert/strict';
import { createRdsRecordingController } from '../../src/diagnostics/rds-recording-controller.mjs';


test('default RDS IDs are unique UUIDs across tool, scene, and startup records', () => {
  const controller = createRdsRecordingController({ tools: ['Runtime'] });
  controller.startAnalysis('Runtime');
  const event = controller.record('Runtime', 'OBJECT_TOUCHED');
  controller.setSceneCapture('Runtime', true);
  const scene = controller.captureScene('Runtime', { objects: 1 });
  const startup = controller.recordStartup('EDITOR_READY');
  const ids = [event.id, scene.id, startup.id];

  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  }
});

test('tool interaction records are opt-in and isolated by RDS tool', () => {
  let tick = 0;
  const controller = createRdsRecordingController({
    tools: ['RIT Trace', 'Shadow Maps'],
    sessionId: 'session-a',
    buildNumber: 501,
    deviceId: 'device-a',
    now: () => new Date(1700000000000 + tick++),
    createId: (() => { let id = 0; return () => 'record-' + (++id); })(),
  });

  assert.equal(controller.record('RIT Trace', 'TOUCH', { objectId: 'cube' }), null);
  controller.startAnalysis('RIT Trace');
  const touch = controller.record('RIT Trace', 'TOUCH', { objectId: 'cube' });
  assert.equal(touch.tool, 'RIT Trace');
  assert.equal(touch.sessionId, 'session-a');
  assert.equal(touch.buildNumber, 501);
  assert.equal(touch.deviceId, 'device-a');
  assert.equal(controller.getToolRecords('Shadow Maps').records.length, 0);
  controller.stopAnalysis('RIT Trace');
  assert.equal(controller.record('RIT Trace', 'LATE_TOUCH'), null);
});

test('scene snapshots require the tool Capture Scene control to be enabled', () => {
  const controller = createRdsRecordingController({ tools: ['WebGL / Shader'] });
  assert.equal(controller.captureScene('WebGL / Shader', { objects: 1 }), null);
  controller.setSceneCapture('WebGL / Shader', true);
  const capture = controller.captureScene('WebGL / Shader', { objects: 1 }, 'BUTTON');
  assert.equal(capture.event, 'SCENE_CAPTURE');
  assert.deepEqual(capture.snapshot, { objects: 1 });
  controller.setSceneCapture('WebGL / Shader', false);
  assert.equal(controller.captureScene('WebGL / Shader', { objects: 2 }), null);
});

test('startup telemetry is independent from tool capture gates', () => {
  const controller = createRdsRecordingController({ tools: ['RIT Trace'], sessionId: 'boot-1' });
  const event = controller.recordStartup('WEBVIEW_READY', { elapsedMs: 40 });
  assert.equal(event.sessionId, 'boot-1');
  assert.equal(event.status, 'MEASURED');
  assert.equal(controller.getToolRecords('RIT Trace').records.length, 0);
  assert.equal(controller.getStartupRecords().length, 1);
});

test('endSession stops recording but preserves captured records for final export', () => {
  const controller = createRdsRecordingController({ tools: ['RIT Trace'] });
  controller.startAnalysis('RIT Trace');
  controller.record('RIT Trace', 'TOUCH');
  controller.setSceneCapture('RIT Trace', true);
  controller.captureScene('RIT Trace', { objects: 2 });
  controller.recordStartup('EDITOR_READY');
  controller.endSession();
  assert.equal(controller.isEnded(), true);
  assert.equal(controller.getToolRecords('RIT Trace').analysisEnabled, false);
  assert.equal(controller.getToolRecords('RIT Trace').sceneCaptureEnabled, false);
  assert.equal(controller.getToolRecords('RIT Trace').records.length, 1);
  assert.equal(controller.getToolRecords('RIT Trace').sceneSnapshots.length, 1);
  assert.equal(controller.getStartupRecords().length, 1);
  assert.equal(controller.record('RIT Trace', 'AFTER_EXIT'), null);
  assert.equal(controller.startAnalysis('RIT Trace'), false);
});

test('restarting analysis preserves earlier records and scene captures in the runtime session', () => {
  const controller = createRdsRecordingController({ tools: ['Runtime'] });
  controller.startAnalysis('Runtime');
  controller.record('Runtime', 'FIRST_RUN_EVENT');
  controller.setSceneCapture('Runtime', true);
  controller.captureScene('Runtime', { objects: 1 });
  controller.stopAnalysis('Runtime');
  controller.startAnalysis('Runtime');
  controller.record('Runtime', 'SECOND_RUN_EVENT');
  const state = controller.getToolRecords('Runtime');
  assert.equal(state.records.length, 2);
  assert.deepEqual(state.records.map(record => record.event), ['FIRST_RUN_EVENT', 'SECOND_RUN_EVENT']);
  assert.equal(state.sceneSnapshots.length, 1);
  assert.equal(state.sceneCaptureEnabled, false);
});

test('RDS records adopt the native canonical device ID after identity becomes ready', () => {
  const controller = createRdsRecordingController({ tools: ['Runtime'], deviceId: 'UNKNOWN_DEVICE_ID' });
  controller.startAnalysis('Runtime');
  const before = controller.record('Runtime', 'PRE_NATIVE_ID');
  controller.setSceneCapture('Runtime', true);
  const scene = controller.captureScene('Runtime', { objects: 1 });
  const startup = controller.recordStartup('EDITOR_READY');
  assert.equal(before.deviceId, 'UNKNOWN_DEVICE_ID');
  assert.equal(controller.setDeviceId('12345678-1234-1234-1234-123456789abc'), true);
  const after = controller.record('Runtime', 'POST_NATIVE_ID');
  assert.equal(before.deviceId, '12345678-1234-1234-1234-123456789abc');
  assert.equal(scene.deviceId, '12345678-1234-1234-1234-123456789abc');
  assert.equal(startup.deviceId, '12345678-1234-1234-1234-123456789abc');
  assert.equal(after.deviceId, '12345678-1234-1234-1234-123456789abc');
  assert.equal(controller.setDeviceId(''), false);
  assert.equal(controller.record('Runtime', 'ID_UNCHANGED').deviceId, '12345678-1234-1234-1234-123456789abc');
});
