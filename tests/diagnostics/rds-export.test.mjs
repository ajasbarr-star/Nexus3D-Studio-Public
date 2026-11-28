import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRdsExportFiles } from '../../src/diagnostics/rds-export.mjs';
import { createRdsZipArchive, buildRdsZipFilename } from '../../src/diagnostics/rds-zip.mjs';
import JSZip from 'jszip';

test('RDS export preserves complete reports containing more than the former 400-entry UI window', () => {
  const entries = Array.from({ length: 5000 }, (_, index) => ({
    id: 'event-' + index,
    level: 'INFO',
    source: 'Runtime',
    message: 'EVENT_' + index,
    timestampISO: new Date(1700000000000 + index).toISOString()
  }));
  const fullReport = entries.map(entry => '[' + entry.timestampISO + '] ' + entry.message).join('\n');
  const files = buildRdsExportFiles({ tool: 'Runtime', fullReport, entries });
  assert.match(files['Full_Report.txt'], /EVENT_0/);
  assert.match(files['Full_Report.txt'], /EVENT_4999/);
  assert.match(files['Summary.txt'], /Captured entries: 5000/);
});

test('each RDS export contains the five requested plain-text files', () => {
  const files = buildRdsExportFiles({ tool: 'RIT Trace', fullReport: 'trace report', entries: [] });
  assert.deepEqual(Object.keys(files).sort(), ['Errors.txt', 'Full_Report.txt', 'Metadata.txt', 'Summary.txt', 'Warnings.txt']);
  for (const [name, content] of Object.entries(files)) {
    assert.ok(name.endsWith('.txt'));
    assert.equal(typeof content, 'string');
  }
});

test('RDS export separates captured errors and warnings without losing the full report', () => {
  const entries = [
    { time: '10:00', level: 'ERROR', source: 'Renderer', message: 'Context lost', details: 'stack A' },
    { time: '10:01', level: 'WARN', source: 'Lighting', message: 'Shadow budget high' },
    { time: '10:02', level: 'INFO', source: 'Scene', message: 'Cube added' }
  ];
  const files = buildRdsExportFiles({ tool: 'LogCat', fullReport: 'All events included', entries });
  assert.match(files['Full_Report.txt'], /All events included/);
  assert.match(files['Errors.txt'], /Context lost/);
  assert.match(files['Errors.txt'], /stack A/);
  assert.match(files['Warnings.txt'], /Shadow budget high/);
  assert.doesNotMatch(files['Errors.txt'], /Cube added/);
  assert.match(files['Summary.txt'], /Errors: 1/);
  assert.match(files['Summary.txt'], /Warnings: 1/);
});

test('RDS export normalizes only the current-session section separators and summarizes scene verification', () => {
  const files = buildRdsExportFiles({
    tool: 'LogCat',
    fullReport: '[SCENE VERIFICATION]\\nHistorical LogCat entries excluded: 12\\nNEXUS3D RDS — DIAGNOSTIC REPORT',
    entries: [],
    metadata: {
      sceneVerificationSummary: 'SCList 17 Directional Lights/1 Cube; MainViewport 17 Directional Lights/1 Cube; reconciliation=MATCH',
      historicalLogcatEntriesExcluded: 12,
      historicalRitEntriesExcluded: 8,
    },
  });
  assert.ok(files['Full_Report.txt'].includes('[SCENE VERIFICATION]\nHistorical LogCat entries excluded: 12\nNEXUS3D RDS'));
  assert.ok(!files['Full_Report.txt'].includes('\\nHistorical'));
  assert.ok(files['Summary.txt'].includes('Scene verification: SCList 17 Directional Lights/1 Cube'));
  assert.match(files['Summary.txt'], /Historical LogCat entries excluded: 12/);
  assert.match(files['Summary.txt'], /Historical RIT-Trace entries excluded: 8/);
});


