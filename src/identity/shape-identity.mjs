/**
 * Permanent per-shape identity helpers.
 * editorId remains the runtime/editor reference; shapeId is the durable project key.
 */
export function allocateShapeIdentity(objects = [], nextId = 1) {
  const used = new Set((Array.isArray(objects) ? objects : [])
    .map(object => object?.userData?.shapeId)
    .filter(value => typeof value === 'string' && /^No\.\d+$/.test(value)));
  const numeric = [...used].map(value => Number(value.slice(3))).filter(Number.isSafeInteger);
  let candidate = Math.max(1, Number.isSafeInteger(Number(nextId)) ? Number(nextId) : 1, ...numeric.map(value => value + 1));
  let shapeId = 'No.' + String(candidate).padStart(2, '0');
  while (used.has(shapeId)) {
    candidate += 1;
    shapeId = 'No.' + String(candidate).padStart(2, '0');
  }
  return { shapeId, nextId: candidate + 1 };
}

export function formatShapeIdentity(name, shapeId) {
  const safeName = typeof name === 'string' && name.trim() ? name.trim() : 'Shape';
  if (typeof shapeId !== 'string' || !/^No\.\d+$/.test(shapeId)) {
    throw new TypeError('A valid permanent Shape ID is required');
  }
  return safeName + '-ID ' + shapeId;
}

export function ensureShapeIdentity(object, objects = [], nextId = 1) {
  if (!object || !object.userData) throw new TypeError('A Shape object with userData is required');
  const current = object.userData.shapeId;
  const collision = current && (Array.isArray(objects) ? objects : []).some(candidate =>
    candidate !== object && candidate?.userData?.shapeId === current
  );
  if (typeof current === 'string' && /^No\.\d+$/.test(current) && !collision) {
    return { shapeId: current, nextId: Math.max(Number(nextId) || 1, Number(current.slice(3)) + 1) };
  }
  const identity = allocateShapeIdentity((Array.isArray(objects) ? objects : []).filter(candidate => candidate !== object), nextId);
  object.userData.shapeId = identity.shapeId;
  return identity;
}
