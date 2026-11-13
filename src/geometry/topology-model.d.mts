export type NexusTopologyVertex = { id: string; position: [number, number, number] };
export type NexusTopologyFace = { id: string; vertices: string[]; materialIndex?: number };
export type NexusTopologyEdge = { id: string; a: string; b: string; faces: string[] };
export type NexusTopology = { version: 1; vertices: NexusTopologyVertex[]; faces: NexusTopologyFace[]; edges: NexusTopologyEdge[] };
export function buildTopology(input: { vertices: NexusTopologyVertex[]; faces: NexusTopologyFace[] }): NexusTopology;
export function validateTopology(topology: NexusTopology): { valid: boolean; errors: string[] };
export function moveTopologyVertices(topology: NexusTopology, positionById: Map<string, [number, number, number]> | Record<string, [number, number, number]>): NexusTopology;
export function subdivideQuadFace(topology: NexusTopology, faceId: string): NexusTopology;
export function buildTopologyFromCanonicalQuadGeometry(positionArray: ArrayLike<number>, options?: { precision?: number }): NexusTopology | null;
