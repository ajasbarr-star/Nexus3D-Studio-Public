/**
 * Nexus3D permanent modeling invariant.
 * Planar regions must not expose their internal triangle diagonals in the editor overlay.
 * Real boundary edges, hard edges, and authored subdivision/loop boundaries remain visible.
 * Change this rule only through an explicit, reviewed geometry-standard change and regression update.
 */
export const CLEAN_FLAT_SURFACE_EDGE_ANGLE_DEGREES = 3;

export const CLEAN_FLAT_SURFACE_OPERATIONS = Object.freeze([
  'Face Extrude',
  'Face Scale',
  'Subdivide',
  'Subdivide Rotate',
  'Edge Move / Pull',
  'Vertex Move / Pull',
  'Smooth',
] as const);
