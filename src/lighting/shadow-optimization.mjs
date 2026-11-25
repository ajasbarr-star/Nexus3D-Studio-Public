export const DEFAULT_DIRECTIONAL_SHADOW_MAP_SIZE = 256;

/**
 * Reduce the per-light shadow texture cost without changing whether the light
 * casts shadows or how its illumination contributes to the scene.
 */
export function configureDirectionalShadow(light, mapSize = DEFAULT_DIRECTIONAL_SHADOW_MAP_SIZE) {
  const size = Number(mapSize);
  if (!light?.isDirectionalLight || !light.shadow?.mapSize?.set || !Number.isFinite(size) || size < 1) {
    return false;
  }
  const normalizedSize = Math.max(1, Math.floor(size));
  light.shadow.mapSize.set(normalizedSize, normalizedSize);
  light.shadow.needsUpdate = true;
  return true;
}
