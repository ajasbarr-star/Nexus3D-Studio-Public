import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scanner = fs.readFileSync(new URL('../../src/dfi/mesh-forensics.ts', import.meta.url), 'utf8');

test('duplicate triangle detection is scoped to each mesh, not mesh names across objects', () => {
  assert.match(scanner, /const localTriangleKeys = new Set<string>\(\)/);
  assert.match(scanner, /if \(localTriangleKeys\.has\(triangleKey\)\)/);
  assert.doesNotMatch(scanner, /globalTriangleKeys/);
  assert.doesNotMatch(scanner, /meshName \+ '\\|' \+ triangleKey/);
});

test('per-mesh issue records use per-mesh counters', () => {
  assert.match(scanner, /let meshInvalidIndices = 0/);
  assert.match(scanner, /let meshDegenerateTriangles = 0/);
  assert.match(scanner, /let meshDuplicateTriangles = 0/);
  assert.match(scanner, /if \(meshInvalidIndices\) add\('ERROR', 'INVALID_INDEX'/);
  assert.match(scanner, /if \(meshDegenerateTriangles\) add\('WARN', 'DEGENERATE_TRIANGLES'/);
  assert.match(scanner, /if \(meshDuplicateTriangles\) add\('ERROR', 'DUPLICATE_TRIANGLES'/);
  assert.doesNotMatch(scanner, /if \(result\.invalidIndices\) add\('ERROR', 'INVALID_INDEX'/);
  assert.doesNotMatch(scanner, /if \(result\.duplicateTriangles\) add\('ERROR', 'DUPLICATE_TRIANGLES'/);
});


import ts from 'typescript';

async function loadScanner() {
  const source = fs.readFileSync(new URL('../../src/dfi/mesh-forensics.ts', import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'));
}

function makeMesh(name, positions, indices, userData = {}, parent = null) {
  const position = {
    count: positions.length / 3, itemSize: 3,
    getX: i => positions[i * 3], getY: i => positions[i * 3 + 1], getZ: i => positions[i * 3 + 2]
  };
  const index = indices ? { count: indices.length, getX: i => indices[i] } : null;
  return {
    isMesh: true, name, uuid: name, userData, parent,
    geometry: { getAttribute: key => key === 'position' ? position : null, getIndex: () => index }
  };
}

function makeScene(objects) {
  return { traverse(callback) { const visit = object => { callback(object); (object.children || []).forEach(visit); }; objects.forEach(visit); } };
}

test('indexed topology does not weld coincident split vertices into false non-manifold edges', async () => {
  const { scanMeshCore } = await loadScanner();
  const mesh = makeMesh('Split seam', [
    0,0,0, 1,0,0, 0,1,0,
    0,0,0, 1,0,0, 0,-1,0,
    0,0,0, 1,0,0, 0,0,1
  ], [0,1,2, 3,4,5, 6,7,8]);
  const result = scanMeshCore(makeScene([mesh]));
  assert.equal(result.nonManifoldEdges, 0);
  assert.equal(result.issues.some(issue => issue.code === 'NON_MANIFOLD_EDGE'), false);
  assert.ok(result.duplicatePositionGroups > 0);
});

test('editor camera descendants and tagged IK/helper meshes are excluded from user geometry totals', async () => {
  const { scanMeshCore } = await loadScanner();
  const cameraRoot = { userData: { isCineCamera: true }, parent: null };
  const triangle = [0,0,0, 1,0,0, 0,1,0];
  const cameraMesh = makeMesh('Camera chassis', triangle, [0,1,2], {}, cameraRoot);
  const jointMesh = makeMesh('Bone joint', triangle, [0,1,2], { nexusJointVisual: true });
  const userMesh = makeMesh('User Cube', triangle, [0,1,2]);
  const result = scanMeshCore(makeScene([cameraRoot, cameraMesh, jointMesh, userMesh]));
  assert.equal(result.meshes, 1);
  assert.equal(result.triangles, 1);
  assert.equal(result.issues.some(issue => issue.mesh === 'Camera chassis'), false);
});

test('scene rollup errors are not counted as additional object-level defects', async () => {
  const { scanMeshCore } = await loadScanner();
  const mesh = makeMesh('Duplicate face', [
    0,0,0, 1,0,0, 0,1,0
  ], [0,1,2, 0,1,2]);
  const result = scanMeshCore(makeScene([mesh]));
  const objectErrors = result.issues.filter(issue => issue.severity === 'ERROR' && !issue.code.startsWith('SCENE_'));
  const rollups = result.issues.filter(issue => issue.severity === 'ERROR' && issue.code.startsWith('SCENE_'));
  assert.equal(result.duplicateTriangles, 1);
  assert.equal(objectErrors.length, 1);
  assert.equal(rollups.length, 1);
});


test('indexed triangles with coincident positions but distinct vertex indices are not exact duplicates', async () => {
  const { scanMeshCore } = await loadScanner();
  const mesh = makeMesh('Split face records', [
    0,0,0, 1,0,0, 0,1,0,
    0,0,0, 1,0,0, 0,1,0
  ], [0,1,2, 3,4,5]);
  const result = scanMeshCore(makeScene([mesh]));
  assert.equal(result.duplicateTriangles, 0);
  assert.equal(result.issues.some(issue => issue.code === 'DUPLICATE_TRIANGLES'), false);
  assert.ok(result.duplicatePositionGroups > 0);
});

test('indexed triangle repeated with the same vertex indices remains an exact duplicate', async () => {
  const { scanMeshCore } = await loadScanner();
  const mesh = makeMesh('Repeated indexed face', [
    0,0,0, 1,0,0, 0,1,0
  ], [0,1,2, 0,1,2]);
  const result = scanMeshCore(makeScene([mesh]));
  assert.equal(result.duplicateTriangles, 1);
  assert.ok(result.issues.some(issue => issue.code === 'DUPLICATE_TRIANGLES' && issue.severity === 'ERROR'));
});


test('non-indexed duplicate and non-manifold findings include bounded vertex-level evidence', async () => {
  const { scanMeshCore } = await loadScanner();
  const duplicate = makeMesh('Extrude duplicate sample', [
    0,0,0, 1,0,0, 0,1,0,
    0,0,0, 1,0,0, 0,1,0
  ], null);
  const duplicateResult = scanMeshCore(makeScene([duplicate]));
  const duplicateIssue = duplicateResult.issues.find(issue => issue.code === 'DUPLICATE_TRIANGLES');
  assert.ok(duplicateIssue);
  assert.match(duplicateIssue.detail, /triangle #1/);
  assert.match(duplicateIssue.detail, /v3=\(0,0,0\)/);

  const nonManifold = makeMesh('Extrude edge sample', [
    0,0,0, 1,0,0, 0,1,0,
    1,0,0, 0,0,0, 0,-1,0,
    0,0,0, 1,0,0, 0,0,1
  ], null);
  const edgeResult = scanMeshCore(makeScene([nonManifold]));
  const edgeIssue = edgeResult.issues.find(issue => issue.code === 'NON_MANIFOLD_EDGE');
  assert.ok(edgeIssue);
  assert.match(edgeIssue.detail, /edge incidence 3/);
  assert.match(edgeIssue.detail, /v0=\(0,0,0\)/);
});
