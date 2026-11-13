const ATTACHMENT_KINDS = new Set(['Bone', 'Rig', 'IK Target', 'IK Pole', 'Group', 'Imported Model', 'GLTF Node']);

function isExcludedViewportNode(node) {
  return Boolean(node?.isCamera || node?.isLight || node?.userData?.kind === 'Camera' || node?.userData?.kind === 'Light');
}

/**
 * Return only editable Shape meshes and the hierarchy/rig nodes required by them.
 * Viewport cameras, lights and unrelated scene helpers are never project payload.
 */
export function collectObjectOnlyProjectNodes(selectable = []) {
  const nodes = Array.isArray(selectable) ? selectable.filter(Boolean) : [];
  const included = new Set();
  const meshes = nodes.filter(node => !isExcludedViewportNode(node) && (node.isMesh || node.userData?.shapeId));
  meshes.forEach(mesh => {
    let current = mesh;
    while (current && !current.isScene && current.type !== 'Scene' && !isExcludedViewportNode(current)) {
      included.add(current);
      current = current.parent;
    }
    mesh.traverse?.(child => {
      if (!isExcludedViewportNode(child)) included.add(child);
    });
  });
  nodes.forEach(node => {
    if (isExcludedViewportNode(node)) return;
    const kind = node.userData?.kind;
    if (ATTACHMENT_KINDS.has(kind) && (node.isBone || kind === 'Rig' || kind === 'IK Target' || kind === 'IK Pole')) {
      included.add(node);
      let parent = node.parent;
      while (parent && !parent.isScene && parent.type !== 'Scene' && !isExcludedViewportNode(parent)) {
        included.add(parent);
        parent = parent.parent;
      }
      node.traverse?.(child => { if (!isExcludedViewportNode(child)) included.add(child); });
    }
  });
  return nodes.filter(node => included.has(node));
}

export function getObjectOnlyProjectRoots(projectNodes = []) {
  const included = new Set(Array.isArray(projectNodes) ? projectNodes : []);
  return [...included].filter(node => !included.has(node.parent));
}
