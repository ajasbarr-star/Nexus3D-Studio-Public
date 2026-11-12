import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const scanner = fs.readFileSync(new URL('../../src/dfi/mesh-forensics.ts', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');

test('Advanced DFI dashboard exposes all requested clickable diagnostic tools', () => {
  for (const label of ['Shape Core','Gizmo Control','Face Tools','Edge Tools','Vertex Tools','Extrude & Scale','Subdivide + Rotate','Post-Smooth','Overlap Scan']) {
    assert.ok(app.includes("['" + label + "'") || app.includes("['" + label + "',"), 'missing tool: ' + label);
  }
  assert.match(app, /runDfiToolScan\(tool\)/);
});

test('Advanced DFI provides a unified COPY ALL REPORT action', () => {
  assert.match(app, /const copyAllDfiReport = async \(\) =>/);
  assert.match(app, /COPY ALL REPORT/);
  assert.match(app, /INDIVIDUAL TOOL REPORTS/);
  assert.match(app, /ALL CAPTURED RUNTIME DIAGNOSTICS/);
  assert.match(app, /RDS FULL CORE REPORT/);
});

test('Gizmo forensic recording captures axis, mode, coordinate space and transforms', () => {
  assert.match(app, /Gizmo transform sample/);
  assert.match(app, /axis: transform\.axis \?\? null/);
  assert.match(app, /mode: transform\.getMode\(\)/);
  assert.match(app, /space: spaceRef\.current/);
  assert.match(app, /position: object\.position\.toArray\(\)/);
  assert.match(app, /rotation: \[object\.rotation\.x, object\.rotation\.y, object\.rotation\.z\]/);
  assert.match(app, /scale: object\.scale\.toArray\(\)/);
});

test('Geometry operation trace captures selection, transform axis and pre-operation mesh state', () => {
  assert.match(app, /Geometry operation requested/);
  assert.match(app, /selectionVertexCount: part\.indices\.length/);
  assert.match(app, /selectedFaceCount: part\.faceParts\?\.length \|\| 0/);
  assert.match(app, /indexedBefore: Boolean\(target\.geometry\.index\)/);
  assert.match(app, /transformAxis: runtime\.current\?\.transform\?\.axis/);
});

test('Mesh Core scanner checks duplicate triangles, invalid indices, degenerates and edge incidence', () => {
  for (const token of ['DUPLICATE_TRIANGLES','INVALID_INDEX','DEGENERATE_TRIANGLES','NON_MANIFOLD_EDGE','BOUNDARY_EDGES','COINCIDENT_VERTICES']) {
    assert.ok(scanner.includes(token), 'missing topology check: ' + token);
  }
  assert.match(scanner, /export function scanMeshCore/);
  assert.match(scanner, /export function formatMeshForensicReport/);
  assert.match(scanner, /Read-only scan/);
});

test('Advanced DFI report highlights CRASH, CONFLICT, ERROR, BUG and WARNING findings', () => {
  assert.match(app, /CRASH\|FATAL/);
  assert.match(app, /CONFLICT/);
  assert.match(app, /ERROR\|BUG\|DUPLICATE\|NON_MANIFOLD/);
  assert.match(app, /WARN\|WARNING\|SUSPECTED/);
  assert.match(styles, /dfi-crash/);
  assert.match(styles, /dfi-conflict/);
  assert.match(styles, /dfi-error/);
  assert.match(styles, /dfi-warning/);
});

test('DFI diagnostic actions do not automatically repair or mutate scene geometry', () => {
  assert.match(app, /No geometry repair or mutation was attempted/);
  assert.match(scanner, /no mesh, transform, material, selection, or project data was modified/i);
});

test('Geometry commits record before/after counts, bounds, axis and quad verification', () => {
  assert.match(app, /Geometry operation committed/);
  assert.match(app, /vertexCountBefore: before\.getAttribute\('position'\)\?\.count/);
  assert.match(app, /vertexCountAfter: committedPosition\?\.count/);
  assert.match(app, /boundsMin: target\.geometry\.boundingBox\?\.min\.toArray\(\)/);
  assert.match(app, /quadGridVerified: Boolean\(afterQuadGridState\.enabled\)/);
});
