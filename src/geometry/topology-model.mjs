/**
 * Nexus3D persistent polygon topology model.
 *
 * Modeling topology is stored as vertex IDs and ordered polygon face loops.
 * Render triangles are deliberately not used as the source of truth.
 * This module is the foundation for migrating geometry operations incrementally.
 */

const edgeId = (a, b) => a < b ? a + "|" + b : b + "|" + a;
const midpointId = (a, b) => "edge-mid:" + edgeId(a, b);

export function buildTopology({ vertices, faces }) {
  const vertexMap = new Map();
  for (const vertex of vertices || []) {
    if (!vertex || typeof vertex.id !== "string" || !vertex.id || vertexMap.has(vertex.id)) {
      throw new Error("Topology contains a missing or duplicate vertex ID.");
    }
    if (!Array.isArray(vertex.position) || vertex.position.length !== 3 || !vertex.position.every(Number.isFinite)) {
      throw new Error("Topology vertex " + vertex.id + " has an invalid position.");
    }
    vertexMap.set(vertex.id, { id: vertex.id, position: [...vertex.position] });
  }

  const faceMap = new Map();
  for (const face of faces || []) {
    if (!face || typeof face.id !== "string" || !face.id || faceMap.has(face.id)) {
      throw new Error("Topology contains a missing or duplicate face ID.");
    }
    if (!Array.isArray(face.vertices) || face.vertices.length < 3 || new Set(face.vertices).size !== face.vertices.length) {
      throw new Error("Topology face " + face.id + " must contain at least three unique ordered vertices.");
    }
    for (const id of face.vertices) if (!vertexMap.has(id)) {
      throw new Error("Topology face " + face.id + " references missing vertex " + id + ".");
    }
    faceMap.set(face.id, { id: face.id, vertices: [...face.vertices], materialIndex: face.materialIndex ?? 0, ...(Array.isArray(face.renderIndices) ? { renderIndices: [...face.renderIndices] } : {}) });
  }

  const edgeMap = new Map();
  for (const face of faceMap.values()) {
    for (let i = 0; i < face.vertices.length; i++) {
      const a = face.vertices[i], b = face.vertices[(i + 1) % face.vertices.length];
      const id = edgeId(a, b);
      const edge = edgeMap.get(id) || { id, a: a < b ? a : b, b: a < b ? b : a, faces: [] };
      edge.faces.push(face.id);
      edgeMap.set(id, edge);
    }
  }

  return {
    version: 1,
    vertices: [...vertexMap.values()],
    faces: [...faceMap.values()],
    edges: [...edgeMap.values()],
  };
}

