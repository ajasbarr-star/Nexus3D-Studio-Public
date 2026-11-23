export const LOGCAT_STORAGE_KEY = 'nexus3d_logcat_v1';
export const RIT_TRACE_STORAGE_KEY = 'nexus3d_rit_trace_v1';
export const LEGACY_DIAGNOSTICS_STORAGE_KEY = 'nexus3d_realtime_diagnostics_v1';
const ENTRY_LIMIT = 400;

function readArray(storage, key) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-ENTRY_LIMIT) : null;
  } catch {
    return null;
  }
}

function writeArray(storage, key, entries) {
  try {
    storage?.setItem(key, JSON.stringify(Array.isArray(entries) ? entries.slice(-ENTRY_LIMIT) : []));
    return true;
  } catch {
    return false;
  }
}

/** Split legacy shared records once, without deleting the original recovery copy. */
export function migrateLegacyDiagnosticEntries(storage) {
  const logcatExists = Boolean(storage?.getItem(LOGCAT_STORAGE_KEY));
  const ritExists = Boolean(storage?.getItem(RIT_TRACE_STORAGE_KEY));
  if (logcatExists && ritExists) return { migrated: false, logcat: 0, rit: 0 };
  const legacy = readArray(storage, LEGACY_DIAGNOSTICS_STORAGE_KEY) || [];
  const rit = legacy.filter(entry => entry?.source === 'Interaction Trace');
  const logcat = legacy.filter(entry => entry?.source !== 'Interaction Trace');
  if (!logcatExists) writeArray(storage, LOGCAT_STORAGE_KEY, logcat);
  if (!ritExists) writeArray(storage, RIT_TRACE_STORAGE_KEY, rit);
  return { migrated: legacy.length > 0, logcat: logcat.length, rit: rit.length };
}

export function loadLogcatEntries(storage) {
  migrateLegacyDiagnosticEntries(storage);
  return (readArray(storage, LOGCAT_STORAGE_KEY) || []).filter(entry => entry?.source !== 'Interaction Trace');
}

export function loadRitTraceEntries(storage) {
  migrateLegacyDiagnosticEntries(storage);
  return (readArray(storage, RIT_TRACE_STORAGE_KEY) || []).filter(entry => entry?.source === 'Interaction Trace');
}

export function saveLogcatEntries(storage, entries) {
  return writeArray(storage, LOGCAT_STORAGE_KEY, (entries || []).filter(entry => entry?.source !== 'Interaction Trace'));
}

export function saveRitTraceEntries(storage, entries) {
  return writeArray(storage, RIT_TRACE_STORAGE_KEY, (entries || []).filter(entry => entry?.source === 'Interaction Trace'));
}

export function clearLogcatEntries(storage) {
  try { storage?.removeItem(LOGCAT_STORAGE_KEY); return true; } catch { return false; }
}

export function clearRitTraceEntries(storage) {
  try { storage?.removeItem(RIT_TRACE_STORAGE_KEY); return true; } catch { return false; }
}
