/**
 * Validate stable identity and attachment references before mutating the live scene.
 * This keeps malformed project files from partially restoring over the current project.
 */
export function validateProjectIdentityData(objects, version = 0) {
  if (!Array.isArray(objects)) throw new TypeError('Project objects must be an array');
  const editorIds = new Set();
  const shapeIds = new Set();
  const shapeKinds = new Set(['Bone', 'Rig', 'IK Target', 'IK Pole']);

  for (const saved of objects) {
    if (!saved || typeof saved !== 'object') continue;
    if (saved.editorId != null) {
      if (typeof saved.editorId !== 'string' || !saved.editorId.trim()) {
        throw new Error('Project validation failed: invalid editor object ID');
      }
      if (editorIds.has(saved.editorId)) {
        throw new Error('Project validation failed: duplicate editor object ID ' + saved.editorId);
      }
      editorIds.add(saved.editorId);
    }
    const isShapeMesh = !shapeKinds.has(saved.kind) &&
      Array.isArray(saved.geometry?.attributes?.position?.array) &&
      saved.geometry.attributes.position.array.length >= 9;
    if (isShapeMesh && version >= 4 &&
        (typeof saved.shapeId !== 'string' || !/^No\\.\\d+$/.test(saved.shapeId))) {
      throw new Error('Project validation failed: a Shape is missing its permanent Shape ID');
    }
    if (isShapeMesh && saved.shapeId) {
      if (shapeIds.has(saved.shapeId)) {
        throw new Error('Project validation failed: duplicate Shape ID ' + saved.shapeId);
      }
      shapeIds.add(saved.shapeId);
    }
  }

  if (version >= 4) {
    for (const saved of objects) {
      if (!saved || typeof saved !== 'object') continue;
      if (saved.parentEditorId && !editorIds.has(saved.parentEditorId)) {
        throw new Error('Project validation failed: missing parent object ' + saved.parentEditorId);
      }
      const boneIds = saved.skeleton?.boneEditorIds;
      if (Array.isArray(boneIds)) {
        for (const id of boneIds) {
          if (!editorIds.has(id)) throw new Error('Project validation failed: missing skeleton bone ' + id);
        }
      }
      const rootBoneId = saved.editorData?.rigRootBoneId;
      if (rootBoneId && !editorIds.has(rootBoneId)) {
        throw new Error('Project validation failed: missing IK root bone ' + rootBoneId);
      }
    }
  }
  return { editorIdCount: editorIds.size, shapeIdCount: shapeIds.size };
}
