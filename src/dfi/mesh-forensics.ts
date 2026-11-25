export type MeshForensicIssue = {
  severity: 'ERROR' | 'WARN' | 'INFO';
  code: string;
  mesh: string;
  objectId: string;
  detail: string;
};

export type MeshForensicSummary = {
  meshes: number;
  vertices: number;
  triangles: number;
  uniquePositions: number;
  duplicatePositionGroups: number;
  duplicateTriangles: number;
  degenerateTriangles: number;
  invalidIndices: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  disconnectedComponents: number;
  issues: MeshForensicIssue[];
  limitations: string[];
};

const pointKey = (x: number, y: number, z: number, precision: number) =>
  [x, y, z].map(value => Math.round(value / precision)).join(',');

/** Excludes editor-only visuals while retaining user-authored/imported mesh descendants. */
export function isEditorOnlyGeometryMesh(mesh: any): boolean {
  let node = mesh;
  while (node) {
    const data = node.userData || {};
    if (data.nexusEditorHelper || data.isLightHelper || data.nexusJointVisual || data.nexusBoneVisual || data.isCineCamera) return true;
    node = node.parent;
  }
  return false;
}

export function scanMeshCore(scene: any, maxTriangles = 250000): MeshForensicSummary {
  const result: MeshForensicSummary = {
    meshes: 0, vertices: 0, triangles: 0, uniquePositions: 0,
    duplicatePositionGroups: 0, duplicateTriangles: 0, degenerateTriangles: 0,
    invalidIndices: 0, boundaryEdges: 0, nonManifoldEdges: 0,
    disconnectedComponents: 0, issues: [], limitations: [
      'Read-only scan: no mesh, transform, material, selection, or project data was modified.',
      'Indexed topology and duplicate-face identity use vertex indices to avoid falsely welding UV/normal seams. Non-indexed topology uses coordinate-based inferred connectivity and is lower confidence. Geometrically coincident triangles with different indexed vertices are not counted as exact duplicates; a separate overlap/intersection pass is required to classify them.',
      'Editor-only camera, light-helper, IK joint/bone visual, and explicitly tagged editor-helper meshes are excluded from user geometry totals.',
      'A scan limit may apply to very large scenes; check the reported inspected triangle count.'
    ]
  };
  const add = (severity: MeshForensicIssue['severity'], code: string, mesh: string, objectId: string, detail: string) =>
    result.issues.push({ severity, code, mesh, objectId, detail });
  const meshes: any[] = [];
  scene?.traverse?.((object: any) => { if (object?.isMesh && object.geometry && !isEditorOnlyGeometryMesh(object)) meshes.push(object); });
  let triangleBudget = Math.max(1, maxTriangles);

  for (const mesh of meshes) {
    result.meshes += 1;
    const geometry = mesh.geometry;
    const position = geometry?.getAttribute?.('position');
    if (!position || position.itemSize < 3) {
      add('ERROR', 'MISSING_POSITION', mesh.name || mesh.uuid, String(mesh.userData?.editorId || ''), 'Mesh has no valid 3D position attribute.');
      continue;
    }
    const meshName = String(mesh.name || mesh.uuid || 'Unnamed mesh');
    const objectId = String(mesh.userData?.editorId || mesh.uuid || '');
    result.vertices += position.count;
    const positionCounts = new Map<string, number>();
    const edgeCounts = new Map<string, number>();
    const adjacency = new Map<number, Set<number>>();
    const coordinateVertexIds = new Int32Array(position.count);
    const index = geometry.getIndex?.();
    const elementCount = index ? index.count : position.count;
    const triCount = Math.floor(elementCount / 3);
    const localTriangleKeys = new Set<string>();
    let meshInvalidIndices = 0;
    let meshDegenerateTriangles = 0;
    let meshDuplicateTriangles = 0;
    const duplicateTriangleSamples: string[] = [];
    const nonManifoldEdgeSamples: string[] = [];
    const vertexKeyToFirst = new Map<string, number>();
    for (let v = 0; v < position.count; v += 1) {
      const x = position.getX(v), y = position.getY(v), z = position.getZ(v);
      if (![x, y, z].every(Number.isFinite)) {
        add('ERROR', 'NON_FINITE_VERTEX', meshName, objectId, `Vertex ${v} contains a non-finite coordinate.`);
        continue;
      }
      const key = pointKey(x, y, z, 1e-6);
      positionCounts.set(key, (positionCounts.get(key) || 0) + 1);
      if (!vertexKeyToFirst.has(key)) vertexKeyToFirst.set(key, v);
      coordinateVertexIds[v] = vertexKeyToFirst.get(key)!;
    }
    result.uniquePositions += positionCounts.size;
    const duplicateGroups = [...positionCounts.values()].filter(count => count > 1).length;
    result.duplicatePositionGroups += duplicateGroups;
    if (duplicateGroups) add('WARN', 'COINCIDENT_VERTICES', meshName, objectId, `${duplicateGroups} coordinate group(s) contain coincident vertex records. Coincidence alone is not proof of a defect; split normals/UV seams may be intentional.`);

    const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
    const addEdge = (a: number, b: number) => {
      const key = edgeKey(a, b);
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a)!.add(b); adjacency.get(b)!.add(a);
    };

    for (let t = 0; t < triCount && triangleBudget > 0; t += 1, triangleBudget -= 1) {
      const offset = t * 3;
      const a = index ? index.getX(offset) : offset;
      const b = index ? index.getX(offset + 1) : offset + 1;
      const c = index ? index.getX(offset + 2) : offset + 2;
      if (![a, b, c].every(v => Number.isInteger(v) && v >= 0 && v < position.count)) {
        result.invalidIndices += 1;
        meshInvalidIndices += 1;
        continue;
      }
      result.triangles += 1;
      const ax = position.getX(a), ay = position.getY(a), az = position.getZ(a);
      const bx = position.getX(b), by = position.getY(b), bz = position.getZ(b);
      const cx = position.getX(c), cy = position.getY(c), cz = position.getZ(c);
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const acx = cx - ax, acy = cy - ay, acz = cz - az;
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      if (nx * nx + ny * ny + nz * nz < 1e-18) {
        result.degenerateTriangles += 1;
        meshDegenerateTriangles += 1;
      }
      // Duplicate identity must follow topology identity for indexed meshes.
      // Coordinate-only matching can falsely label UV/normal seam triangles as
      // exact duplicates when distinct vertex records occupy the same positions.
      const keys = index
        ? [a, b, c].sort((left, right) => left - right).map(String)
        : [pointKey(ax, ay, az, 1e-5), pointKey(bx, by, bz, 1e-5), pointKey(cx, cy, cz, 1e-5)].sort();
      const triangleKey = keys.join('|');
      if (localTriangleKeys.has(triangleKey)) {
        result.duplicateTriangles += 1;
        meshDuplicateTriangles += 1;
        if (duplicateTriangleSamples.length < 8) {
          const describeVertex = (vertex: number) =>
            `v${vertex}=(${[position.getX(vertex), position.getY(vertex), position.getZ(vertex)].map(value => Number(value.toFixed(6))).join(',')})`;
          duplicateTriangleSamples.push(`triangle #${t}: [${[a, b, c].map(describeVertex).join(' ')}]`);
        }
      }
      localTriangleKeys.add(triangleKey);
      // Indexed geometry uses true vertex identity. Coordinate welding is only a
      // fallback for non-indexed geometry, where triangle vertices are duplicated.
      const topologyId = (vertex: number) => index ? vertex : coordinateVertexIds[vertex];
      addEdge(topologyId(a), topologyId(b)); addEdge(topologyId(b), topologyId(c)); addEdge(topologyId(c), topologyId(a));
    }
    if (elementCount % 3 !== 0) add('WARN', 'NON_TRIANGLE_ELEMENT_COUNT', meshName, objectId, `Geometry element count ${elementCount} is not divisible by three.`);
    if (meshInvalidIndices) add('ERROR', 'INVALID_INDEX', meshName, objectId, `${meshInvalidIndices} triangle index reference(s) point outside this mesh position buffer.`);
    if (meshDegenerateTriangles) add('WARN', 'DEGENERATE_TRIANGLES', meshName, objectId, `${meshDegenerateTriangles} degenerate triangle(s) were detected in this mesh.`);
    if (meshDuplicateTriangles) add('ERROR', 'DUPLICATE_TRIANGLES', meshName, objectId,
      `${meshDuplicateTriangles} duplicate triangle(s) with identical topology vertex identity were detected within this mesh. Samples: ${duplicateTriangleSamples.join('; ') || 'not captured'}`);

    for (const [key, count] of edgeCounts.entries()) {
      if (count === 1) result.boundaryEdges += 1;
      else if (count > 2) {
        result.nonManifoldEdges += 1;
        if (nonManifoldEdgeSamples.length < 8) {
          const [left, right] = key.split(':').map(Number);
          const describeVertex = (vertex: number) =>
            `v${vertex}=(${[position.getX(vertex), position.getY(vertex), position.getZ(vertex)].map(value => Number(value.toFixed(6))).join(',')})`;
          nonManifoldEdgeSamples.push(`edge incidence ${count}: ${describeVertex(left)} -- ${describeVertex(right)}`);
        }
      }
    }
    const visited = new Set<number>();
    let components = 0;
    for (const vertex of adjacency.keys()) {
      if (visited.has(vertex)) continue;
      components += 1;
      const stack = [vertex]; visited.add(vertex);
      while (stack.length) {
        const current = stack.pop()!;
        adjacency.get(current)?.forEach(next => { if (!visited.has(next)) { visited.add(next); stack.push(next); } });
      }
    }
    if (components > 1) result.disconnectedComponents += components;
    if (nonManifoldEdgeSamples.length)
      add('ERROR', 'NON_MANIFOLD_EDGE', meshName, objectId,
        `One or more edges are shared by more than two triangles. Samples: ${nonManifoldEdgeSamples.join('; ')}`);
  }
  if (result.duplicateTriangles) add('ERROR', 'SCENE_DUPLICATE_TRIANGLES', 'Scene', '', `${result.duplicateTriangles} exact duplicate triangle(s) detected.`);
  if (result.nonManifoldEdges) add('ERROR', 'SCENE_NON_MANIFOLD_EDGES', 'Scene', '', `${result.nonManifoldEdges} non-manifold edge(s) detected.`);
  if (result.invalidIndices) add('ERROR', 'SCENE_INVALID_INDICES', 'Scene', '', `${result.invalidIndices} invalid triangle index reference(s) detected.`);
  if (result.degenerateTriangles) add('WARN', 'SCENE_DEGENERATE_TRIANGLES', 'Scene', '', `${result.degenerateTriangles} degenerate triangle(s) detected.`);
  if (result.boundaryEdges) add('INFO', 'BOUNDARY_EDGES', 'Scene', '', `${result.boundaryEdges} boundary edge(s) detected. Open boundaries may be intentional, e.g. a cut or hole.`);
  if (triangleBudget === 0) add('WARN', 'SCAN_BUDGET_REACHED', 'Scene', '', `Scan stopped at the configured budget of ${maxTriangles} triangles.`);
  return result;
}

