import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTopology, validateTopology, moveTopologyVertices, subdivideQuadFace, buildTopologyFromCanonicalQuadGeometry, buildTopologyFromIndexedQuadGeometry, updateTopologyPositionsFromRenderGeometry } from '../../src/geometry/topology-model.mjs';

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


test('Move Face refreshes positions from persistent face loops without triangle-pair inference', () => {
  const initial = [
    0,0,0, 1,0,0, 1,1,0, 0,0,0, 1,1,0, 0,1,0,
    1,0,0, 2,0,0, 2,1,0, 1,0,0, 2,1,0, 1,1,0,
  ];
  const topology = buildTopologyFromCanonicalQuadGeometry(initial);
  assert.ok(topology);
  const moved = [...initial];
  for (let i = 0; i < moved.length / 3; i++) if (moved[i * 3] === 1) moved[i * 3 + 2] += 0.25;
  const updated = updateTopologyPositionsFromRenderGeometry(topology, moved);
  assert.ok(updated);
  assert.deepEqual(updated.faces.map(face => face.vertices), topology.faces.map(face => face.vertices));
  assert.equal(updated.edges.length, topology.edges.length);
  assert.equal(validateTopology(updated).valid, true);
  assert.equal(updated.vertices.find(vertex => vertex.id === 'v:1.000000,0.000000,0.000000').position[2], 0.25);
});

test('persistent topology refresh fails closed when shared render copies disagree', () => {
  const positions = [
    0,0,0, 1,0,0, 1,1,0, 0,0,0, 1,1,0, 0,1,0,
    1,0,0, 2,0,0, 2,1,0, 1,0,0, 2,1,0, 1,1,0,
  ];
  const topology = buildTopologyFromCanonicalQuadGeometry(positions);
  assert.ok(topology);
  positions[18] += 0.2;
  assert.equal(updateTopologyPositionsFromRenderGeometry(topology, positions), null);
});

test('Move Face transform updates stored topology rather than rebuilding from triangles', async () => {
  const source = await import('node:fs');
  const app = source.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  const start = app.indexOf("const sourceTopology = existingTopology?.version === 1");
  const end = app.indexOf("refreshTopologyOverlay(selection.mesh);", start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /existingTopology\?\.version === 1/);
  assert.match(block, /updateTopologyPositionsFromRenderGeometry/);
  assert.match(block, /nexusQuadGridLayout === 'canonical-v1'/);
  assert.match(block, /buildTopologyFromCanonicalQuadGeometry/);
  assert.doesNotMatch(block, /triangle-pair/);
});


test('Move Face can recover missing metadata only from a verified quad layout marker', async () => {
  const source = await import('node:fs');
  const app = source.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  const start = app.indexOf("const sourceTopology = existingTopology?.version === 1");
  const end = app.indexOf("const updatedTopology =", start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /nexusQuadGridLayout === 'canonical-v1'/);
  assert.match(block, /buildTopologyFromCanonicalQuadGeometry/);
  assert.doesNotMatch(block, /triangle-pair/);
});


test('multi-object topology ownership is isolated across repeated position updates', () => {
  const source = [
    0,0,0, 1,0,0, 1,1,0, 0,0,0, 1,1,0, 0,1,0,
    1,0,0, 2,0,0, 2,1,0, 1,0,0, 2,1,0, 1,1,0,
  ];
  const objectA = buildTopologyFromCanonicalQuadGeometry(source);
  const objectB = buildTopologyFromCanonicalQuadGeometry(source);
  assert.ok(objectA && objectB);
  const movedA = source.map((value, index) => index % 3 === 2 ? value + 0.5 : value);
  const updatedA = updateTopologyPositionsFromRenderGeometry(objectA, movedA);
  assert.ok(updatedA);
  assert.deepEqual(objectB.vertices.map(vertex => vertex.position), [
    [0,0,0], [1,0,0], [1,1,0], [0,1,0], [2,0,0], [2,1,0],
  ]);
  assert.notDeepEqual(updatedA.vertices.map(vertex => vertex.position), objectB.vertices.map(vertex => vertex.position));
  assert.deepEqual(updatedA.faces.map(face => face.vertices), objectA.faces.map(face => face.vertices));
  assert.deepEqual(objectB.faces.map(face => face.vertices), objectA.faces.map(face => face.vertices));
  assert.equal(validateTopology(updatedA).valid, true);
  assert.equal(validateTopology(objectB).valid, true);
});

