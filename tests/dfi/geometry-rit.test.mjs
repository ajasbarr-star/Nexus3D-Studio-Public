import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const scanner = fs.readFileSync(new URL('../../src/geometry/geometry-rit.ts', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');

test('Geometry RIT is an independent toolbar diagnostic with its own results panel', () => {
  assert.match(app, /aria-label="Open Geometry RIT diagnostics"/);
  assert.match(app, /geometryRitOpen && !cameraView && !animationMode/);
  assert.match(app, /aria-label="Independent Geometry RIT Results Report"/);
  assert.match(app, /GEOMETRY RIT/);
  assert.match(styles, /\.geometry-rit-panel/);
});

test('Opening Geometry RIT resets all counters and requires an explicit fresh scan', () => {
  assert.match(app, /if \(!geometryRitOpen\) \{ setGeometryRitReport\('NOT SCANNED/);
  assert.match(app, /setGeometryRitSummary\(\{ status: 'NOT SCANNED', meshes: 0, vertices: 0, triangles: 0, errors: 0, warnings: 0 \}\)/);
  assert.match(app, /onClick=\{runGeometryRitScan\}/);
});

test('Geometry RIT exposes an explicit Scan action and a separate Copy Report action', () => {
  assert.match(app, /onClick=\{runGeometryRitScan\}/);
  assert.match(app, /SCAN GEOMETRY/);
  assert.match(app, /onClick=\{copyGeometryRitReport\}/);
  assert.match(app, /COPY REPORT/);
  assert.match(app, /geometryRitSummary\.status === 'NOT SCANNED'/);
});

test('Geometry RIT checks coplanar and non-coplanar shared edges without mutating geometry', () => {
  assert.match(scanner, /coplanarSharedEdges/);
  assert.match(scanner, /nonCoplanarSharedEdges/);
  assert.match(scanner, /Math\.cos\(3 \* Math\.PI \/ 180\)/);
  assert.match(scanner, /Read-only runtime scan/);
  assert.match(scanner, /does not retain the artist-intended plane/);
  assert.match(scanner, /No automatic repair was performed/);
});

test('Geometry RIT reports uncertainty instead of claiming unverified perimeter deformation or historical regression', () => {
  assert.match(scanner, /INSUFFICIENT EVIDENCE/);
  assert.match(scanner, /Flat-surface perimeter deformation: INSUFFICIENT EVIDENCE/);
  assert.match(scanner, /current-scene diagnostic snapshot, not a historical before\/after regression proof/);
});
