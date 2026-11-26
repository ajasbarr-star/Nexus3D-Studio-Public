import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOGCAT_STORAGE_KEY, RIT_TRACE_STORAGE_KEY, LEGACY_DIAGNOSTICS_STORAGE_KEY,
  clearAllDiagnosticStores, loadLogcatEntries, loadRitTraceEntries,
  saveLogcatEntries, saveRitTraceEntries, clearLogcatEntries, clearRitTraceEntries
} from '../../src/diagnostics/independent-diagnostic-stores.mjs';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    has(key) { return values.has(key); }
  };
}

test('active LogCat and RIT Trace stores remain logically separate', () => {
  assert.notEqual(LOGCAT_STORAGE_KEY, RIT_TRACE_STORAGE_KEY);
});

test('a fresh app session clears all prior LogCat, RIT Trace and legacy records', () => {
  const storage = memoryStorage({
    [LOGCAT_STORAGE_KEY]: JSON.stringify([{ id: 'old-log', source: 'Renderer' }]),
    [RIT_TRACE_STORAGE_KEY]: JSON.stringify([{ id: 'old-trace', source: 'Interaction Trace' }]),
    [LEGACY_DIAGNOSTICS_STORAGE_KEY]: JSON.stringify([{ id: 'old-legacy', source: 'Renderer' }])
  });
  assert.deepEqual(loadLogcatEntries(storage), []);
  assert.deepEqual(loadRitTraceEntries(storage), []);
  assert.equal(storage.has(LOGCAT_STORAGE_KEY), false);
  assert.equal(storage.has(RIT_TRACE_STORAGE_KEY), false);
  assert.equal(storage.has(LEGACY_DIAGNOSTICS_STORAGE_KEY), false);
});

test('new active records are not persisted and cannot be reused after an APK restart', () => {
  const storage = memoryStorage();
  assert.equal(saveLogcatEntries(storage, [{ id: 'l1', source: 'Renderer' }]), false);
  assert.equal(saveRitTraceEntries(storage, [{ id: 'r1', source: 'Interaction Trace' }]), false);
  assert.deepEqual(loadLogcatEntries(storage), []);
  assert.deepEqual(loadRitTraceEntries(storage), []);
  assert.equal(storage.has(LOGCAT_STORAGE_KEY), false);
  assert.equal(storage.has(RIT_TRACE_STORAGE_KEY), false);
});

test('explicit per-tool cleanup does not delete the other tool store', () => {
  const storage = memoryStorage({
    [LOGCAT_STORAGE_KEY]: '[]',
    [RIT_TRACE_STORAGE_KEY]: '[]'
  });
  assert.equal(clearLogcatEntries(storage), true);
  assert.equal(storage.has(RIT_TRACE_STORAGE_KEY), true);
  assert.equal(clearRitTraceEntries(storage), true);
  assert.equal(storage.has(RIT_TRACE_STORAGE_KEY), false);
});

test('global cleanup clears all known active and legacy diagnostic keys', () => {
  const storage = memoryStorage({
    [LOGCAT_STORAGE_KEY]: '[]',
    [RIT_TRACE_STORAGE_KEY]: '[]',
    [LEGACY_DIAGNOSTICS_STORAGE_KEY]: '[]'
  });
  const result = clearAllDiagnosticStores(storage);
  assert.equal(result.cleared, true);
  assert.deepEqual(result.keys.sort(), [
    LOGCAT_STORAGE_KEY, RIT_TRACE_STORAGE_KEY, LEGACY_DIAGNOSTICS_STORAGE_KEY
  ].sort());
  assert.equal(storage.has(LOGCAT_STORAGE_KEY), false);
  assert.equal(storage.has(RIT_TRACE_STORAGE_KEY), false);
  assert.equal(storage.has(LEGACY_DIAGNOSTICS_STORAGE_KEY), false);
});
