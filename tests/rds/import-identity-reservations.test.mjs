import test from 'node:test';
import assert from 'node:assert/strict';
import { collectReservedIdentityIds } from '../../src/identity/import-identity-reservations.mjs';

test('reserves editor and Shape IDs from selectable and non-selectable scene nodes', () => {
  const nodes = [
    { userData: { editorId: 'shape-editor-1', shapeId: 'No.01' } },
    { userData: { editorId: 'hidden-bone-editor', ownerShapeId: 'No.01' } },
    { userData: { editorId: 'ik-helper-editor', shapeId: 'No.02' } },
    { userData: {} },
    null
  ];
  const reserved = collectReservedIdentityIds(nodes);
  assert.deepEqual([...reserved.editorIds].sort(), ['hidden-bone-editor', 'ik-helper-editor', 'shape-editor-1']);
  assert.deepEqual([...reserved.shapeIds].sort(), ['No.01', 'No.02']);
});

test('ignores empty, malformed, and missing identity values', () => {
  const reserved = collectReservedIdentityIds([
    { userData: { editorId: '', shapeId: 'No.1x' } },
    { userData: { editorId: 42, shapeId: null } },
    { userData: null },
    {}
  ]);
  assert.equal(reserved.editorIds.size, 0);
  assert.equal(reserved.shapeIds.size, 0);
});

test('accepts an empty or non-array input safely', () => {
  assert.equal(collectReservedIdentityIds().editorIds.size, 0);
  assert.equal(collectReservedIdentityIds(null).shapeIds.size, 0);
});
