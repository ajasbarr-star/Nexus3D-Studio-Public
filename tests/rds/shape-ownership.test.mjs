import test from 'node:test';
import assert from 'node:assert/strict';
import { assignShapeOwnership, resolveOwnerShapeId } from '../../src/identity/shape-ownership.mjs';

const makeNode = (shapeId = null) => ({ userData: shapeId ? { shapeId } : {}, parent: null });
const attach = (parent, child) => { child.parent = parent; return child; };

test('a Shape owns itself and all nested editable attachments', () => {
  const shape = makeNode('No.01');
  const rig = attach(shape, makeNode());
  const bone = attach(rig, makeNode());
  const handle = attach(bone, makeNode());
  assignShapeOwnership([shape, rig, bone, handle]);
  assert.equal(resolveOwnerShapeId(shape), 'No.01');
  assert.equal(rig.userData.ownerShapeId, 'No.01');
  assert.equal(bone.userData.ownerShapeId, 'No.01');
  assert.equal(handle.userData.ownerShapeId, 'No.01');
});

test('nested Shape meshes own their own descendants rather than inheriting a parent Shape ID', () => {
  const parentShape = makeNode('No.01');
  const childShape = attach(parentShape, makeNode('No.02'));
  const childBone = attach(childShape, makeNode());
  assignShapeOwnership([parentShape, childShape, childBone]);
  assert.equal(childShape.userData.ownerShapeId, 'No.02');
  assert.equal(childBone.userData.ownerShapeId, 'No.02');
});

test('detached nodes do not retain a stale Shape owner', () => {
  const oldShape = makeNode('No.01');
  const node = attach(oldShape, makeNode());
  assignShapeOwnership([node]);
  node.parent = null;
  assignShapeOwnership([node]);
  assert.equal(node.userData.ownerShapeId, undefined);
});
