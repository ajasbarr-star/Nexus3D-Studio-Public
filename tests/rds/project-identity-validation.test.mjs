import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectIdentityData } from '../../src/identity/project-identity-validation.mjs';

const mesh = (editorId, shapeId, name = 'Cube') => ({
  name, kind: 'Mesh', editorId, shapeId,
  geometry: { attributes: { position: { itemSize: 3, array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } } }
});

test('accepts unique Shape and editor IDs with valid attachment references', () => {
  const objects = [
    mesh('mesh-1', 'No.01'),
    { name: 'Root', kind: 'Bone', editorId: 'bone-1', ownerShapeId: 'No.01' },
    { name: 'Rig', kind: 'Rig', editorId: 'rig-1', parentEditorId: 'mesh-1' },
    { name: 'Target', kind: 'IK Target', editorId: 'target-1', editorData: { rigRootBoneId: 'bone-1' } },
    { ...mesh('skin-1', 'No.02', 'Skinned'), skeleton: { boneEditorIds: ['bone-1'] } }
  ];
  assert.deepEqual(validateProjectIdentityData(objects, 4), { editorIdCount: 5, shapeIdCount: 2 });
});

test('rejects duplicate editor IDs before scene restoration', () => {
  assert.throws(() => validateProjectIdentityData([
    mesh('same', 'No.01'), mesh('same', 'No.02')
  ], 4), /duplicate editor object ID/);
});

test('rejects duplicate Shape IDs before scene restoration', () => {
  assert.throws(() => validateProjectIdentityData([
    mesh('mesh-1', 'No.01'), mesh('mesh-2', 'No.01')
  ], 4), /duplicate Shape ID/);
});

test('rejects missing parent, skeleton bone, and IK root references', () => {
  assert.throws(() => validateProjectIdentityData([
    mesh('mesh-1', 'No.01'), { editorId: 'child', parentEditorId: 'missing' }
  ], 4), /missing parent object/);
  assert.throws(() => validateProjectIdentityData([
    mesh('mesh-1', 'No.01'), { editorId: 'skin', skeleton: { boneEditorIds: ['missing'] } }
  ], 4), /missing skeleton bone/);
  assert.throws(() => validateProjectIdentityData([
    mesh('mesh-1', 'No.01'), { editorId: 'target', editorData: { rigRootBoneId: 'missing' } }
  ], 4), /missing IK root bone/);
});

test('rejects attached nodes whose owning Shape is missing', () => {
  assert.throws(() => validateProjectIdentityData([
    mesh('mesh-1', 'No.01'), { kind: 'Bone', editorId: 'bone-1', ownerShapeId: 'No.99' }
  ], 4), /missing owning Shape/);
});

test('keeps legacy projects compatible while still rejecting duplicate editor IDs', () => {
  assert.deepEqual(validateProjectIdentityData([
    { name: 'Legacy Cube', kind: 'Mesh', geometry: { attributes: { position: { itemSize: 3, array: [0,0,0,1,0,0,0,1,0] } } } }
  ], 3), { editorIdCount: 0, shapeIdCount: 0 });
});


test('rejects non-object entries and malformed geometry buffers', () => {
  assert.throws(() => validateProjectIdentityData([null], 4), /invalid scene object/);
  assert.throws(() => validateProjectIdentityData([
    { ...mesh('mesh-1', 'No.01'), geometry: { attributes: { position: { itemSize: 3, array: [0, 0, NaN, 1, 0, 0, 0, 1, 0] } } } }
  ], 4), /invalid geometry attribute position/);
  assert.throws(() => validateProjectIdentityData([
    { ...mesh('mesh-1', 'No.01'), geometry: { attributes: { position: { itemSize: 3, array: [0,0,0,1,0,0,0,1,0] } }, index: [0, 1, 99] } }
  ], 4), /invalid geometry index buffer/);
});

test('rejects self-parenting and cyclic scene hierarchies', () => {
  assert.throws(() => validateProjectIdentityData([
    mesh('mesh-1', 'No.01'), { editorId: 'self', parentEditorId: 'self' }
  ], 4), /cannot parent itself/);
  assert.throws(() => validateProjectIdentityData([
    mesh('mesh-1', 'No.01'), { editorId: 'a', parentEditorId: 'b' }, { editorId: 'b', parentEditorId: 'a' }
  ], 4), /parent cycle/);
});

test('requires IK and skeleton references to point to actual Bone objects', () => {
  assert.throws(() => validateProjectIdentityData([
    mesh('mesh-1', 'No.01'), { editorId: 'not-bone', kind: 'Mesh' },
    { editorId: 'skin', skeleton: { boneEditorIds: ['not-bone'] } }
  ], 4), /missing skeleton bone/);
  assert.throws(() => validateProjectIdentityData([
    mesh('mesh-1', 'No.01'), { editorId: 'not-bone', kind: 'Rig' },
    { editorId: 'target', editorData: { rigRootBoneId: 'not-bone' } }
  ], 4), /missing IK root bone/);
});
