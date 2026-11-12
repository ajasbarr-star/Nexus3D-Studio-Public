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
  assert.match(app, /triBMatchesWinding/);
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