test('RIT Trace Full_Report joins touch hierarchy to the generated object identity by Interaction ID', () => {
  const interactionId = 'interaction-light-01';
  const entries = [
    {
      interactionId, timestampISO: '2026-11-26T10:00:00.000Z', level: 'INFO',
      source: 'Interaction Trace', message: 'CONTROL_ACTIVATION',
      details: JSON.stringify({ target: { hierarchy: [
        { type: 'tool', label: 'Quick Light Controls' },
        { type: 'panel', label: 'Directional Light' },
        { type: 'control', label: 'Add Directional Light' },
        { type: 'action', label: 'ADD' },
        { type: 'object', label: 'Directional Light' }
      ] } })
    },
    {
      interactionId, timestampISO: '2026-11-26T10:00:00.040Z', level: 'INFO',
      source: 'Interaction Trace', message: 'SCENE_OBJECT_CREATE_RESULT',
      details: JSON.stringify({
        action: 'CREATE',
        object: { id: 'editor-light-01', name: 'DirectionalLight_1', kind: 'DirectionalLight' },
        verification: { sceneTreeList: 'PRESENT', mainViewportScene: 'PRESENT' },
        timing: { processingToSceneUpdateMs: 40, firstRenderedFrame: 'NOT_MEASURED' },
        status: 'SUCCESS'
      })
    }
  ];
  const files = buildRdsExportFiles({ tool: 'RIT Trace', fullReport: 'Raw event stream', entries });
  const report = files['Full_Report.txt'];
  for (const expected of [
    '[USER WORKFLOW HIERARCHY]',
    'Tool: Quick Light Controls',
    'Panel: Directional Light',
    'Inside: Add Directional Light',
    'Action: ADD',
    'Created object: DirectionalLight_1 [ID: editor-light-01]',
    'Scene Tree: PRESENT | MainViewport: PRESENT',
    'Processing to scene update: 40 ms',
    'First rendered frame: NOT_MEASURED',
    'Creation result: SUCCESS',
    'Interaction ID: interaction-light-01'
  ]) assert.ok(report.includes(expected), 'report should include ' + expected);
});

test('RIT Trace hierarchy does not invent object identity when creation result is missing', () => {
  const files = buildRdsExportFiles({
    tool: 'RIT Trace', fullReport: 'Trace only',
    entries: [{
      interactionId: 'tap-only', level: 'INFO', message: 'CONTROL_ACTIVATION',
      details: JSON.stringify({ target: { hierarchy: [{ type: 'tool', label: 'Shape' }] } })
    }]
  });
  assert.match(files['Full_Report.txt'], /Tool: Shape/);
  assert.doesNotMatch(files['Full_Report.txt'], /Created object: Cube/);
});

test('RDS export extracts severity lines from report-only tools and documents empty sections', () => {
  const files = buildRdsExportFiles({
    tool: 'Source Audit',
    fullReport: 'Audit result\n[ERROR] src/App.tsx:1 parse issue\n[WARN] src/scene.ts:2 caution'
  });
  assert.match(files['Errors.txt'], /parse issue/);
  assert.match(files['Warnings.txt'], /caution/);
  assert.match(files['Metadata.txt'], /Source Audit/);
});


test('RDS ZIP extracts exactly five complete UTF-8 TXT files at the archive root', async () => {
  const reportText = 'Complete report content\nRenderer: café ✓\n[ERROR] Context lost';
  const files = buildRdsExportFiles({
    tool: 'RIT Trace',
    fullReport: reportText,
    entries: [{ time: '10:00', level: 'ERROR', source: 'Renderer', message: 'Context lost' }],
    metadata: { generatedAt: '2026-11-26T13:57:00.000Z' }
  });
  const zip = createRdsZipArchive(files);
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const extracted = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const entries = Object.values(extracted.files);
  assert.equal(entries.length, 5);
  assert.ok(entries.every(entry => !entry.dir && !entry.name.includes('/')));
  assert.deepEqual(entries.map(entry => entry.name).sort(), [
    'Errors.txt', 'Full_Report.txt', 'Metadata.txt', 'Summary.txt', 'Warnings.txt'
  ]);
  for (const [name, expectedText] of Object.entries(files)) {
    const entry = extracted.file(name);
    assert.ok(entry, name + ' must exist at ZIP root');
    const actualText = await entry.async('string');
    assert.equal(actualText, expectedText, name + ' must retain its complete text content');
    assert.ok(actualText.length > 0, name + ' must not be empty');
  }
  assert.match(await extracted.file('Full_Report.txt').async('string'), /café ✓/);
});

