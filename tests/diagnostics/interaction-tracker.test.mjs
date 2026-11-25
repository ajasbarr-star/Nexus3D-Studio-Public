import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionTracker, describeInteractionTarget } from '../../src/diagnostics/interaction-tracker.mjs';

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
          const key = part.trim().match(/^\\[([^\\]]+)\\]$/)?.[1];
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
