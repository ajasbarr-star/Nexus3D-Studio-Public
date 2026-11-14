/**
 * Validate project identities, geometry buffers, and rig/hierarchy references
 * before mutating the live scene. Keep this module pure so it can be exercised
 * in Node regression tests without an Android runtime.
 */
export function validateProjectIdentityData(objects, version = 0) {
  if (!Array.isArray(objects)) throw new TypeError('Project objects must be an array');
  const editorIds = new Set();
  const shapeIds = new Set();
  const shapeKinds = new Set(['Bone', 'Rig', 'IK Target', 'IK Pole']);
  const byEditorId = new Map();

  for (let index = 0; index < objects.length; index++) {
    const saved = objects[index];
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      throw new Error('Project validation failed: invalid scene object at index ' + index);
    }
    if (saved.editorId != null) {
      if (typeof saved.editorId !== 'string' || !saved.editorId.trim()) {
        throw new Error('Project validation failed: invalid editor object ID');
      }
      if (editorIds.has(saved.editorId)) {
        throw new Error('Project validation failed: duplicate editor object ID ' + saved.editorId);
      }
      editorIds.add(saved.editorId);
      byEditorId.set(saved.editorId, saved);
    }

    const position = saved.geometry?.attributes?.position;
    const isShapeMesh = !shapeKinds.has(saved.kind) &&
      Array.isArray(position?.array) && position.array.length >= 9;
    if (saved.geometry?.attributes != null) {
      if (typeof saved.geometry.attributes !== 'object' || Array.isArray(saved.geometry.attributes)) {
        throw new Error('Project validation failed: invalid geometry attributes');
      }
      for (const [attributeName, attribute] of Object.entries(saved.geometry.attributes)) {
        if (!attribute || !Array.isArray(attribute.array) ||
            !Number.isInteger(attribute.itemSize) || attribute.itemSize < 1 ||
            attribute.array.length % attribute.itemSize !== 0 ||
            !attribute.array.every(Number.isFinite)) {
          throw new Error('Project validation failed: invalid geometry attribute ' + attributeName);
        }
      }
      if (!Array.isArray(position?.array) || position.array.length < 9 || position.array.length % 3 !== 0) {
        throw new Error('Project validation failed: invalid position geometry');
      }
      if (saved.geometry.index != null) {
        if (!Array.isArray(saved.geometry.index) ||
            !saved.geometry.index.every(value => Number.isSafeInteger(value) && value >= 0 && value < position.array.length / 3)) {
          throw new Error('Project validation failed: invalid geometry index buffer');
        }
      }
    }

    if (isShapeMesh && version >= 4 &&
        (typeof saved.shapeId !== 'string' || !/^No\.\d+$/.test(saved.shapeId))) {
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
      if (saved.parentEditorId) {
        if (!editorIds.has(saved.parentEditorId)) {
          throw new Error('Project validation failed: missing parent object ' + saved.parentEditorId);
        }
        if (saved.parentEditorId === saved.editorId) {
          throw new Error('Project validation failed: object cannot parent itself ' + saved.editorId);
        }
      }
      if (saved.ownerShapeId && !shapeIds.has(saved.ownerShapeId)) {
        throw new Error('Project validation failed: missing owning Shape ' + saved.ownerShapeId);
      }
      const boneIds = saved.skeleton?.boneEditorIds;
      if (boneIds != null) {
        if (!Array.isArray(boneIds) || boneIds.length === 0 || new Set(boneIds).size !== boneIds.length) {
          throw new Error('Project validation failed: invalid skeleton bone references');
        }
        for (const id of boneIds) {
          if (!editorIds.has(id) || byEditorId.get(id)?.kind !== 'Bone') {
            throw new Error('Project validation failed: missing skeleton bone ' + id);
          }
        }
      }
      const rootBoneId = saved.editorData?.rigRootBoneId;
      if (rootBoneId && (!editorIds.has(rootBoneId) || byEditorId.get(rootBoneId)?.kind !== 'Bone')) {
        throw new Error('Project validation failed: missing IK root bone ' + rootBoneId);
      }
    }

    // Parent links must form a forest. Cycles can break world-matrix updates and
    // make a restored hierarchy impossible to reason about.
    const parentById = new Map(objects.filter(item => item.editorId).map(item => [item.editorId, item.parentEditorId || null]));
    const complete = new Set();
    for (const id of parentById.keys()) {
      const path = new Set();
      let current = id;
      while (current && parentById.has(current) && !complete.has(current)) {
        if (path.has(current)) throw new Error('Project validation failed: hierarchy contains a parent cycle');
        path.add(current);
        current = parentById.get(current);
      }
      path.forEach(item => complete.add(item));
    }
  }
  return { editorIdCount: editorIds.size, shapeIdCount: shapeIds.size };
}
