const ATTACHMENT_KINDS = new Set(['Bone', 'Rig', 'IK Target', 'IK Pole', 'Group', 'Imported Model', 'GLTF Node']);

export function isShapeProjectMesh(node) {
  const kind = node?.userData?.kind;
  return Boolean(node?.isMesh && !['Bone', 'Rig', 'IK Target', 'IK Pole'].includes(kind) && !node.userData?.rigControlMarker);
}

function isExcludedViewportNode(node) {
  // Cameras are viewport state; lights are editable scene objects and must survive project round-trips.
  return Boolean(node?.isCamera || node?.userData?.kind === 'Camera');
}

/**
 * Return editable Shape meshes, scene lights, and the hierarchy/rig nodes required by them.
 * Viewport cameras and unrelated scene helpers are never project payload.
 */
export function collectObjectOnlyProjectNodes(selectable = []) {
  const nodes = Array.isArray(selectable) ? selectable.filter(Boolean) : [];
  const included = new Set();
  const projectRoots = nodes.filter(node => !isExcludedViewportNode(node) && (
    isShapeProjectMesh(node) || node?.isLight || node?.userData?.kind === 'Light' ||
    (node.userData?.shapeId && !node.userData?.rigControlMarker && !['Bone', 'Rig', 'IK Target', 'IK Pole'].includes(node.userData?.kind))
  ));
  projectRoots.forEach(root => {
    let current = root;
    while (current && !current.isScene && current.type !== 'Scene' && !isExcludedViewportNode(current)) {
      included.add(current);
      current = current.parent;
    }
    root.traverse?.(child => {
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
