import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveImportedShapeIds } from '../../src/identity/import-shape-id-reservations.mjs';

test('reuses one remapped Shape ID for every node referencing the same source Shape', () => {
  const result = reserveImportedShapeIds(
    [{ shapeId: 'No.01' }, { kind: 'Bone', ownerShapeId: 'No.01', shapeId: 'No.01' }, { kind: 'IK Target', shapeId: 'No.01' }],
    new Set(['No.01']),
    2
  );
  assert.equal(result.shapeIdRemap.get('No.01'), 'No.02');
  assert.deepEqual(result.reservedShapeIds, new Set(['No.01', 'No.02']));
  assert.equal(result.nextShapeId, 3);
});

test('keeps non-colliding IDs and advances the next ID beyond existing reservations', () => {
  const result = reserveImportedShapeIds(
    [{ shapeId: 'No.04' }, { shapeId: 'No.07' }],
    new Set(['No.02', 'No.03']),
    1
  );
  assert.equal(result.shapeIdRemap.size, 0);
  assert.ok(result.reservedShapeIds.has('No.04'));
  assert.ok(result.reservedShapeIds.has('No.07'));
  assert.equal(result.nextShapeId, 8);
});

test('allocates distinct IDs for distinct colliding source IDs', () => {
  const result = reserveImportedShapeIds(
    [{ shapeId: 'No.01' }, { shapeId: 'No.02' }],
    new Set(['No.01', 'No.02']),
    3
  );
  assert.equal(result.shapeIdRemap.get('No.01'), 'No.03');
  assert.equal(result.shapeIdRemap.get('No.02'), 'No.04');
  assert.equal(result.nextShapeId, 5);
});
