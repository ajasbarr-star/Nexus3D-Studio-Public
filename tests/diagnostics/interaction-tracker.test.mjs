import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionTracker, describeInteractionTarget } from '../../src/diagnostics/interaction-tracker.mjs';
import { formatDiagnosticReport } from '../../src/diagnostics/logcat-diagnostics.mjs';

function targetNode(attributes = {}, label = '', parent = null) {
  return {
    nodeType: 1,
    textContent: label,
    className: '',
    getAttribute(name) { return attributes[name] ?? null; },
    closest(selector) {
      let node = this;
      while (node) {
        if (selector.split(',').some(part => {
          const key = part.trim().match(/^\[([^\]]+)\]$/)?.[1];
          return key && (key.includes('=') ? node.getAttribute(key.split('=')[0]) !== null : node.getAttribute(key) !== null);
        })) return node;
        node = node.parentElement;
      }
      return null;
    },
    parentElement: parent,
  };
}

test('target description preserves tool, panel, control, action and object hierarchy', () => {
  const tool = targetNode({ 'data-rit-tool': 'Light' }, 'Light');
  const panel = targetNode({ 'data-rit-panel': 'Directional Light' }, '', tool);
  const object = targetNode({ 'data-object-id': 'DirectionalLight_05' }, 'DirectionalLight_05', panel);
  const control = targetNode({ 'aria-label': 'Intensity' }, '', object);
  const described = describeInteractionTarget(control);
  assert.equal(described.tool, 'Light');
  assert.equal(described.panel, 'Directional Light');
  assert.equal(described.objectId, 'DirectionalLight_05');
  assert.deepEqual(described.hierarchy.map(item => item.type), ['tool', 'panel', 'control', 'object']);
});

test('Light and Shape controls retain their full tool, panel, action and named-object hierarchy', () => {
  const lightTool = targetNode({ 'data-rit-tool': 'Quick Light Controls' }, '', null);
  const lightPanel = targetNode({ 'data-rit-panel': 'Directional Light' }, '', lightTool);
  const addLight = targetNode({ 'aria-label': 'Add Directional Light', 'data-rit-action': 'ADD', 'data-object-name': 'Directional Light' }, '', lightPanel);
  const light = describeInteractionTarget(addLight);
  assert.deepEqual(light.hierarchy, [
    { type: 'tool', label: 'Quick Light Controls' },
    { type: 'panel', label: 'Directional Light' },
    { type: 'control', label: 'Add Directional Light' },
    { type: 'action', label: 'ADD' },
    { type: 'object', label: 'Directional Light' },
  ]);

  const shapeTool = targetNode({ 'data-rit-tool': 'Shape' }, '', null);
  const shapePanel = targetNode({ 'data-rit-panel': 'Shape Library' }, '', shapeTool);
  const cube = targetNode({ 'aria-label': 'Cube', 'data-rit-action': 'CREATE', 'data-object-name': 'Cube' }, '', shapePanel);
  const shape = describeInteractionTarget(cube);
  assert.deepEqual(shape.hierarchy, [
    { type: 'tool', label: 'Shape' },
    { type: 'panel', label: 'Shape Library' },
    { type: 'control', label: 'Cube' },
    { type: 'action', label: 'CREATE' },
    { type: 'object', label: 'Cube' },
  ]);
});

test('pointer gesture emits one compact record with shared interaction ID and monotonic duration', () => {
  let clock = 100;
  let sequence = 0;
  const records = [];
  const tracker = createInteractionTracker({ emit: item => records.push(item), now: () => clock, createId: () => 'ix-' + (++sequence) });
  const target = targetNode({ 'data-rit-tool': 'Shape', 'aria-label': 'Cube' }, '');
  tracker.begin({ pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 20, target });
  clock = 125;
  tracker.move({ pointerId: 2, clientX: 11, clientY: 22 });
  clock = 180;
  const result = tracker.finish({ pointerId: 2 });
  assert.equal(result.gesture, 'TAP');
  assert.equal(result.durationMs, 80);
  assert.equal(result.interactionId, 'ix-1');
  assert.equal(records.length, 1);
  assert.equal(records[0].moveSamples, 1);
});