test('RDS ZIP filename uses exact Philippine execution time and canonical filename format', () => {
  const filename = buildRdsZipFilename('RIT Trace', '2026-11-26T13:57:00.000Z');
  assert.equal(filename, 'Nexus3D_RIT-Trace_9-57pm_11-26-2026.zip');
  assert.ok(filename.startsWith('Nexus3D_RIT-Trace_'));
  assert.ok(filename.endsWith('_11-26-2026.zip'));
});

test('RDS ZIP filename uses the Philippine date after crossing midnight', () => {
  const filename = buildRdsZipFilename('LogCat', '2026-11-26T16:05:00.000Z');
  assert.equal(filename, 'Nexus3D_LogCat_12-05am_11-27-2026.zip');
});

test('RDS ZIP filename rejects invalid timestamps and empty tool names', () => {
  assert.throws(() => buildRdsZipFilename('RIT Trace', 'not-a-date'), /Invalid RDS export timestamp/);
  assert.throws(() => buildRdsZipFilename('   ', '2026-11-26T13:57:00.000Z'), /Invalid RDS ZIP tool name/);
});


test('RIT Trace exports standalone blank-viewport gestures and non-creation control actions', () => {
  const files = buildRdsExportFiles({
    tool: 'RIT Trace',
    fullReport: 'Touch session',
    entries: [
      {
        interactionId: 'viewport-touch-01',
        timestampISO: '2026-11-26T10:02:00.000Z',
        level: 'INFO',
        source: 'Interaction Trace',
        message: 'GESTURE_COMPLETE',
        details: JSON.stringify({
          pointerId: 3,
          pointerType: 'touch',
          gesture: 'DRAG',
          status: 'INPUT_RECEIVED',
          durationMs: 320,
          distancePx: 84,
          target: {
            targetKind: 'BLANK_VIEWPORT',
            region: 'MainViewport',
            hierarchy: [{ type: 'viewport', label: 'MainViewport', targetKind: 'BLANK_VIEWPORT' }]
          }
        })
      },
      {
        interactionId: 'inspector-value-01',
        timestampISO: '2026-11-26T10:02:01.000Z',
        level: 'INFO',
        source: 'Interaction Trace',
        message: 'CONTROL_VALUE',
        details: JSON.stringify({
          controlEvent: 'change',
          status: 'INPUT_RECEIVED',
          target: {
            targetKind: 'CONTROL',
            region: 'UI',
            hierarchy: [
              { type: 'tool', label: 'Transform Inspector' },
              { type: 'panel', label: 'Position' },
              { type: 'control', label: 'Position X' }
            ]
          }
        })
      }
    ]
  });
  const report = files['Full_Report.txt'];
  assert.ok(report.includes('Interaction ID: viewport-touch-01'));
  assert.ok(report.includes('Touch: touch · DRAG'));
  assert.ok(report.includes('Target: BLANK_VIEWPORT | Region: MainViewport'));
  assert.ok(report.includes('Viewport: MainViewport [BLANK_VIEWPORT]'));
  assert.ok(report.includes('Interaction ID: inspector-value-01'));
  assert.ok(report.includes('Tool: Transform Inspector'));
  assert.ok(report.includes('Control event: change'));
});


