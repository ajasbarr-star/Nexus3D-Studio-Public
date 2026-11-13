import test from 'node:test';
import assert from 'node:assert/strict';
import { collectObjectOnlyProjectNodes, getObjectOnlyProjectRoots, isShapeProjectMesh } from '../../src/project/object-project-scope.mjs';

function node(name, kind, extra = {}) {
  return { name, userData: { kind, ...extra }, parent: null, children: [], traverse(fn) { fn(this); this.children.forEach(child => child.traverse(fn)); } };
}
function add(parent, child) { child.parent = parent; parent.children.push(child); return child; }

test('keeps Shape meshes and their parent hierarchy while excluding cameras and lights', () => {
  const scene = node('scene', 'Scene');
  const group = add(scene, node('ImportedRoot', 'Imported Model'));
  const mesh = add(group, node('Cube1', 'Mesh', { shapeId: 'No.01', editorId: 'mesh-1' }));
  const camera = add(scene, node('Camera', 'Camera', { editorId: 'camera-1' }));
  camera.isCamera = true;
  const light = add(scene, node('KeyLight', 'Light', { editorId: 'light-1' }));
  light.isLight = true;
  const result = collectObjectOnlyProjectNodes([group, mesh, camera, light]);
  assert.deepEqual(result, [group, mesh]);
  assert.deepEqual(getObjectOnlyProjectRoots(result), [group]);
});

test('keeps rig bones and IK handles attached to an included Shape', () => {
  const shape = node('Character', 'Mesh', { shapeId: 'No.02' }); shape.isMesh = true;
  const rig = add(shape, node('Rig', 'Rig'));
  const bone = add(rig, node('RootBone', 'Bone')); bone.isBone = true;
  const target = add(rig, node('IK Target', 'IK Target'));
  const result = collectObjectOnlyProjectNodes([shape, rig, bone, target]);
  assert.deepEqual(result, [shape, rig, bone, target]);
  assert.deepEqual(getObjectOnlyProjectRoots(result), [shape]);
});

test('does not serialize unrelated groups or viewport-only helpers', () => {
  const unrelated = node('Empty', 'Group');
  const helper = node('Grid', 'GridHelper');
  assert.deepEqual(collectObjectOnlyProjectNodes([unrelated, helper]), []);
});

test('IK target and pole mesh helpers are attachments, not independent Shapes', () => {
  const target = node('IK Target', 'IK Target', { editorId: 'ik-target' });
  target.isMesh = true;
  const pole = node('IK Pole', 'IK Pole', { editorId: 'ik-pole' });
  pole.isMesh = true;
  assert.equal(isShapeProjectMesh(target), false);
  assert.equal(isShapeProjectMesh(pole), false);
});
