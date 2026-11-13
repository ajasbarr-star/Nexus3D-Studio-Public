import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTopology, validateTopology, moveTopologyVertices, subdivideQuadFace, buildTopologyFromCanonicalQuadGeometry, buildTopologyFromIndexedQuadGeometry } from '../../src/geometry/topology-model.mjs';

const square = () => buildTopology({
  vertices: [
    { id: 'a', position: [0, 0, 0] }, { id: 'b', position: [2, 0, 0] },
    { id: 'c', position: [2, 2, 0] }, { id: 'd', position: [0, 2, 0] },
  ],
  faces: [{ id: 'f0', vertices: ['a', 'b', 'c', 'd'] }],
});

test('persistent topology stores ordered polygon loops and derived edge adjacency', () => {
  const topology = square();
  assert.equal(topology.faces.length, 1);
  assert.equal(topology.faces[0].vertices.length, 4);
  assert.equal(topology.edges.length, 4);
  assert.equal(validateTopology(topology).valid, true);
});

test('vertex movement changes coordinates without changing face or edge connectivity', () => {
  const before = square();
  const after = moveTopologyVertices(before, { b: [3, 0, 0], c: [3, 2, 0] });
  assert.deepEqual(after.faces[0].vertices, before.faces[0].vertices);
  assert.equal(after.edges.length, before.edges.length);
  assert.deepEqual(after.vertices.find(vertex => vertex.id === 'b').position, [3, 0, 0]);
  assert.equal(validateTopology(after).valid, true);
});

test('quad subdivision replaces one face with four connected quad faces', () => {
  const result = subdivideQuadFace(square(), 'f0');
  assert.equal(result.faces.length, 4);
  assert.ok(result.faces.every(face => face.vertices.length === 4));
  assert.equal(result.vertices.length, 9);
  assert.equal(validateTopology(result).valid, true);
});

test('subdivision rejects missing and non-quad faces without mutating input', () => {
  const topology = square();
  assert.throws(() => subdivideQuadFace(topology, 'missing'), /missing face/);
  const triangle = buildTopology({
    vertices: topology.vertices.slice(0, 3),
    faces: [{ id: 'tri', vertices: ['a', 'b', 'c'] }],
  });
  assert.throws(() => subdivideQuadFace(triangle, 'tri'), /exactly four/);
  assert.equal(topology.faces.length, 1);
});

test('topology builder rejects duplicate IDs and dangling face references', () => {
  assert.throws(() => buildTopology({
    vertices: [{ id: 'a', position: [0,0,0] }, { id: 'a', position: [1,0,0] }],
    faces: [],
  }), /duplicate vertex ID/);
  assert.throws(() => buildTopology({
    vertices: [{ id: 'a', position: [0,0,0] }],
    faces: [{ id: 'f', vertices: ['a', 'missing', 'a2'] }],
  }), /missing vertex/);
});


test('canonical quad render cells become persistent face loops with shared edge adjacency', () => {
  const positions = [
    0,0,0, 1,0,0, 1,1,0, 0,0,0, 1,1,0, 0,1,0,
    1,0,0, 2,0,0, 2,1,0, 1,0,0, 2,1,0, 1,1,0,
  ];
  const topology = buildTopologyFromCanonicalQuadGeometry(positions);
  assert.ok(topology);
  assert.equal(topology.faces.length, 2);
  assert.deepEqual(topology.faces.map(face => face.renderIndices), [[0,1,2,5],[6,7,8,11]]);
  assert.equal(topology.vertices.length, 6);
  assert.equal(topology.edges.length, 7);
  assert.equal(topology.edges.filter(edge => edge.faces.length === 2).length, 1);
  assert.equal(validateTopology(topology).valid, true);
});

test('canonical quad adapter fails closed for incomplete or malformed render streams', () => {
  assert.equal(buildTopologyFromCanonicalQuadGeometry([0,0,0, 1,0,0, 0,1,0]), null);
  assert.equal(buildTopologyFromCanonicalQuadGeometry([
    0,0,0, 1,0,0, 1,1,0, 0,0,0, 1,1,0, 0,0,0,
  ]), null);
});


test('Subdivide consumes persistent face-loop render mappings before triangle-pair fallback', async () => {
  const source = await import('node:fs');
  const app = source.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  const start = app.indexOf('const storedTopology = target.userData.nexusTopology;');
  const fallback = app.indexOf('if (!sourceQuadCorners && geometry.index', start);
  assert.ok(start >= 0, 'Subdivide must read persistent topology');
  assert.ok(fallback > start, 'legacy reconstruction must remain a fallback only');
  assert.match(app.slice(start, fallback), /face\.renderIndices/);
});


test('indexed BoxGeometry-style quad cells retain expanded render-corner offsets', () => {
  const positions = [0,0,0, 1,0,0, 1,1,0, 0,1,0];
  const indices = [0,1,3, 1,2,3];
  const topology = buildTopologyFromIndexedQuadGeometry(positions, indices);
  assert.ok(topology);
  assert.equal(topology.faces.length, 1);
  assert.deepEqual(topology.faces[0].vertices.length, 4);
  assert.deepEqual(topology.faces[0].renderIndices, [0,1,4,2]);
  assert.equal(validateTopology(topology).valid, true);
});
