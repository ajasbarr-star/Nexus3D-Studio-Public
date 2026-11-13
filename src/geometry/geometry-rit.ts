import { scanMeshCore, type MeshForensicSummary } from '../dfi/mesh-forensics';

export type GeometryRitSummary = {
  status: 'PASS' | 'REVIEW' | 'FAIL' | 'INSUFFICIENT EVIDENCE';
  meshes: number;
  vertices: number;
  triangles: number;
  coplanarSharedEdges: number;
  nonCoplanarSharedEdges: number;
  boundaryEdges: number;
  duplicateTriangles: number;
  degenerateTriangles: number;
  invalidIndices: number;
  errors: number;
  warnings: number;
  meshCore: MeshForensicSummary;
  limitations: string[];
};

const pointKey = (x: number, y: number, z: number) =>
  [x, y, z].map(value => Math.round(value / 1e-5)).join(',');
const edgeKey = (a: string, b: string) => a < b ? a + '|' + b : b + '|' + a;

/**
 * Read-only Geometry RIT scan. It checks mesh integrity and identifies
 * coplanar shared triangle edges (internal-diagonal candidates) separately
 * from non-coplanar shared edges (crease/perimeter review candidates).
 * It never changes geometry, normals, selection, transforms, or scene state.
 */
export function scanGeometryRit(scene: any): GeometryRitSummary {
  const meshCore = scanMeshCore(scene, 250000);
  const edges = new Map<string, number[]>();
  let coplanarSharedEdges = 0;
  let nonCoplanarSharedEdges = 0;
  let vertices = 0;
  let triangles = 0;
  let meshes = 0;
  const cosineTolerance = Math.cos(3 * Math.PI / 180);

  scene?.traverse?.((mesh: any) => {
    if (!mesh?.isMesh || !mesh.geometry) return;
    meshes += 1;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute?.('position');
    if (!position || position.itemSize < 3) return;
    vertices += position.count;
    const index = geometry.getIndex?.();
    const elementCount = index ? index.count : position.count;
    const edgeMap = new Map<string, number[]>();
    const pointAt = (vertex: number) => pointKey(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
    const addEdge = (a: number, b: number, triangleNormalIndex: number) => {
      const key = edgeKey(pointAt(a), pointAt(b));
      const list = edgeMap.get(key) || [];
      list.push(triangleNormalIndex);
      edgeMap.set(key, list);
    };
    const normals: Array<[number, number, number]> = [];
    for (let offset = 0; offset + 2 < elementCount; offset += 3) {
      const a = index ? index.getX(offset) : offset;
      const b = index ? index.getX(offset + 1) : offset + 1;
      const c = index ? index.getX(offset + 2) : offset + 2;
      if (![a, b, c].every(value => Number.isInteger(value) && value >= 0 && value < position.count)) continue;
      const abx = position.getX(b) - position.getX(a);
      const aby = position.getY(b) - position.getY(a);
      const abz = position.getZ(b) - position.getZ(a);
      const acx = position.getX(c) - position.getX(a);
      const acy = position.getY(c) - position.getY(a);
      const acz = position.getZ(c) - position.getZ(a);
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      const length = Math.hypot(nx, ny, nz);
      const normal: [number, number, number] = length > 1e-12 ? [nx / length, ny / length, nz / length] : [0, 0, 0];
      const normalIndex = normals.push(normal) - 1;
      triangles += 1;
      addEdge(a, b, normalIndex);
      addEdge(b, c, normalIndex);
      addEdge(c, a, normalIndex);
    }
    edgeMap.forEach((triangleIds) => {
      if (triangleIds.length !== 2) return;
      const first = normals[triangleIds[0]];
      const second = normals[triangleIds[1]];
      const dot = first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
      if (dot >= cosineTolerance) coplanarSharedEdges += 1;
      else nonCoplanarSharedEdges += 1;
    });
  });

  const errors = meshCore.issues.filter(issue => issue.severity === 'ERROR').length;
  const warnings = meshCore.issues.filter(issue => issue.severity === 'WARN').length;
  const limitations = [
    'Read-only runtime scan. No geometry, normals, transforms, materials, selection, or project data were modified.',
    'Coplanar shared edges are internal-triangulation candidates; actual visibility is controlled by the editor edge overlay and must be visually verified.',
    'Non-coplanar shared edges are crease/perimeter review candidates. They may be intentional hard edges, bevels, side walls, or real deformation.',
    'A generic mesh does not retain the artist-intended plane for every face perimeter. Perimeter deformation cannot be confirmed without an operation-specific before/after baseline or authored face boundary.',
    'This scan checks the current scene only. It does not reconstruct historical geometry states or prove that every prior modeling operation passed regression.'
  ];
  const status: GeometryRitSummary['status'] = errors > 0
    ? 'FAIL'
    : warnings > 0 || nonCoplanarSharedEdges > 0
      ? 'REVIEW'
      : meshes === 0
        ? 'INSUFFICIENT EVIDENCE'
        : 'PASS';

  return {
    status, meshes, vertices, triangles, coplanarSharedEdges, nonCoplanarSharedEdges,
    boundaryEdges: meshCore.boundaryEdges, duplicateTriangles: meshCore.duplicateTriangles,
    degenerateTriangles: meshCore.degenerateTriangles, invalidIndices: meshCore.invalidIndices,
    errors, warnings, meshCore, limitations
  };
}

export function formatGeometryRitReport(summary: GeometryRitSummary, timestamp = new Date().toLocaleString()): string {
  return [
    'NEXUS3D GEOMETRY RIT · INDEPENDENT DIAGNOSTIC REPORT',
    'Diagnostic ID: GEOM-RIT-001',
    'Scan time: ' + timestamp,
    'RESULT: ' + summary.status,
    '',
    'SCENE SNAPSHOT',
    'Meshes: ' + summary.meshes + ' · Vertices: ' + summary.vertices + ' · Triangles inspected: ' + summary.triangles,
    '',
    'CLEAN FLAT SURFACE',
    'Coplanar shared edges / internal-diagonal candidates: ' + summary.coplanarSharedEdges,
    'Non-coplanar shared edges / perimeter-crease review candidates: ' + summary.nonCoplanarSharedEdges,
    'Flat-surface perimeter deformation: INSUFFICIENT EVIDENCE without an operation baseline or authored face boundary.',
    '',
    'TOPOLOGY INTEGRITY',
    'Duplicate triangles: ' + summary.duplicateTriangles,
    'Degenerate triangles: ' + summary.degenerateTriangles,
    'Invalid indices: ' + summary.invalidIndices,
    'Boundary edges: ' + summary.boundaryEdges + ' (may be intentional open boundaries)',
    'Mesh-core errors: ' + summary.errors + ' · warnings: ' + summary.warnings,
    '',
    'DETAILED FINDINGS',
    ...(summary.meshCore.issues.length
      ? summary.meshCore.issues.map(issue => '[' + issue.severity + '] ' + issue.code + ' · ' + issue.mesh + ' · ' + issue.detail)
      : ['[INFO] No enabled mesh-core integrity issue detected.']),
    '',
    'LIMITATIONS / INTERPRETATION',
    ...summary.limitations,
    '',
    'REGRESSION POLICY',
    'This is a current-scene diagnostic snapshot, not a historical before/after regression proof. Run the modeling-operation regression suite separately for Subdivide, Extrude, Smooth, Face Scale, Edge Pull, and Vertex Pull.',
    'No automatic repair was performed. Review findings before changing geometry.'
  ].join('\n');
}
