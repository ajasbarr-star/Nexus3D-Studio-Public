import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeSession, createRuntimeEventMetadata, formatRuntimeTraceReport } from '../../src/diagnostics/runtime-session.mjs';

test('runtime sessions are deterministic for supplied time and random inputs', () => {
  assert.equal(createRuntimeSession(1000, () => 0.5), createRuntimeSession(1000, () => 0.5));
  assert.notEqual(createRuntimeSession(1000, () => 0.5), createRuntimeSession(1001, () => 0.5));
});

test('RIT metadata records session, sequence, timestamp and source origin', () => {
  const first = createRuntimeEventMetadata('Interaction Trace', 'Viewport pointer down', new Date('2026-11-13T14:00:00.000Z'));
  const second = createRuntimeEventMetadata('Memory Monitor', 'Memory sample', new Date('2026-11-13T14:00:01.000Z'));
  assert.match(first.sessionId, /^N3D-/);
  assert.ok(second.sequence > first.sequence);
  assert.equal(first.timestampISO, '2026-11-13T14:00:00.000Z');
  assert.equal(first.origin, 'USER_ACTION');
  assert.equal(second.origin, 'AUTO_PROCESS');
});

test('RIT report separates current, previous and legacy events', () => {
  const entries = [
    { sessionId: 'session-current', sequence: 2, timestampISO: '2026-11-13T14:00:02.000Z', origin: 'USER_ACTION', level: 'INFO', source: 'Interaction Trace', message: 'Cube selected' },
    { sessionId: 'session-old', level: 'INFO', source: 'Interaction Trace', message: 'Old event' },
    { level: 'INFO', source: 'Interaction Trace', message: 'Legacy event' },
  ];
  const report = formatRuntimeTraceReport(entries, { sessionId: 'session-current', startedAt: '2026-11-13T14:00:00.000Z' });
  assert.match(report, /Current session: session-current/);
  assert.match(report, /Current session: 1 · Previous\/legacy: 2/);
  assert.match(report, /CURRENT_SESSION/);
  assert.match(report, /PREVIOUS_SESSION/);
  assert.match(report, /LEGACY_UNKNOWN_SESSION/);
  assert.match(report, /cannot be attributed/);
  assert.ok(report.includes('\n'), 'copied report should contain real line breaks');
});
