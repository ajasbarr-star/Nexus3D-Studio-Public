import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTopology, validateTopology, moveTopologyVertices, subdivideQuadFace } from '../../src/geometry/topology-model.mjs';

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
