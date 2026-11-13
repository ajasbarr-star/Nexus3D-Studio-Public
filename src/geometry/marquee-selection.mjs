/**
 * Pure screen-space marquee selection helpers.
 * Visibility is deliberately supplied by the caller (for example, a depth/raycast
 * test against the active camera); this module never treats an occluded item as visible.
 */
export function normalizeSelectionRect(a, b) {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

export function pointInSelectionRect(point, rect) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y) &&
    point.x >= rect.left && point.x <= rect.right &&
    point.y >= rect.top && point.y <= rect.bottom;
}

export function segmentIntersectsSelectionRect(a, b, rect) {
  if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return false;
  // Liang-Barsky clipping: includes crossing segments even when neither endpoint
  // lies inside the marquee, and handles horizontal/vertical/diagonal drags.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - rect.left, rect.right - a.x, a.y - rect.top, rect.bottom - a.y];
  let low = 0;
  let high = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high) return false;
  }
  return true;
}

export function collectVisibleMarqueeSelection(items, rect, project, isVisible, kind = 'point') {
  const selected = [];
  for (const item of items) {
    if (!isVisible(item)) continue;
    const projected = project(item);
    const hit = kind === 'segment'
      ? Array.isArray(projected) && projected.length >= 2 &&
        segmentIntersectsSelectionRect(projected[0], projected[1], rect)
      : pointInSelectionRect(projected, rect);
    if (hit) selected.push(item.id);
  }
  return selected;
}

export function mergeSelectionLocks(existing, additions) {
  return [...new Set([...(existing || []), ...(additions || [])])];
}

export function clearSelectionLocks() {
  return [];
}
