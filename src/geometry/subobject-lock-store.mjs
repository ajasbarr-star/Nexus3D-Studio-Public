/**
 * Per-object Vertex/Edge lock storage.
 * Keys are stable editor object IDs; element IDs are render-vertex indices
 * (vertices) or normalized endpoint pairs (edges). Face selection remains separate.
 */
export function createSubObjectLockStore() {
  const objects = new Map();

  const normalizeKind = kind => {
    if (kind !== 'Vertex' && kind !== 'Edge') throw new TypeError('Lock kind must be Vertex or Edge');
    return kind;
  };

  const normalizeIds = (kind, ids) => {
    const values = Array.isArray(ids) ? ids : [];
    if (kind === 'Vertex') {
      return [...new Set(values.filter(Number.isInteger).filter(id => id >= 0))].sort((a, b) => a - b);
    }
    const keys = values.map(value => {
      if (Array.isArray(value) && value.length === 2 && value.every(Number.isInteger)) {
        const a = Math.min(value[0], value[1]);
        const b = Math.max(value[0], value[1]);
        return a + ':' + b;
      }
      if (typeof value === 'string' && /^\\d+:\\d+$/.test(value)) {
        const [a, b] = value.split(':').map(Number);
        return Math.min(a, b) + ':' + Math.max(a, b);
      }
      return null;
    }).filter(Boolean);
    return [...new Set(keys)].sort();
  };

  return {
    add(objectId, kind, ids) {
      if (typeof objectId !== 'string' || !objectId.trim()) throw new TypeError('A stable object ID is required');
      normalizeKind(kind);
      const current = objects.get(objectId) || { Vertex: [], Edge: [] };
      const next = normalizeIds(kind, [...current[kind], ...normalizeIds(kind, ids)]);
      objects.set(objectId, { ...current, [kind]: next });
      return [...next];
    },
    get(objectId, kind) {
      normalizeKind(kind);
      return [...(objects.get(objectId)?.[kind] || [])];
    },
    clear(objectId, kind) {
      if (objectId == null) {
        objects.clear();
        return;
      }
      normalizeKind(kind);
      const current = objects.get(objectId);
      if (!current) return;
      const next = { ...current, [kind]: [] };
      if (!next.Vertex.length && !next.Edge.length) objects.delete(objectId);
      else objects.set(objectId, next);
    },
    clearObject(objectId) {
      objects.delete(objectId);
    },
    snapshot() {
      return [...objects.entries()].map(([objectId, locks]) => ({
        objectId,
        Vertex: [...locks.Vertex],
        Edge: [...locks.Edge],
      }));
    },
  };
}
