# Nexus3D Core Geometry Invariants

## CLEAN FLAT SURFACE — PROTECTED STANDARD

**Permanent rule:** every planar/flat surface must render without unwanted internal diagonal triangulation lines. Do not satisfy this by hiding broken topology: preserve valid face boundaries, edge connectivity, UV/material seams, caps, and connecting side walls.

This rule is mandatory after each of these operations:

- Face Extrude
- Face Scale
- Subdivide
- Subdivide Rotate
- Edge Move / Pull
- Vertex Move / Pull
- Smooth

Real perimeter edges, hard edges, and authored subdivision/loop boundaries remain available. Internal triangle diagonals inside a planar region are not modeling edges and must not be drawn as visible surface lines.

## Update protection

- Treat this standard as a core invariant, not an optional display preference.
- Every geometry/rendering update must retain the regression test in tests/dfi/advanced-tools.test.mjs.
- A change that reintroduces planar triangulation diagonals must fail verification and must not be promoted to the Original APK.
- Any intentional change to this standard requires explicit review and approval; ordinary feature updates must not silently alter it.
- Test branch first. The Original APK is protected until verification and user approval.
