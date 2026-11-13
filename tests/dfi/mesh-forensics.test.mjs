import test from 'node:test';
import assert from 'node:assert/strict';
import { scanMeshCore } from '../../src/dfi/mesh-forensics.ts';

function makeMesh(name, uuid, positions, indices) {
  const position = {
    count: positions.length / 3,
    itemSize: 3,
    getX: i => positions[i * 3],
    getY: i => positions[i * 3 + 1],
    getZ: i => positions[i * 3 + 2],
  };
  const index = indices ? { count: indices.length, getX: i => indices[i] } : null;
  return { name, uuid, userData: {}, isMesh: true, geometry: {
    getAttribute: key => key === 'position' ? position : null,
    getIndex: () => index,
  }};
}
function makeScene(meshes) {
  return { traverse(fn) { meshes.forEach(fn); } };
}

test('same-named separate objects are not counted as duplicate triangles', () => {
  const positions = [0,0,0, 1,0,0, 0,1,0];
  const scene = makeScene([
    makeMesh('X', 'object-a', positions, [0,1,2]),
    makeMesh('X', 'object-b', positions, [0,1,2]),
  ]);
  const report = scanMeshCore(scene);
  assert.equal(report.duplicateTriangles, 0);
  assert.equal(report.issues.filter(issue => issue.code === 'DUPLICATE_TRIANGLES').length, 0);
});

test('duplicate triangles are detected within one mesh only', () => {
  const positions = [0,0,0, 1,0,0, 0,1,0];
  const report = scanMeshCore(makeScene([
    makeMesh('Cube', 'cube-1', positions, [0,1,2, 2,1,0]),
  ]));
  assert.equal(report.duplicateTriangles, 1);
  assert.equal(report.issues.filter(issue => issue.code === 'DUPLICATE_TRIANGLES').length, 1);
});

test('per-mesh findings use local counters rather than repeating earlier mesh errors', () => {
  const valid = makeMesh('Valid', 'valid-1', [0,0,0, 1,0,0, 0,1,0], [0,1,2]);
  const invalid = makeMesh('Invalid', 'invalid-1', [0,0,0, 1,0,0, 0,1,0], [0,1,99]);
  const report = scanMeshCore(makeScene([invalid, valid]));
  const invalidFindings = report.issues.filter(issue => issue.code === 'INVALID_INDEX');
  assert.equal(invalidFindings.length, 1);
  assert.equal(invalidFindings[0].mesh, 'Invalid');
});
