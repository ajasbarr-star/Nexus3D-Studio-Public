const DEFAULT_LIMIT = 5000;

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function createUniqueId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

export function createRdsRecordingController({
  tools = [],
  sessionId = 'UNASSIGNED_SESSION',
  buildNumber = 'UNKNOWN_BUILD',
  deviceId = 'UNKNOWN_DEVICE',
  now = () => new Date(),
  createId = createUniqueId,
  maxRecords = DEFAULT_LIMIT,
} = {}) {
  const states = new Map();
  const startupRecords = [];
  let ended = false;
  let canonicalDeviceId = String(deviceId || 'UNKNOWN_DEVICE');

  const ensure = tool => {
    const key = String(tool || '').trim();
    if (!key) throw new Error('RDS tool name is required');
    if (!states.has(key)) states.set(key, {
      tool: key,
      analysisEnabled: false,
      sceneCaptureEnabled: false,
      analysisStartedAt: null,
      captureStartedAt: null,
      records: [],
      sceneSnapshots: [],
      droppedRecords: 0,
      droppedSceneSnapshots: 0,
    });
    return states.get(key);
  };
  tools.forEach(ensure);

  const metadata = () => ({
    sessionId,
    buildNumber,
    deviceId: canonicalDeviceId,
    timestampISO: iso(now()),
  });

  function startAnalysis(tool) {
    if (ended) return false;
    const state = ensure(tool);
    // Preserve earlier runs in this runtime session so a later export remains complete.
    // The controller still applies maxRecords to bound memory use.
    state.sceneCaptureEnabled = false;
    state.captureStartedAt = null;
    state.analysisEnabled = true;
    state.analysisStartedAt = iso(now());
    return true;
  }

  function stopAnalysis(tool) {
    const state = ensure(tool);
    state.analysisEnabled = false;
    state.analysisStartedAt = null;
    state.sceneCaptureEnabled = false;
    state.captureStartedAt = null;
    return true;
  }

  function setSceneCapture(tool, enabled) {
    if (ended && enabled) return false;
    const state = ensure(tool);
    state.sceneCaptureEnabled = Boolean(enabled);
    state.captureStartedAt = enabled ? iso(now()) : null;
    return true;
  }

  function record(tool, event, details = {}, level = 'INFO') {
    if (ended) return null;
    const state = ensure(tool);
    if (!state.analysisEnabled) return null;
    const entry = {
      id: createId(),
      tool: state.tool,
      event: String(event || 'UNSPECIFIED_EVENT'),
      level: String(level || 'INFO').toUpperCase(),
      details,
      ...metadata(),
    };
    state.records.push(entry);
    if (state.records.length > maxRecords) {
      const excess = state.records.length - maxRecords;
      state.records.splice(0, excess);
      state.droppedRecords += excess;
    }
    return entry;
  }

  function captureScene(tool, snapshot, source = 'USER_REQUEST') {
    if (ended) return null;
    const state = ensure(tool);
    if (!state.sceneCaptureEnabled) return null;
    const entry = {
      id: createId(),
      tool: state.tool,
      event: 'SCENE_CAPTURE',
      source,
      snapshot,
      ...metadata(),
    };
    state.sceneSnapshots.push(entry);
    if (state.sceneSnapshots.length > maxRecords) {
      const excess = state.sceneSnapshots.length - maxRecords;
      state.sceneSnapshots.splice(0, excess);
      state.droppedSceneSnapshots += excess;
    }
    return entry;
  }

  function recordStartup(event, details = {}, status = 'MEASURED') {
    if (ended) return null;
    const entry = {
      id: createId(),
      event: String(event || 'STARTUP_MILESTONE'),
      status: String(status || 'UNKNOWN'),
      details,
      ...metadata(),
    };
    startupRecords.push(entry);
    if (startupRecords.length > maxRecords) startupRecords.splice(0, startupRecords.length - maxRecords);
    return entry;
  }

  function getToolRecords(tool) {
    const state = ensure(tool);
    return {
      tool: state.tool,
      analysisEnabled: state.analysisEnabled,
      sceneCaptureEnabled: state.sceneCaptureEnabled,
      analysisStartedAt: state.analysisStartedAt,
      captureStartedAt: state.captureStartedAt,
      records: state.records.slice(),
      sceneSnapshots: state.sceneSnapshots.slice(),
      droppedRecords: state.droppedRecords,
      droppedSceneSnapshots: state.droppedSceneSnapshots,
    };
  }

  function getStartupRecords() {
    return startupRecords.slice();
  }

  function endSession() {
    ended = true;
    for (const state of states.values()) {
      state.analysisEnabled = false;
      state.sceneCaptureEnabled = false;
      state.analysisStartedAt = null;
      state.captureStartedAt = null;
    }
    // Keep captured records available for the final report/export after recording stops.
    return true;
  }

  return {
    setDeviceId(value) {
      const next = String(value || '').trim();
      if (!next) return false;
      canonicalDeviceId = next;
      // Events captured before Android Keystore initialization inherit the same
      // installation identity once it becomes available; no record is discarded.
      for (const state of states.values()) {
        state.records.forEach(entry => { entry.deviceId = next; });
        state.sceneSnapshots.forEach(entry => { entry.deviceId = next; });
      }
      startupRecords.forEach(entry => { entry.deviceId = next; });
      return true;
    },
    startAnalysis,
    stopAnalysis,
    setSceneCapture,
    record,
    captureScene,
    recordStartup,
    getToolRecords,
    getStartupRecords,
    isAnalysisEnabled: tool => Boolean(states.get(String(tool || '').trim())?.analysisEnabled),
    isSceneCaptureEnabled: tool => Boolean(states.get(String(tool || '').trim())?.sceneCaptureEnabled),
    endSession,
    isEnded: () => ended,
  };
}
