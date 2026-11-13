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

## GEOMETRY COMMAND LOCK — PROTECTED BEHAVIOR

The following commands are separate protected implementations. A fix to one command must not silently change another command's behavior.

| Command | Locked behavior |
|---|---|
| Move Face | Move only the selected face. Do not generate connecting side walls. |
| Extrude Face | Move the selected face, generate connecting quad side walls, and do not leave the original selected face at its source position. |
| Face Scale | Preserve its existing scale-only behavior; require its own regression coverage. |
| Subdivide / Subdivide Rotate | Preserve their existing subdivision behavior and quad/flat-surface invariants; require regression coverage. |
| Edge Move / Pull | Preserve its own edge-only behavior; require regression coverage. |
| Vertex Move / Pull | Preserve its own vertex-only behavior; require regression coverage. |
| Smooth | Preserve its own smoothing behavior and Clean Flat Surface Standard; require regression coverage. |

### Change-control rules

- The immutable command contract lives in `src/geometry/geometry-command-lock.ts`.
- The command regression suite lives in `tests/dfi/geometry-command-lock.test.mjs` and runs with `npm run test:dfi`.
- A command implementation change must update its own regression tests in the same change.
- Tests must fail if Move Face starts generating walls or if Extrude Face loses its dedicated quad-wall generation.
- Do not refactor multiple protected commands together as part of an unrelated bug fix.
- Any intentional behavior change requires explicit review and approval before it can be promoted to the Original APK.
- All development and verification remain on `test/nexus3d-test-apk`; the Original APK remains untouched until tests pass and the user approves.
