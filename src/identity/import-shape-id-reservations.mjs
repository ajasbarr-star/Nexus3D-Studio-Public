/**
 * Allocate one stable destination Shape ID per imported source ID.
 * Multiple imported nodes may reference the same owning Shape ID; they must
 * all receive the same remapped ID when that source ID collides with the scene.
 */
export function reserveImportedShapeIds(objects, existingReservedIds, startingNextId = 1) {
  const reservedShapeIds = new Set(existingReservedIds || []);
  const shapeIdRemap = new Map();
  let nextShapeId = Math.max(1, Number(startingNextId) || 1);

  (Array.isArray(objects) ? objects : []).forEach(saved => {
    if (!saved || saved.shapeId == null || saved.shapeId === '') return;
    const sourceId = String(saved.shapeId);
    if (shapeIdRemap.has(sourceId)) return;

    if (reservedShapeIds.has(sourceId)) {
      let targetId = 'No.' + String(nextShapeId).padStart(2, '0');
      while (reservedShapeIds.has(targetId)) {
        nextShapeId += 1;
        targetId = 'No.' + String(nextShapeId).padStart(2, '0');
      }
      shapeIdRemap.set(sourceId, targetId);
      reservedShapeIds.add(targetId);
      nextShapeId += 1;
      return;
    }

    reservedShapeIds.add(sourceId);
    const numericId = Number(sourceId.replace(/^No\./, ''));
    if (Number.isSafeInteger(numericId)) nextShapeId = Math.max(nextShapeId, numericId + 1);
  });

  return { shapeIdRemap, reservedShapeIds, nextShapeId };
}
