export function getNexusRenderPixelRatio(
  devicePixelRatio,
  { native = false, performanceMode = false } = {}
) {
  const requested = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  const maxRatio = performanceMode ? 1.15 : native ? 1.5 : 2;
  return Math.min(requested, maxRatio);
}
