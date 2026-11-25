/**
 * Collect identity reservations from every object in a scene graph.
 * Do not limit this to selectable nodes: hidden helpers and attached rig
 * objects can still carry editor IDs that imported projects must not reuse.
 */
export function collectReservedIdentityIds(nodes = []) {
  const editorIds = new Set();
  const shapeIds = new Set();
  const list = Array.isArray(nodes) ? nodes : [];
  list.forEach(node => {
    const data = node?.userData;
    if (!data || typeof data !== 'object') return;
    if (typeof data.editorId === 'string' && data.editorId) editorIds.add(data.editorId);
    if (typeof data.shapeId === 'string' && /^No\.\d+$/.test(data.shapeId)) shapeIds.add(data.shapeId);
  });
  return { editorIds, shapeIds };
}
