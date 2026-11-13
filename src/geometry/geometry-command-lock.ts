/**
 * Nexus3D Geometry Command Lock.
 *
 * Command behavior is intentionally explicit and non-interchangeable.
 * Update a command only with a focused implementation change, matching
 * regression coverage, and explicit review of this protected contract.
 */
export const GEOMETRY_COMMAND_LOCK = Object.freeze({
  'Move Face': Object.freeze({
    geometryEffect: 'move-selected-face-only',
    generatesConnectingWalls: false,
  }),
  'Extrude Face': Object.freeze({
    geometryEffect: 'move-selected-face-and-create-connecting-walls',
    generatesConnectingWalls: true,
    wallTopology: 'quad',
    removesOriginalFaceAtSourcePosition: true,
  }),
  'Face Scale': Object.freeze({ requiresDedicatedRegression: true }),
  'Subdivide': Object.freeze({ requiresDedicatedRegression: true }),
  'Subdivide Rotate': Object.freeze({ requiresDedicatedRegression: true }),
  'Edge Move / Pull': Object.freeze({ requiresDedicatedRegression: true }),
  'Vertex Move / Pull': Object.freeze({ requiresDedicatedRegression: true }),
  'Smooth': Object.freeze({ requiresDedicatedRegression: true }),
} as const);

export const PROTECTED_GEOMETRY_COMMANDS = Object.freeze(
  Object.keys(GEOMETRY_COMMAND_LOCK) as Array<keyof typeof GEOMETRY_COMMAND_LOCK>
);
