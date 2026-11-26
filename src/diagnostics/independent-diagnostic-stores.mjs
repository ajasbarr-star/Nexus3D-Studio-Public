export const LOGCAT_STORAGE_KEY = 'nexus3d_logcat_v1';
export const RIT_TRACE_STORAGE_KEY = 'nexus3d_rit_trace_v1';
export const LEGACY_DIAGNOSTICS_STORAGE_KEY = 'nexus3d_realtime_diagnostics_v1';

// Active diagnostic records are intentionally memory-only. A fresh WebView/app
// launch must never hydrate records from a previous RDS session.
const initializedStores = new WeakSet();

export function clearAllDiagnosticStores(storage) {
  if (!storage || (typeof storage !== 'object' && typeof storage !== 'function')) {
    return { cleared: false, keys: [] };
  }
  const keys = [LOGCAT_STORAGE_KEY, RIT_TRACE_STORAGE_KEY, LEGACY_DIAGNOSTICS_STORAGE_KEY];
  let cleared = true;
  for (const key of keys) {
    try { storage.removeItem(key); } catch { cleared = false; }
  }
  initializedStores.add(storage);
  return { cleared, keys };
}

function ensureFreshSession(storage) {
  if (!storage || (typeof storage !== 'object' && typeof storage !== 'function')) return;
  if (initializedStores.has(storage)) return;
  // Remove both current stores and the old shared migration source. Never migrate
  // or reuse a previous session's live records. Exported ZIP files are untouched.
  clearAllDiagnosticStores(storage);
}

export function migrateLegacyDiagnosticEntries(storage) {
  ensureFreshSession(storage);
  return { migrated: false, logcat: 0, rit: 0, legacyRemoved: true };
}

export function loadLogcatEntries(storage) {
  ensureFreshSession(storage);
  return [];
}

export function loadRitTraceEntries(storage) {
  ensureFreshSession(storage);
  return [];
}

// Compatibility no-ops: App.tsx can continue flushing UI queues without
// persisting active diagnostic records across APK launches.
export function saveLogcatEntries(_storage, _entries) {
  return false;
}

export function saveRitTraceEntries(_storage, _entries) {
  return false;
}

export function clearLogcatEntries(storage) {
  try { storage?.removeItem(LOGCAT_STORAGE_KEY); return true; } catch { return false; }
}

export function clearRitTraceEntries(storage) {
  try { storage?.removeItem(RIT_TRACE_STORAGE_KEY); return true; } catch { return false; }
}