test('RIT Trace reports measured camera update and first rendered frame latency', () => {
  const interactionId = 'camera-latency-01';
  const entries = [
    {
      interactionId, timestampISO: '2026-11-26T10:10:00.000Z', level: 'INFO',
      source: 'Interaction Trace', message: 'CAMERA_GESTURE_COMPLETE',
      details: JSON.stringify({ gesture: 'PINCH', viewport: 'MainViewport', status: 'INPUT_RECEIVED' })
    },
    {
      interactionId, timestampISO: '2026-11-26T10:10:00.016Z', level: 'INFO',
      source: 'Interaction Trace', message: 'CAMERA_UPDATE',
      details: JSON.stringify({ gesture: 'PINCH', viewport: 'MainViewport', controller: 'MainOrbitControls', inputToCameraUpdateMs: 16 })
    },
    {
      interactionId, timestampISO: '2026-11-26T10:10:00.032Z', level: 'INFO',
      source: 'Interaction Trace', message: 'CAMERA_FIRST_RENDERED_FRAME',
      details: JSON.stringify({ gesture: 'PINCH', viewport: 'MainViewport', controller: 'MainOrbitControls', inputToFirstRenderedFrameMs: 32, cameraUpdateToFirstRenderedFrameMs: 16 })
    }
  ];
  const report = buildRdsExportFiles({ tool: 'RIT Trace', fullReport: 'Camera test', entries })['Full_Report.txt'];
  assert.match(report, /Camera gesture: PINCH \| Viewport: MainViewport/);
  assert.match(report, /Input to camera update: 16 ms/);
  assert.match(report, /Input to first rendered frame: 32 ms/);
  assert.match(report, /Camera update to rendered frame: 16 ms/);
  assert.match(report, /Active controller: MainOrbitControls/);
});

test('RIT Trace does not fabricate camera latency when no camera update is observed', () => {
  const report = buildRdsExportFiles({
    tool: 'RIT Trace',
    fullReport: 'No camera movement',
    entries: [{
      interactionId: 'camera-no-response',
      level: 'INFO',
      source: 'Interaction Trace',
      message: 'CAMERA_GESTURE_COMPLETE',
      details: JSON.stringify({ gesture: 'DOUBLE_TAP', viewport: 'MainViewport', status: 'NO_CAMERA_UPDATE' })
    }]
  })['Full_Report.txt'];
  assert.match(report, /Camera gesture: DOUBLE_TAP/);
  assert.match(report, /Status: NO_CAMERA_UPDATE/);
  assert.doesNotMatch(report, /Input to camera update: [0-9]/);
});

test('empty per-tool interaction reports explicitly state NO DATA CAPTURED', () => {
  const files = buildRdsExportFiles({ tool: 'RIT Trace', fullReport: 'NO DATA CAPTURED', entries: [] });
  assert.match(files['Full_Report.txt'], /NO DATA CAPTURED/);
  assert.match(files['Full_Report.txt'], /no user interaction events were recorded/i);
});

test('RIT Full_Report includes measured camera movement and frame performance metrics', () => {
  const interactionId = 'camera-frame-report';
  const entries = [
    { interactionId, level: 'INFO', message: 'CAMERA_UPDATE', details: JSON.stringify({
      gesture: 'ORBIT', viewport: 'MainViewport', cameraPositionDeltaUnits: 2.5,
      cameraRotationDeltaDegrees: 18, cameraTargetDeltaUnits: 0.5,
      movementAccuracy: 'NOT_MEASURED — no expected camera path or target was supplied'
    }) },
    { interactionId, level: 'INFO', message: 'CAMERA_GESTURE_COMPLETE', details: JSON.stringify({
      gesture: 'ORBIT', viewport: 'MainViewport', status: 'CAMERA_UPDATED',
      frameMetricStatus: 'MEASURED', frameTimeSamples: 4,
      frameTimeAverageMs: 16.7, frameTimeMaxMs: 20.1,
      frameTimeJitterStdDevMs: 1.2, droppedFrameEstimate60Hz: 1,
      droppedFrameEstimateBasis: '60Hz target interval 16.67ms; estimate only'
    }) }
  ];
  const report = buildRdsExportFiles({ tool: 'RIT Trace', fullReport: 'Camera metrics', entries })['Full_Report.txt'];
  assert.match(report, /Actual camera movement: position delta 2.5 units/);
  assert.match(report, /rotation delta 18 degrees/);
  assert.match(report, /Movement accuracy: NOT_MEASURED/);
  assert.match(report, /Frame performance: samples 4/);
  assert.match(report, /jitter std-dev 1.2 ms/);
  assert.match(report, /Dropped-frame estimate: 1 estimated frame/);
});