export function formatMeshForensicReport(summary: MeshForensicSummary, timestamp = new Date().toLocaleString()): string {
  return [
    'NEXUS3D ADVANCED DFI · MESH CORE REPORT',
    `Scan time: ${timestamp}`,
    `Meshes: ${summary.meshes} · Vertices: ${summary.vertices} · Triangles inspected: ${summary.triangles}`,
    `Unique positions: ${summary.uniquePositions} · Coincident vertex groups: ${summary.duplicatePositionGroups}`,
    `Duplicate triangles: ${summary.duplicateTriangles} · Degenerate triangles: ${summary.degenerateTriangles}`,
    `Invalid indices: ${summary.invalidIndices} · Boundary edges: ${summary.boundaryEdges} · Non-manifold edges: ${summary.nonManifoldEdges}`,
    `Disconnected mesh components: ${summary.disconnectedComponents}`,
    '',
    'FINDINGS',
    ...(summary.issues.length ? summary.issues.map(issue => `[${issue.severity}] ${issue.code} · ${issue.mesh} · Object ID: ${issue.objectId || 'unavailable'}\n  ${issue.detail}`) : ['[INFO] No issue detected by the enabled mesh-core checks.']),
    '',
    'LIMITATIONS',
    ...summary.limitations
  ].join('\n');
}
