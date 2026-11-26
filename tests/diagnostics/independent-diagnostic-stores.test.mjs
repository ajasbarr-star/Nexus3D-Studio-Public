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

test('a fresh app session clears all prior LogCat, RIT Trace and legacy records', () => {
  const oldLog = [{ id: 'old-log', source: 'Renderer' }];
  const oldTrace = [{ id: 'old-trace', source: 'Interaction Trace' }];
  const oldLegacy = [{ id: 'old-legacy', source: 'Renderer' }];
  const storage = memoryStorage({
    [LOGCAT_STORAGE_KEY]: JSON.stringify(oldLog),
    [RIT_TRACE_STORAGE_KEY]: JSON.stringify(oldTrace),
    [LEGACY_DIAGNOSTICS_STORAGE_KEY]: JSON.stringify(oldLegacy)
  });
  assert.deepEqual(loadLogcatEntries(storage), []);
  assert.deepEqual(loadRitTraceEntries(storage), []);
  assert.equal(storage.has(LOGCAT_STORAGE_KEY), false);
  assert.equal(storage.has(RIT_TRACE_STORAGE_KEY), false);
  assert.equal(storage.has(LEGACY_DIAGNOSTICS_STORAGE_KEY), false);
});

test('fresh-session initialization happens once and never migrates legacy records', () => {
  const old = [
    { id: 'l1', source: 'Renderer' },
    { id: 'r1', source: 'Interaction Trace' }
  ];
  const storage = memoryStorage({ [LEGACY_DIAGNOSTICS_STORAGE_KEY]: JSON.stringify(old) });
  assert.deepEqual(loadLogcatEntries(storage), []);
  assert.deepEqual(loadRitTraceEntries(storage), []);
  assert.equal(storage.has(LEGACY_DIAGNOSTICS_STORAGE_KEY), false);
});

test('active diagnostic records are memory-only and cannot be reused after reload', () => {
  const storage = memoryStorage();
  const log = { id: 'l1', source: 'Renderer' };
  const trace = { id: 'r1', source: 'Interaction Trace' };
  assert.equal(saveLogcatEntries(storage, [log]), false);
  assert.equal(saveRitTraceEntries(storage, [trace]), false);
  assert.deepEqual(loadLogcatEntries(storage), []);
  assert.deepEqual(loadRitTraceEntries(storage), []);
  assert.equal(storage.has(LOGCAT_STORAGE_KEY), false);
  assert.equal(storage.has(RIT_TRACE_STORAGE_KEY), false);
});

test('explicit cleanup removes only the requested active store; global cleanup removes all legacy keys', () => {
  const storage = memoryStorage({
    [LOGCAT_STORAGE_KEY]: '[]',
    [RIT_TRACE_STORAGE_KEY]: '[]',
    [LEGACY_DIAGNOSTICS_STORAGE_KEY]: '[]'
  });
  // Explicit per-tool clear remains independently callable.
  assert.equal(clearLogcatEntries(storage), true);
  assert.equal(storage.has(LOGCAT_STORAGE_KEY), false);
  assert.equal(storage.has(RIT_TRACE_STORAGE_KEY), true);
  assert.equal(clearRitTraceEntries(storage), true);
  assert.equal(storage.has(RIT_TRACE_STORAGE_KEY), false);
  const result = clearAllDiagnosticStores(storage);
  assert.equal(result.cleared, true);
  assert.equal(result.keys.length, 3);
  assert.equal(storage.has(LEGACY_DIAGNOSTICS_STORAGE_KEY), false);
});
