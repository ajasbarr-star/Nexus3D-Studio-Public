import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDiagnosticLevel, inferTracePoint, filterDiagnosticEntries,
  formatDiagnosticReport, summarizeFrameTimes
} from '../../src/diagnostics/logcat-diagnostics.mjs';

const entries = [
  { id: '1', level: 'ERROR', source: 'Renderer', componentTag: 'WebGL', tracePoint: 'RENDER_RUNTIME', message: 'Context lost', details: 'GPU reset', sessionId: 'session-a', sequence: 1, timestampISO: '2026-11-16T02:00:00.000Z', objectId: 'shape-1' },
  { id: '2', level: 'WARN', source: 'Scene Tree', componentTag: 'Hierarchy', tracePoint: 'SCENE_TREE', message: 'Selection changed', sessionId: 'session-a', sequence: 2, timestampISO: '2026-11-16T02:01:00.000Z', objectId: 'bone-2' },
  { id: '3', level: 'INFO', source: 'IK', componentTag: 'Rigging', tracePoint: 'RDS_IK', message: 'Bone attached', sessionId: 'session-b', sequence: 3, timestampISO: '2026-11-16T03:00:00.000Z', objectId: 'bone-2' }
];

test('normalizes Android-style severity labels', () => {
  assert.equal(normalizeDiagnosticLevel('warning'), 'WARN');
  assert.equal(normalizeDiagnosticLevel('fatal'), 'FATAL');
  assert.equal(normalizeDiagnosticLevel('unknown'), 'INFO');
});

test('infers trace points for runtime and editor events', () => {
  assert.equal(inferTracePoint('Scene Tree', 'Object selected'), 'SCENE_TREE');
  assert.equal(inferTracePoint('IK Viewport', 'Bone selected'), 'IK_VIEWPORT');
  assert.equal(inferTracePoint('Viewport', 'Viewport pointer up'), 'MAIN_VIEWPORT');
  assert.equal(inferTracePoint('Runtime', 'Unhandled exception'), 'APP_EXCEPTION');
});

test('advanced filters combine severity, source, tag, trace point, object, session and time', () => {
  assert.deepEqual(filterDiagnosticEntries(entries, { level: 'ERROR', source: 'render', tag: 'webgl', tracePoint: 'RENDER_RUNTIME', objectId: 'shape-1', sessionId: 'session-a', from: '2026-11-16T01:59:00Z', to: '2026-11-16T02:01:00Z' }).map(entry => entry.id), ['1']);
  assert.deepEqual(filterDiagnosticEntries(entries, { query: 'bone', regex: true }).map(entry => entry.id), ['2', '3']);
  assert.deepEqual(filterDiagnosticEntries(entries, { query: '[', regex: true }), []);
});

test('diagnostic report exports structured metadata', () => {
  const report = formatDiagnosticReport(entries.slice(0, 1), { sessionId: 'session-a' });
  for (const value of ['NEXUS3D RDS', 'session-a', 'RENDER_RUNTIME', 'WebGL', 'GPU reset']) assert.ok(report.includes(value));
});

test('frame-time summary reports average, p95, maximum and slow-frame count', () => {
  assert.deepEqual(summarizeFrameTimes([16, 20, 40, 50]), { samples: 4, averageMs: 31.5, p95Ms: 50, maxMs: 50, slowFrames: 2 });
  assert.equal(summarizeFrameTimes([]).samples, 0);
});
