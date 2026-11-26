/**
 * Advisory shadow budget based on the device fragment texture-unit limit.
 * Three.js does not expose the final active sampler count before program link,
 * so the 75% threshold is an early warning heuristic, not a guaranteed safe cap.
 */
export function getDirectionalShadowCapacityStatus(directionalShadowCasters, fragmentTextureUnits) {
  const count = Math.max(0, Number.isFinite(Number(directionalShadowCasters)) ? Math.floor(Number(directionalShadowCasters)) : 0);
  const limit = Number.isFinite(Number(fragmentTextureUnits)) && Number(fragmentTextureUnits) > 0
    ? Math.floor(Number(fragmentTextureUnits)) : null;
  if (limit === null) return { count, fragmentTextureUnits: null, warningThreshold: null, status: 'UNKNOWN' };
  const warningThreshold = Math.max(1, Math.ceil(limit * 0.75));
  return {
    count,
    fragmentTextureUnits: limit,
    warningThreshold,
    status: count >= limit ? 'EXCEEDED' : count >= warningThreshold ? 'WARNING' : 'WITHIN_ADVISORY_RANGE'
  };
}
