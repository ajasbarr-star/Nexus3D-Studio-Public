import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');

test('RDS exposes LogCat as its own tool beside Runtime and RIT Trace', () => {
  assert.match(app, /\['LogCat','Activity'\]/);
  assert.match(app, /rdsActiveTool === 'LogCat'/);
  assert.match(app, /rdsActiveTool === 'Runtime'/);
  assert.match(app, /rdsActiveTool === 'RIT Trace'/);
});

test('LogCat and RIT Trace use separate in-memory queues and persistence APIs', () => {
  assert.match(app, /const diagnosticQueueRef = useRef<DiagnosticEntry\[]>\(\[\]\)/);
  assert.match(app, /const interactionTraceQueueRef = useRef<DiagnosticEntry\[]>\(\[\]\)/);
  assert.match(app, /saveLogcatEntries\(localStorage, next\)/);
  assert.match(app, /saveRitTraceEntries\(localStorage, next\)/);
  assert.doesNotMatch(app, /nexus3d_realtime_diagnostics_v1/);
});

test('clearing LogCat and RIT Trace are independent operations', () => {
  assert.match(app, /clearLogcatEntries\(localStorage\)/);
  assert.match(app, /clearRitTraceEntries\(localStorage\)/);
  assert.match(app, /Cleared LogCat events · RIT Trace preserved/);
  assert.match(app, /Cleared RIT Trace events · LogCat preserved/);
});

test('LogCat provides severity, advanced metadata filters, pause, refresh and clear controls', () => {
  for (const value of ['logcatLevel','logcatSourceFilter','logcatTagFilter','logcatTracePointFilter','logcatObjectFilter','logcatSessionFilter','logcatFromFilter','logcatToFilter','logcatRegex']) assert.ok(app.includes(value), 'missing filter ' + value);
  for (const value of ['pauseLogcat','resumeLogcat','refreshLogcat','clearDiagnosticLogs']) assert.ok(app.includes(value));
  assert.match(app, /aria-label="Clear LogCat"/);
});

test('LogCat report is downloaded as a text file, not only copied to clipboard', () => {
  assert.match(app, /const exportLogcatReport = \(\) =>/);
  assert.match(app, /anchor\.download/);
  assert.match(app, /formatDiagnosticReport\(visibleLogcatEntries/);
});

test('RIT Trace panel retains a dedicated Clear Trace action', () => {
  assert.match(app, /Clear Trace/);
  assert.match(app, /clearInteractionTraceLogs\(\)/);
});
