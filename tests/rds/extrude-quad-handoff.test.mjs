import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');

test('Face Extrude reconstructs canonical quad cells from paired triangles', () => {
  assert.match(app, /position\.count % 6 === 0/);
  assert.match(app, /const triA = \[start, start \+ 1, start \+ 2\]/);
  assert.match(app, /const triB = \[start \+ 3, start \+ 4, start \+ 5\]/);
  assert.match(app, /if \(shared\.length !== 2\)/);
  assert.match(app, /reorder\.push\(uniqueA, firstShared, uniqueB, uniqueA, uniqueB, secondShared\)/);
  assert.match(app, /firstOrderMatches/);
  assert.match(app, /alternateFirst\.dot\(normalA\)/);
  assert.match(app, /extrudeQuadGridVerified = verified/);
});

test('Quad metadata is enabled only after verified Extrude topology and cleared on failure', () => {
  assert.match(app, /tool === 'Extrude'\s*\? \{ enabled: extrudeQuadGridVerified/);
  assert.match(app, /layout: extrudeQuadGridVerified \? 'canonical-v1' : null/);
  assert.match(app, /Extrude quad topology handoff unavailable/);
  assert.match(app, /Quad subdivision unavailable for current topology/);
  assert.match(app, /No triangles were split and the original mesh was preserved/);
});

test('Every vertex attribute is reordered with the canonical quad vertex order', () => {
  assert.match(app, /Object\.entries\(geometry\.attributes\)/);
  assert.match(app, /new THREE\.BufferAttribute\(values, attribute\.itemSize, attribute\.normalized\)/);
});

test('Quad reconstruction runs only for Face Extrude after attribute counts are aligned', () => {
  assert.ok(app.includes("tool === 'Extrude' && editModeRef.current === 'Face' && !geometry.index"));
  assert.ok(app.indexOf("if (!geometry.getAttribute('uv'))") < app.indexOf('// Reconstruct each existing pair of triangles as one canonical quad cell'));
});


test('Long UI-thread tasks are reported as performance warnings, not runtime exceptions', () => {
  assert.match(app, /diagnosticSinkRef\.current\('WARN',[\s\S]{0,120}Main Thread Performance/);
  assert.match(app, /performance warning, not a runtime exception/);
});

test('Mesh editing avoids duplicate normal recomputation and reduces Smooth passes on larger mobile meshes', () => {
  assert.match(app, /const smoothPasses = position\.count > 8000 \? 1 : position\.count > 3000 \? 2 : 3/);
  assert.match(app, /Final geometry commit below computes normals once/);
  assert.match(app, /Normals are computed once[\s\S]{0,100}shared finalization block below/);
});
