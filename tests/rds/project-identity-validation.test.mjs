import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectIdentityData } from '../../src/identity/project-identity-validation.mjs';

const mesh = (editorId, shapeId, name = 'Cube') => ({
  name, kind: 'Mesh', editorId, shapeId,
  geometry: { attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } } }
});

test('accepts unique Shape and editor IDs with valid attachment references', () => {
  const objects = [
    mesh('mesh-1', 'No.01'),
    { name: 'Root', kind: 'Bone', editorId: 'bone-1' },
    { name: 'Rig', kind: 'Rig', editorId: 'rig-1', parentEditorId: 'mesh-1' },
    { name: 'Target', kind: 'IK Target', editorId: 'target-1', editorData: { rigRootBoneId: 'bone-1' } },
    { name: 'Skinned', kind: 'Mesh', editorId: 'skin-1', shapeId: 'No.02', skeleton: { boneEditorIds: ['bone-1'] } }
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

test('keeps legacy projects compatible while still rejecting duplicate editor IDs', () => {
  assert.deepEqual(validateProjectIdentityData([
    { name: 'Legacy Cube', kind: 'Mesh', geometry: { attributes: { position: { array: [0,0,0,1,0,0,0,1,0] } } }
  ], 3), { editorIdCount: 0, shapeIdCount: 0 });
});