export function validateTopology(topology) {
  const errors = [];
  if (!topology || topology.version !== 1 || !Array.isArray(topology.vertices) ||
      !Array.isArray(topology.faces) || !Array.isArray(topology.edges)) {
    return { valid: false, errors: ["Unsupported or incomplete topology payload."] };
  }
  try {
    const rebuilt = buildTopology(topology);
    if (rebuilt.edges.length !== topology.edges.length) errors.push("Stored edge adjacency is stale.");
    const expected = new Map(rebuilt.edges.map(edge => [edge.id, edge.faces.slice().sort().join("|")]));
    for (const edge of topology.edges) {
      if (!expected.has(edge.id) || expected.get(edge.id) !== (edge.faces || []).slice().sort().join("|")) {
        errors.push("Edge adjacency mismatch: " + edge.id);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { valid: errors.length === 0, errors };
}

export function moveTopologyVertices(topology, positionById) {
  const vertices = topology.vertices.map(vertex => {
    const next = positionById instanceof Map ? positionById.get(vertex.id) : positionById?.[vertex.id];
    return next ? { ...vertex, position: [...next] } : vertex;
  });
  return buildTopology({ vertices, faces: topology.faces });
}

export function subdivideQuadFace(topology, faceId) {
  const face = topology.faces.find(item => item.id === faceId);
  if (!face) throw new Error("Cannot subdivide missing face " + faceId + ".");
  if (face.vertices.length !== 4) throw new Error("Quad subdivision requires exactly four ordered face vertices.");

  const vertexMap = new Map(topology.vertices.map(vertex => [vertex.id, vertex]));
  const [a, b, c, d] = face.vertices.map(id => vertexMap.get(id));
  const midpoint = (left, right) => left.position.map((value, axis) => (value + right.position[axis]) * 0.5);
  const additions = [];
  const midpointFor = (left, right) => {
    const id = midpointId(left.id, right.id);
    if (!vertexMap.has(id)) {
      const vertex = { id, position: midpoint(left, right) };
      vertexMap.set(id, vertex);
      additions.push(vertex);
    }
    return id;
  };
  const ab = midpointFor(a, b), bc = midpointFor(b, c);
  const cd = midpointFor(c, d), da = midpointFor(d, a);
  const centerId = "face-center:" + face.id;
  if (vertexMap.has(centerId)) throw new Error("Subdivision center ID already exists for face " + face.id + ".");
  const center = {
    id: centerId,
    position: [0, 1, 2].map(axis => (a.position[axis] + b.position[axis] + c.position[axis] + d.position[axis]) * 0.25),
  };
  const replacements = [
    { id: face.id + ":q0", vertices: [a.id, ab, centerId, da], materialIndex: face.materialIndex },
    { id: face.id + ":q1", vertices: [ab, b.id, bc, centerId], materialIndex: face.materialIndex },
    { id: face.id + ":q2", vertices: [centerId, bc, c.id, cd], materialIndex: face.materialIndex },
    { id: face.id + ":q3", vertices: [da, centerId, cd, d.id], materialIndex: face.materialIndex },
  ];
  const faces = topology.faces.filter(item => item.id !== faceId).concat(replacements);
  return buildTopology({
    vertices: topology.vertices.concat(additions, center),
    faces,
  });
}


/**
 * Build persistent face-loop topology from Nexus3D's verified canonical quad
 * render stream ([a,b,c,a,c,d] per face). This is intentionally fail-closed:
 * it does not guess topology from arbitrary triangle soups.
 */

/**
 * Refresh render-space positions while preserving persistent face loops.
 * renderIndices address expanded triangle-stream offsets; indexArray maps
 * those offsets to source position vertices for indexed geometry.
 * Shared logical vertices must resolve to the same position or fail closed.
 */
export function updateTopologyPositionsFromRenderGeometry(topology, positionArray, indexArray = null, options = {}) {
  if (!topology || topology.version !== 1 || !Array.isArray(topology.faces) ||
      !Array.isArray(topology.vertices) || !positionArray || typeof positionArray.length !== "number") return null;
  const digits = Number.isInteger(options.precision) ? Math.max(3, Math.min(9, options.precision)) : 6;
  const vertexPositions = new Map();
  for (const face of topology.faces) {
    if (!Array.isArray(face.vertices) || !Array.isArray(face.renderIndices) ||
        face.vertices.length < 3 || face.vertices.length !== face.renderIndices.length) return null;
    for (let corner = 0; corner < face.vertices.length; corner++) {
      const renderOffset = face.renderIndices[corner];
      if (!Number.isInteger(renderOffset) || renderOffset < 0 || (indexArray && renderOffset >= indexArray.length)) return null;
      const sourceIndex = indexArray ? Number(indexArray[renderOffset]) : renderOffset;
      const base = sourceIndex * 3;
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || base + 2 >= positionArray.length) return null;
      const position = [Number(positionArray[base]), Number(positionArray[base + 1]), Number(positionArray[base + 2])];
      if (!position.every(Number.isFinite)) return null;
      const id = face.vertices[corner], previous = vertexPositions.get(id);
      if (previous && previous.some((value, axis) => Number(value).toFixed(digits) !== position[axis].toFixed(digits))) return null;
      vertexPositions.set(id, position);
    }
  }
  if (vertexPositions.size !== topology.vertices.length) return null;
  const vertices = topology.vertices.map(vertex => {
    const position = vertexPositions.get(vertex.id);
    return position ? { id: vertex.id, position } : vertex;
  });
  try { return buildTopology({ vertices, faces: topology.faces }); } catch { return null; }
}

export function buildTopologyFromCanonicalQuadGeometry(positionArray, options = {}) {
  if (!positionArray || typeof positionArray.length !== "number" ||
      positionArray.length < 18 || positionArray.length % 18 !== 0) return null;
  const digits = Number.isInteger(options.precision) ? Math.max(3, Math.min(9, options.precision)) : 6;
  const vertices = new Map();
  const faces = [];
  const read = index => [
    Number(positionArray[index * 3]),
    Number(positionArray[index * 3 + 1]),
    Number(positionArray[index * 3 + 2]),
  ];
  const keyOf = point => point.map(value => Number(value).toFixed(digits)).join(",");
  for (let base = 0, faceIndex = 0; base < positionArray.length / 3; base += 6, faceIndex++) {
    const corners = [base, base + 1, base + 2, base + 5].map(read);
    if (corners.some(point => !point.every(Number.isFinite))) return null;
    const keys = corners.map(keyOf);
    if (new Set(keys).size !== 4) return null;
    const ids = keys.map((key, cornerIndex) => {
      const id = "v:" + key;
      if (!vertices.has(id)) vertices.set(id, { id, position: corners[cornerIndex] });
      return id;
    });
    faces.push({ id: "face:" + faceIndex, vertices: ids, materialIndex: 0, renderIndices: [base, base + 1, base + 2, base + 5] });
  }
  try {
    return buildTopology({ vertices: [...vertices.values()], faces });
  } catch {
    return null;
  }
}


/**
 * Build topology for indexed primitive quad cells whose index stream is
 * [A,B,D, B,C,D] per face. renderIndices address the equivalent expanded
 * non-indexed stream so the existing geometry tools can preserve attributes.
 */
export function buildTopologyFromIndexedQuadGeometry(positionArray, indexArray, options = {}) {
  if (!positionArray || !indexArray || typeof indexArray.length !== "number" ||
      indexArray.length < 6 || indexArray.length % 6 !== 0) return null;
  const digits = Number.isInteger(options.precision) ? Math.max(3, Math.min(9, options.precision)) : 6;
  const vertices = new Map();
  const faces = [];
  const read = index => {
    if (!Number.isInteger(index) || index < 0 || index * 3 + 2 >= positionArray.length) return null;
    return [
      Number(positionArray[index * 3]),
      Number(positionArray[index * 3 + 1]),
      Number(positionArray[index * 3 + 2]),
    ];
  };
  const keyOf = point => point.map(value => Number(value).toFixed(digits)).join(",");
  for (let base = 0, faceIndex = 0; base < indexArray.length; base += 6, faceIndex++) {
    const renderIndices = [base, base + 1, base + 4, base + 2];
    const corners = renderIndices.map(offset => read(Number(indexArray[offset])));
    if (corners.some(point => !point || !point.every(Number.isFinite))) return null;
    const keys = corners.map(keyOf);
    if (new Set(keys).size !== 4) return null;
    const ids = keys.map((key, cornerIndex) => {
      const id = "v:" + key;
      if (!vertices.has(id)) vertices.set(id, { id, position: corners[cornerIndex] });
      return id;
    });
    faces.push({ id: "face:" + faceIndex, vertices: ids, materialIndex: 0, renderIndices });
  }
  try {
    return buildTopology({ vertices: [...vertices.values()], faces });
  } catch {
    return null;
  }
}
