import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRdsNoticeSection } from '../../src/diagnostics/rds-notice.mjs';

test('NOTICE creates evidence-backed actions for non-pass checks only', () => {
  const report = buildRdsNoticeSection([
    { name: 'Runtime / Main Scene', status: 'PASS', detail: 'Scene ready.' },
    { name: 'Viewport & Camera', status: 'WARN', detail: 'IK camera reference unavailable.' },
    { name: 'Scene Tree Integrity', status: 'ERROR', detail: 'Duplicate editor IDs: 2.' },
  ]);
  assert.match(report, /NOTICE · AUTOMATED FINDINGS/);
  assert.match(report, /\[CRITICAL\] Scene Tree Integrity/);
  assert.match(report, /\[HIGH\] Viewport & Camera/);
  assert.match(report, /Duplicate editor IDs: 2/);
  assert.match(report, /ROOT CAUSE NOT CONFIRMED/);
  assert.doesNotMatch(report, /Scene ready/);
});

test('NOTICE reports no action required when every check passes', () => {
  const report = buildRdsNoticeSection([{ name: 'Runtime / Main Scene', status: 'PASS', detail: 'Ready.' }]);
  assert.match(report, /NO ACTION REQUIRED/);
  assert.match(report, /No confirmed issues detected/);
});

test('NOTICE stays read-only and warns that warnings are not proof', () => {
  const report = buildRdsNoticeSection([{ name: 'Memory Leak Trend', status: 'WARN', detail: 'Baseline recorded.' }]);
  assert.match(report, /\[LOW\] Memory Leak Trend/);
  assert.match(report, /advisory and read-only/);
  assert.match(report, /A warning is not proof/);
  assert.ok(report.includes('\n'));
});
