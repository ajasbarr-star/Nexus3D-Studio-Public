import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCharacterMeshAssignments,
  chooseBoneForMesh,
  inferCharacterPart,
  isCharacterMeshCandidate,
  summarizeCharacterAssignments
} from '../../src/rig/character-rigging.mjs';

const bone = (name, x = 0, y = 0, z = 0) => ({ name, worldPosition: { x, y, z } });
const mesh = (name, x = 0, y = 0, z = 0) => ({
  name, isMesh: true, center: { x, y, z },
  geometry: { getAttribute: key => key === 'position' ? {} : null },
  userData: {}
});

test('body-part names and side suffixes are recognized', () => {
  assert.deepEqual(inferCharacterPart('UpperArm_L'), { part: 'upperArm', side: 'L', source: 'name' });
  assert.deepEqual(inferCharacterPart('right_forearm_mesh'), { part: 'forearm', side: 'R', source: 'name' });
  assert.equal(inferCharacterPart('Mesh_017').part, null);
});

test('semantic body-part mapping prefers the matching side-specific bone', () => {
  const left = bone('UpperArm.L', -1, 1, 0);
  const right = bone('UpperArm.R', 1, 1, 0);
  const result = chooseBoneForMesh(mesh('UpperArm_L', -0.9, 1, 0), [right, left]);
  assert.equal(result.bone, left);
  assert.equal(result.needsReview, false);
  assert.equal(result.reason, 'semantic-name-match');
});

test('unknown mesh names use spatial fallback and require review', () => {
  const near = bone('Forearm.L', -1, 0.5, 0);
  const far = bone('Head', 0, 2, 0);
  const result = chooseBoneForMesh(mesh('Mesh_017', -0.9, 0.4, 0), [far, near]);
  assert.equal(result.bone, near);
  assert.equal(result.needsReview, true);
  assert.equal(result.reason, 'spatial-fallback');
});

test('candidate filter excludes editor joint and control marker visuals', () => {
  assert.equal(isCharacterMeshCandidate(mesh('Body')), true);
  assert.equal(isCharacterMeshCandidate({ ...mesh('Joint'), userData: { nexusJointVisual: true } }), false);
  assert.equal(isCharacterMeshCandidate({ ...mesh('Handle'), userData: { rigControlMarker: true } }), false);
});

test('batch assignment reports ready, review, and unassigned counts', () => {
  const assignments = buildCharacterMeshAssignments(
    [mesh('Head'), mesh('Mesh_017')],
    [bone('Head'), bone('Chest', 0, 1, 0)]
  );
  assert.equal(assignments.length, 2);
  const summary = summarizeCharacterAssignments(assignments);
  assert.equal(summary.ready, 1);
  assert.equal(summary.review, 1);
  assert.equal(summary.rigid, 2);
});