test('App preserves stored face loops for position-only operations even without legacy quad-grid marker', async () => {
  const source = await import('node:fs');
  const app = source.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /const priorTopology = beforeTopology\?\.version === 1 \? beforeTopology : null/);
  assert.match(app, /const connectivityChanged = tool === 'Extrude'.*tool === 'FacesCut'/);
  assert.match(app, /if \(committedPosition && priorTopology && !connectivityChanged\)/);
  assert.match(app, /updateTopologyPositionsFromRenderGeometry\(\s*priorTopology/);
  assert.match(app, /selection\.mesh\.userData\.nexusQuadGrid \|\| selection\.mesh\.userData\.nexusTopology\?\.version === 1/);
});

test('Subdivide prefers stored face loops even if legacy quad-grid marker is absent', async () => {
  const source = await import('node:fs');
  const app = source.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  const start = app.indexOf('const storedTopology = target.userData.nexusTopology;');
  const end = app.indexOf('if (!sourceQuadCorners && geometry.index', start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /if \(storedFaces\.length > 0 && geometry\.index\)/);
  assert.match(block, /if \(storedFaces\.length > 0 &&/);
  assert.doesNotMatch(block, /target\.userData\.nexusQuadGrid === true && storedFaces/);
});

test('Object Rotate is retained in transform undo and redo snapshots', async () => {
  const source = await import('node:fs');
  const app = source.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /rotation: \[o\.rotation\.x, o\.rotation\.y, o\.rotation\.z\]/);
  assert.match(app, /o\.rotation\.set\(v\.rotation\[0\], v\.rotation\[1\], v\.rotation\[2\]\)/);
  assert.match(app, /label: 'Transform ' \+ before\.object\.name/);
});


test('multi-object topology remains isolated at 1, 2, 5, and 10 scene objects', () => {
  const source = [
    0,0,0, 1,0,0, 1,1,0, 0,0,0, 1,1,0, 0,1,0,
    1,0,0, 2,0,0, 2,1,0, 1,0,0, 2,1,0, 1,1,0,
  ];
  for (const count of [1, 2, 5, 10]) {
    const objects = Array.from({ length: count }, () => ({
      topology: buildTopologyFromCanonicalQuadGeometry(source),
      positions: [...source],
    }));
    assert.ok(objects.every(object => object.topology));
    for (let pass = 0; pass < 3; pass++) {
      const targetIndex = (pass * 3) % count;
      const before = objects.map(object => ({
        positions: [...object.positions],
        faces: object.topology.faces.map(face => [...face.vertices]),
      }));
      const target = objects[targetIndex];
      target.positions = target.positions.map((value, index) =>
        index % 3 === 2 ? value + (pass + 1) * 0.1 : value
      );
      target.topology = updateTopologyPositionsFromRenderGeometry(target.topology, target.positions);
      assert.ok(target.topology, 'target topology refresh must succeed');
      objects.forEach((object, index) => {
        assert.equal(validateTopology(object.topology).valid, true);
        assert.equal(object.topology.faces.length, 2);
        assert.deepEqual(object.topology.faces.map(face => face.vertices), before[index].faces);
        if (index === targetIndex) {
          assert.notDeepEqual(object.positions, before[index].positions);
        } else {
          assert.deepEqual(object.positions, before[index].positions, 'non-target object coordinates must remain unchanged');
          assert.deepEqual(object.topology.vertices.map(vertex => vertex.position),
            buildTopologyFromCanonicalQuadGeometry(before[index].positions).vertices.map(vertex => vertex.position));
        }
      });
    }
  }
});
