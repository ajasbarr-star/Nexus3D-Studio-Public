import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const contract = fs.readFileSync(new URL('../../src/geometry/clean-flat-surface-contract.ts', import.meta.url), 'utf8');
const lock = fs.readFileSync(new URL('../../src/geometry/geometry-command-lock.ts', import.meta.url), 'utf8');

test('Geometry command lock explicitly protects every core modeling command', () => {
  for (const command of [
    'Move Face', 'Extrude Face', 'Face Scale', 'Subdivide', 'Subdivide Rotate',
    'Edge Move / Pull', 'Vertex Move / Pull', 'Smooth',
  ]) {
    assert.ok(lock.includes("'" + command + "'"), 'missing protected command: ' + command);
  }
  assert.match(lock, /Object\.freeze\(\{/);
  assert.match(lock, /Object\.keys\(GEOMETRY_COMMAND_LOCK\)/);
});

test('Move Face is transform-only and must never generate connecting walls', () => {
  assert.match(lock, /'Move Face': Object\.freeze\(\{[\s\S]*?generatesConnectingWalls: false/);
  const moveTrace = app.indexOf("Move Face committed · no extrusion walls");
  assert.notEqual(moveTrace, -1, 'Move Face must record its no-wall behavior');
  const moveSection = app.slice(moveTrace - 450, moveTrace + 700);
  assert.match(moveSection, /generatedWallQuadCount: 0/);
  assert.doesNotMatch(app, /Face Pull wall generation metrics|Face Pull side walls committed|Face Pull geometry preflight/);
});

test('Extrude Face alone owns connecting quad-wall generation and moved cap linkage', () => {
  assert.match(lock, /'Extrude Face': Object\.freeze\(\{[\s\S]*?generatesConnectingWalls: true,[\s\S]*?wallTopology: 'quad',[\s\S]*?removesOriginalFaceAtSourcePosition: true/);

  const extrudeStart = app.indexOf("} else if (tool === 'Extrude') {");
  const extrudeEnd = app.indexOf('// Reconstruct each existing pair of triangles as one canonical quad cell.', extrudeStart);
  assert.notEqual(extrudeStart, -1, 'dedicated Extrude implementation must exist');
  assert.ok(extrudeEnd > extrudeStart, 'Extrude implementation boundary must be identifiable');
  const extrudeSection = app.slice(extrudeStart, extrudeEnd);
  assert.match(extrudeSection, /boundary\.forEach\(edge =>/);
  assert.match(extrudeSection, /if \(edge\.count !== 1\) return/);
  assert.match(extrudeSection, /\[a, b, bn, a, bn, an\]\.forEach\(v => data\.push/);
  assert.match(extrudeSection, /extrudedWallCapIndices\.push/);
});

test('Move Face and Extrude Face remain separate operations in the Clean Flat Surface contract', () => {
  assert.match(contract, /'Move Face'/);
  assert.match(contract, /'Face Extrude'/);
  assert.match(contract, /'Face Scale'/);
  assert.match(contract, /'Subdivide'/);
  assert.match(contract, /'Edge Move \/ Pull'/);
  assert.match(contract, /'Vertex Move \/ Pull'/);
  assert.match(contract, /'Smooth'/);
});
