import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scanner = fs.readFileSync(new URL('../../src/dfi/mesh-forensics.ts', import.meta.url), 'utf8');

test('duplicate triangle detection is scoped to each mesh, not mesh names across objects', () => {
  assert.match(scanner, /const localTriangleKeys = new Set<string>\(\)/);
  assert.match(scanner, /if \(localTriangleKeys\.has\(triangleKey\)\)/);
  assert.doesNotMatch(scanner, /globalTriangleKeys/);
  assert.doesNotMatch(scanner, /meshName \+ '\\|' \+ triangleKey/);
});

test('per-mesh issue records use per-mesh counters', () => {
  assert.match(scanner, /let meshInvalidIndices = 0/);
  assert.match(scanner, /let meshDegenerateTriangles = 0/);
  assert.match(scanner, /let meshDuplicateTriangles = 0/);
  assert.match(scanner, /if \(meshInvalidIndices\) add\('ERROR', 'INVALID_INDEX'/);
  assert.match(scanner, /if \(meshDegenerateTriangles\) add\('WARN', 'DEGENERATE_TRIANGLES'/);
  assert.match(scanner, /if \(meshDuplicateTriangles\) add\('ERROR', 'DUPLICATE_TRIANGLES'/);
  assert.doesNotMatch(scanner, /if \(result\.invalidIndices\) add\('ERROR', 'INVALID_INDEX'/);
  assert.doesNotMatch(scanner, /if \(result\.duplicateTriangles\) add\('ERROR', 'DUPLICATE_TRIANGLES'/);
});
