import test from 'node:test';
import assert from 'node:assert/strict';
import { getIkSolvePath, isIkBoneLocked } from '../../src/rig/ik-constraints.mjs';

const bone = (name, flags = {}) => ({ name, userData: flags });

test('a locked Pelvis becomes the fixed anchor and excludes all ancestors from IK rotation', () => {
  const root = bone('Root');
  const pelvis = bone('Pelvis', { locked: true });
  const spine = bone('Spine');
  const chest = bone('Chest');
  const hand = bone('Hand');
  assert.deepEqual(getIkSolvePath([root, pelvis, spine, chest, hand], 3), [pelvis, spine, chest, hand]);
});

test('the deepest locked bone becomes the anchor when both Root and Pelvis are locked', () => {
  const root = bone('Root', { locked: true });
  const pelvis = bone('Pelvis', { objectManagerLocked: true });
  const spine = bone('Spine');
  const hand = bone('Hand');
  assert.deepEqual(getIkSolvePath([root, pelvis, spine, hand]), [pelvis, spine, hand]);
});

test('Scene Tree object locks and Manual IK bone locks both constrain the solver', () => {
  assert.equal(isIkBoneLocked(bone('Pelvis', { locked: true })), true);
  assert.equal(isIkBoneLocked(bone('Pelvis', { objectManagerLocked: true })), true);
  assert.equal(isIkBoneLocked(bone('Spine')), false);
});

test('an unlocked chain retains the previous chainLength behavior', () => {
  const path = [bone('Root'), bone('Pelvis'), bone('Spine'), bone('Chest'), bone('Hand')];
  assert.deepEqual(getIkSolvePath(path, 2), path.slice(-3));
});

test('a locked end bone has no movable descendant segment to solve', () => {
  const root = bone('Root');
  const hand = bone('Hand', { locked: true });
  assert.deepEqual(getIkSolvePath([root, hand]), [hand]);
});