test('long movement is classified as drag and pointer cancel is explicit', () => {
  let clock = 0;
  const records = [];
  const tracker = createInteractionTracker({ emit: item => records.push(item), now: () => clock, createId: () => 'gesture' });
  const target = targetNode({}, 'Viewport');
  tracker.begin({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, target });
  clock = 100;
  tracker.move({ pointerId: 1, clientX: 30, clientY: 0 });
  clock = 500;
  const result = tracker.finish({ pointerId: 1 }, 'cancelled');
  assert.equal(result.gesture, 'DRAG');
  assert.equal(result.status, 'CANCELLED');
});

test('attached listeners are removed and controls emit correlated action records', () => {
  const listeners = new Map();
  const doc = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const records = [];
  let clock = 0;
  const tracker = createInteractionTracker({ emit: item => records.push(item), now: () => ++clock, createId: () => 'control' });
  const detach = tracker.attach(doc);
  const target = targetNode({ 'data-rit-tool': 'Transform', 'data-rit-action': 'Move' }, 'Move');
  listeners.get('pointerdown')({ pointerId: 1, pointerType: 'touch', clientX: 2, clientY: 3, target });
  listeners.get('pointerup')({ pointerId: 1 });
  listeners.get('click')({ type: 'click', pointerId: 1, target });
  assert.equal(records.length, 2);
  assert.equal(records[0].interactionId, records[1].interactionId);
  assert.equal(records[1].event, 'CONTROL_ACTIVATION');
  detach();
  assert.equal(listeners.size, 0);
});

test('concurrent touch pointers are both retained and classified as multi-touch', () => {
  let clock = 0;
  let sequence = 0;
  const records = [];
  const tracker = createInteractionTracker({ emit: item => records.push(item), now: () => clock, createId: () => 'multi-' + (++sequence) });
  const target = targetNode({ 'data-rit-viewport': 'MainViewport' }, '');
  tracker.begin({ pointerId: 11, pointerType: 'touch', clientX: 10, clientY: 10, target });
  clock = 5;
  tracker.begin({ pointerId: 12, pointerType: 'touch', clientX: 30, clientY: 10, target });
  clock = 20;
  tracker.move({ pointerId: 11, clientX: 5, clientY: 10 });
  tracker.move({ pointerId: 12, clientX: 35, clientY: 10 });
  clock = 60;
  const first = tracker.finish({ pointerId: 11 });
  const second = tracker.finish({ pointerId: 12 });
  assert.equal(first.gesture, 'MULTI_TOUCH');
  assert.equal(second.gesture, 'MULTI_TOUCH');
  assert.equal(records.length, 2);
});

test('LogCat text report exposes the same RIT Interaction ID for correlation', () => {
  const report = formatDiagnosticReport([{
    timestampISO: '2026-11-25T12:00:00.000Z',
    sessionId: 'N3D-test',
    sequence: 7,
    interactionId: 'ix-shared-007',
    level: 'INFO',
    source: 'Interaction Correlation',
    componentTag: 'Interaction Trace',
    tracePoint: 'USER_INTERACTION',
    message: 'GESTURE_COMPLETE',
    details: '{"gesture":"DRAG"}',
  }]);
  assert.ok(report.includes('interaction ID'));
  assert.ok(report.includes('ix-shared-007'));
});

test('completed touch, control activation and scene response can share one Interaction ID', () => {
  let clock = 100;
  const records = [];
  const tracker = createInteractionTracker({
    emit: item => records.push(item),
    now: () => clock,
    createId: () => 'shared-interaction',
  });
  const target = targetNode({ 'data-rit-tool': 'Light', 'aria-label': 'Add Directional Light' }, '');
  tracker.begin({ pointerId: 7, pointerType: 'touch', clientX: 20, clientY: 30, target });
  clock = 140;
  tracker.finish({ pointerId: 7 });
  tracker.action({ type: 'click', pointerId: 7, target });
  const consumed = tracker.consumeLastInteractionId();
  assert.equal(records[0].interactionId, 'shared-interaction');
  assert.equal(records[1].interactionId, records[0].interactionId);
  assert.equal(consumed, records[0].interactionId);
  assert.equal(tracker.consumeLastInteractionId(), null);
});

