/**
 * Resolve the permanent Shape identity that owns an attached editor node.
 * A mesh owns itself; descendants inherit the nearest ancestor Shape ID.
 */
export function resolveOwnerShapeId(node) {
  let current = node;
  while (current) {
    const shapeId = current.userData?.shapeId;
    if (typeof shapeId === 'string' && /^No\.\d+$/.test(shapeId)) return shapeId;
    current = current.parent;
  }
  return null;
}

export function assignShapeOwnership(nodes = []) {
  const list = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
  list.forEach(node => {
    if (!node.userData) node.userData = {};
    const ownerShapeId = resolveOwnerShapeId(node);
    if (ownerShapeId) node.userData.ownerShapeId = ownerShapeId;
    else delete node.userData.ownerShapeId;
  });
  return list;
}
