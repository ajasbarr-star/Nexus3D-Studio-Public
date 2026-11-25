import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRdsExportFiles } from '../../src/diagnostics/rds-export.mjs';
import { createRdsZipArchive, buildRdsZipFilename } from '../../src/diagnostics/rds-zip.mjs';
import JSZip from 'jszip';

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

test('RDS ZIP filename contains sanitized time and date without creating archive folders', () => {
  const filename = buildRdsZipFilename('RIT Trace', '2026-11-26T13:57:00.000Z');
  assert.match(filename, /^Nexus3D_RIT-Trace_\\d+-\\d+pm_11-26-2026\\.zip$/);
});