test('stale pointer IDs are not reused to correlate a later control action', () => {
  let clock = 10;
  let sequence = 0;
  const records = [];
  const tracker = createInteractionTracker({
    emit: item => records.push(item),
    now: () => clock,
    createId: () => 'ix-' + (++sequence),
  });
  const target = targetNode({ 'aria-label': 'Create' }, 'Create');
  tracker.begin({ pointerId: 4, pointerType: 'touch', clientX: 1, clientY: 1, target });
  clock = 20;
  tracker.finish({ pointerId: 4 });
  clock = 2000;
  tracker.action({ type: 'click', pointerId: 4, target });
  assert.notEqual(records[0].interactionId, records[1].interactionId);
  assert.equal(records[1].interactionId, 'ix-2');
});

test('cancelled pointer gestures are not reused as successful control activations', () => {
  let clock = 10;
  let sequence = 0;
  const records = [];
  const tracker = createInteractionTracker({
    emit: item => records.push(item),
    now: () => clock,
    createId: () => 'ix-' + (++sequence),
  });
  const target = targetNode({ 'aria-label': 'Create' }, 'Create');
  tracker.begin({ pointerId: 5, pointerType: 'touch', clientX: 1, clientY: 1, target });
  clock = 20;
  tracker.finish({ pointerId: 5 }, 'cancelled');
  tracker.action({ type: 'click', pointerId: 5, target });
  assert.notEqual(records[0].interactionId, records[1].interactionId);
  assert.equal(records[0].status, 'CANCELLED');
});


test('generic tool and panel markers are retained in the interaction hierarchy', () => {
  const tool = targetNode({ 'data-tool': 'Materials' }, '', null);
  const panel = targetNode({ 'data-panel': 'Surface' }, '', tool);
  const control = targetNode({ 'aria-label': 'Roughness' }, '', panel);
  const described = describeInteractionTarget(control);
  assert.equal(described.tool, 'Materials');
  assert.equal(described.panel, 'Surface');
  assert.deepEqual(described.hierarchy.map(item => item.type), ['tool', 'panel', 'control']);
});

test('blank viewport touches are explicitly classified without inventing an object selection', () => {
  const viewport = targetNode({ 'data-rit-viewport': 'MainViewport' }, '', null);
  const described = describeInteractionTarget(viewport);
  assert.equal(described.targetKind, 'BLANK_VIEWPORT');
  assert.equal(described.region, 'MainViewport');
  assert.deepEqual(described.hierarchy, [
    { type: 'viewport', label: 'MainViewport', targetKind: 'BLANK_VIEWPORT' }
  ]);
  assert.equal(described.objectId, '');
  assert.equal(described.objectName, '');
});

test('disabled controls are recorded as disabled rather than normal activations', () => {
  const records = [];
  const tracker = createInteractionTracker({
    emit: item => records.push(item),
    now: () => 100,
    createId: () => 'disabled-control'
  });
  const target = targetNode({ 'aria-label': 'Delete selected object' }, 'Delete');
  target.disabled = true;
  tracker.action({ type: 'click', pointerId: 0, target });
  assert.equal(records[0].status, 'DISABLED');
  assert.equal(records[0].event, 'CONTROL_ACTIVATION');
});


test('RIT resolves tool, section, explicit control, action and object hierarchy aliases', () => {
  const tool = targetNode({ 'data-tool-id': 'Import Export' }, '', null);
  const panel = targetNode({ 'data-rit-section': 'Project Files' }, '', tool);
  const control = targetNode({
    'data-rit-control': 'Load Project ZIP',
    'data-rit-action': 'IMPORT',
    'data-object-id': 'project-01'
  }, '', panel);
  const described = describeInteractionTarget(control);
  assert.equal(described.tool, 'Import Export');
  assert.equal(described.panel, 'Project Files');
  assert.deepEqual(described.hierarchy.map(item => item.type), ['tool', 'panel', 'control', 'action', 'object']);
  assert.equal(described.hierarchy[2].label, 'Load Project ZIP');
  assert.equal(described.hierarchy[3].label, 'IMPORT');
  assert.equal(described.objectId, 'project-01');
});
