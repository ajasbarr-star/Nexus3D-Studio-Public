import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOGCAT_STORAGE_KEY, RIT_TRACE_STORAGE_KEY, LEGACY_DIAGNOSTICS_STORAGE_KEY,
  loadLogcatEntries, loadRitTraceEntries, saveLogcatEntries, saveRitTraceEntries,
  clearLogcatEntries, clearRitTraceEntries
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

test('LogCat and RIT Trace persist in separate storage keys and queues', () => {
  const storage = memoryStorage();
  const log = { id: 'l1', source: 'Renderer', message: 'Frame slow' };
  const trace = { id: 'r1', source: 'Interaction Trace', message: 'Shape selected' };
  saveLogcatEntries(storage, [log, trace]);
  saveRitTraceEntries(storage, [trace, log]);
  assert.deepEqual(loadLogcatEntries(storage), [log]);
  assert.deepEqual(loadRitTraceEntries(storage), [trace]);
  assert.notEqual(LOGCAT_STORAGE_KEY, RIT_TRACE_STORAGE_KEY);
});

test('clearing LogCat never clears RIT Trace, and vice versa', () => {
  const storage = memoryStorage();
  const log = { id: 'l1', source: 'Renderer' };
  const trace = { id: 'r1', source: 'Interaction Trace' };
  saveLogcatEntries(storage, [log]);
  saveRitTraceEntries(storage, [trace]);
  clearLogcatEntries(storage);
  assert.deepEqual(loadLogcatEntries(storage), []);
  assert.equal(storage.has(LOGCAT_STORAGE_KEY), true);
  assert.deepEqual(loadRitTraceEntries(storage), [trace]);
  saveLogcatEntries(storage, [log]);
  clearRitTraceEntries(storage);
  assert.deepEqual(loadLogcatEntries(storage), [log]);
  assert.deepEqual(loadRitTraceEntries(storage), []);
});

test('legacy shared diagnostics migrate into separate stores without deleting recovery data', () => {
  const old = [
    { id: 'l1', source: 'Renderer' },
    { id: 'r1', source: 'Interaction Trace' }
  ];
  const storage = memoryStorage({ [LEGACY_DIAGNOSTICS_STORAGE_KEY]: JSON.stringify(old) });
  assert.deepEqual(loadLogcatEntries(storage), [old[0]]);
  assert.deepEqual(loadRitTraceEntries(storage), [old[1]]);
  assert.equal(storage.has(LEGACY_DIAGNOSTICS_STORAGE_KEY), true);
});

test('malformed persisted data safely loads as empty arrays', () => {
  const storage = memoryStorage({ [LOGCAT_STORAGE_KEY]: '{bad', [RIT_TRACE_STORAGE_KEY]: 'null' });
  assert.deepEqual(loadLogcatEntries(storage), []);
  assert.deepEqual(loadRitTraceEntries(storage), []);
});

test('cleared legacy partition does not resurrect on a later app load', () => {
  const old = [{ id: 'l1', source: 'Renderer' }, { id: 'r1', source: 'Interaction Trace' }];
  const storage = memoryStorage({ [LEGACY_DIAGNOSTICS_STORAGE_KEY]: JSON.stringify(old) });
  loadLogcatEntries(storage);
  loadRitTraceEntries(storage);
  clearLogcatEntries(storage);
  assert.deepEqual(loadLogcatEntries(storage), []);
  assert.deepEqual(loadRitTraceEntries(storage), [old[1]]);
});


test('fresh app session clears all persisted active diagnostic stores and legacy source', () => {
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

test('new diagnostic entries remain memory-only and are not persisted for the next APK launch', () => {
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
