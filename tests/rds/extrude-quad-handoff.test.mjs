import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');

test('Face Extrude verifies canonical quad triangle pairs before enabling quad-grid Subdivide', () => {
  assert.match(app, /extrudeQuadGridVerified = false/);
  assert.match(app, /position\.count % 6 === 0/);
  assert.match(app, /closePoint\(q\[0\], q\[3\]\)/);
  assert.match(app, /closePoint\(q\[2\], q\[4\]\)/);
  assert.match(app, /normalA\.clone\(\)\.normalize\(\)\.dot\(normalB\.clone\(\)\.normalize\(\)\) < 0\.999/);
  assert.match(app, /tool === 'Extrude' && extrudeQuadGridVerified/);
  assert.match(app, /layout: 'canonical-v1'/);
});

test('Unsupported triangle streams are not promoted to verified quad topology', () => {
  assert.match(app, /if \(editModeRef\.current === 'Face' && !geometry\.index\)/);
  assert.match(app, /extrudeQuadGridVerified = verified/);
  assert.match(app, /Quad subdivision unavailable for current topology/);
  assert.match(app, /No triangles were split and the original mesh was preserved/);
});
