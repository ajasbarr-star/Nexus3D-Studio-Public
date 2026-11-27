const DEFAULT_LIMIT = 5000;

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function createRdsRecordingController({
  tools = [],
  sessionId = 'UNASSIGNED_SESSION',
  buildNumber = 'UNKNOWN_BUILD',
  deviceId = 'UNKNOWN_DEVICE',
  now = () => new Date(),
  createId = () => 'rds-record',
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
    state.records.length = 0;
    state.sceneSnapshots.length = 0;
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
    if (state.records.length > maxRecords) state.records.splice(0, state.records.length - maxRecords);
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
    if (state.sceneSnapshots.length > maxRecords) state.sceneSnapshots.splice(0, state.sceneSnapshots.length - maxRecords);
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
      state.records.length = 0;
      state.sceneSnapshots.length = 0;
    }
    startupRecords.length = 0;
    return true;
  }

  return {
    setDeviceId(value) {
      const next = String(value || '').trim();
      if (!next) return false;
      canonicalDeviceId = next;
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
