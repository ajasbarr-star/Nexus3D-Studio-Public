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

test('each RDS tool has its own ZIP download action and native storage export', () => {
  assert.match(app, /exportRdsToolZip\(rdsActiveTool\)/);
  assert.match(app, /Download ' \+ rdsActiveTool \+ ' report ZIP/);
  assert.match(app, /NexusProjectFiles\.saveRdsArchive/);
  assert.match(app, /Documents\\/Nexus3D/);
  assert.doesNotMatch(app, /Nexus3D\\/RDS Reports/);
  assert.match(app, /buildRdsExportFiles/);
  assert.doesNotMatch(app, /exportLogcatReport/);
});

test('RDS panel restores independent bottom and right-side resize sliders', () => {
  assert.match(app, /rds-resize-horizontal/);
  assert.match(app, /rds-resize-vertical/);
  assert.match(app, /beginRdsPanelResize\(event, 'width'\)/);
  assert.match(app, /beginRdsPanelResize\(event, 'height'\)/);
  assert.match(app, /style=\{\{ width: rdsPanelWidth, height: rdsPanelHeight \}\}/);
});

test('RIT Trace panel retains a dedicated Clear Trace action', () => {
  assert.match(app, /Clear Trace/);
  assert.match(app, /clearInteractionTraceLogs\(\)/);
});

test('LogCat captures long tasks and slow-frame samples without a new requestAnimationFrame loop', () => {
  assert.match(app, /entryTypes: \['longtask'\]/);
  assert.match(app, /entryTypes: \['long-animation-frame'\]/);
  assert.match(app, /summarizeFrameTimes\(list\.getEntries\(\)\.map\(entry => entry\.duration\)\)/);
  assert.match(app, /'Frame Monitor', 'Slow frame\(s\) detected'/);
  assert.match(app, /slowFrameObserver\?\.disconnect\(\)/);
});
