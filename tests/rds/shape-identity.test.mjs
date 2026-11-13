import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateShapeIdentity, ensureShapeIdentity, formatShapeIdentity } from '../../src/identity/shape-identity.mjs';

const shape = (shapeId, name = 'Cube1') => ({ name, userData: { shapeId } });

test('allocates sequential permanent IDs without reusing occupied IDs', () => {
  const objects = [shape('No.01'), shape('No.03')];
  assert.deepEqual(allocateShapeIdentity(objects, 1), { shapeId: 'No.04', nextId: 5 });
});

test('preserves an existing identity across rename', () => {
  const cube = shape('No.01');
  cube.name = 'Renamed Cube';
  assert.deepEqual(ensureShapeIdentity(cube, [cube], 2), { shapeId: 'No.01', nextId: 2 });
  assert.equal(formatShapeIdentity(cube.name, cube.userData.shapeId), 'Renamed Cube-ID No.01');
});

test('assigns a fresh identity to a duplicate carrying a copied ID', () => {
  const source = shape('No.01');
  const duplicate = shape('No.01', 'Cube1 copy');
  const result = ensureShapeIdentity(duplicate, [source, duplicate], 2);
  assert.equal(result.shapeId, 'No.02');
  assert.equal(source.userData.shapeId, 'No.01');
  assert.equal(duplicate.userData.shapeId, 'No.02');
});

test('keeps the next counter above the largest restored identity', () => {
  assert.deepEqual(allocateShapeIdentity([shape('No.08')], 2), { shapeId: 'No.09', nextId: 10 });
});

test('rejects invalid IDs when formatting identity labels', () => {
  assert.throws(() => formatShapeIdentity('Cube1', 'Cube1'), /valid permanent Shape ID/);
});
