const LEVELS = new Set(['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);

export function normalizeDiagnosticLevel(level) {
  const value = String(level || 'INFO').toUpperCase();
  if (value === 'WARNING') return 'WARN';
  return LEVELS.has(value) ? value : 'INFO';
}

export function inferTracePoint(source, message, activeTool = 'Overview') {
  const text = `${String(source || '')} ${String(message || '')}`.toLowerCase();
  if (/scene.?tree|hierarchy/.test(text)) return 'SCENE_TREE';
  if (/ik.?viewport|rigging viewport/.test(text)) return 'IK_VIEWPORT';
  if (/main.?viewport|viewport pointer/.test(text)) return 'MAIN_VIEWPORT';
  if (/renderer|webgl|frame|performance|resource/.test(text)) return 'RENDER_RUNTIME';
  if (/crash|exception|unhandled|rejection/.test(text)) return 'APP_EXCEPTION';
  if (/interaction trace/.test(text)) return 'USER_INTERACTION';
  const tool = String(activeTool || 'Overview').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return tool === 'OVERVIEW' ? 'RUNTIME_SYSTEM' : `RDS_${tool}`;
}

export function filterDiagnosticEntries(entries, filters = {}) {
  const query = String(filters.query || '').trim();
  let regex = null;
  if (filters.regex && query) {
    try { regex = new RegExp(query, 'i'); } catch { return []; }
  }
  const from = filters.from ? new Date(filters.from).getTime() : NaN;
  const to = filters.to ? new Date(filters.to).getTime() : NaN;
  return entries.filter(entry => {
    const level = normalizeDiagnosticLevel(entry.level);
    if (filters.level && filters.level !== 'ALL' && level !== filters.level) return false;
    if (filters.source && !String(entry.source || '').toLowerCase().includes(String(filters.source).toLowerCase())) return false;
    if (filters.tag && !String(entry.componentTag || entry.source || '').toLowerCase().includes(String(filters.tag).toLowerCase())) return false;
    if (filters.tracePoint && filters.tracePoint !== 'ALL' && entry.tracePoint !== filters.tracePoint) return false;
    if (filters.objectId && !String(entry.objectId || entry.details || '').includes(String(filters.objectId))) return false;
    if (filters.sessionId && !String(entry.sessionId || '').includes(String(filters.sessionId))) return false;
    const timestamp = new Date(entry.timestampISO || entry.time || 0).getTime();
    if (Number.isFinite(from) && timestamp < from) return false;
    if (Number.isFinite(to) && timestamp > to) return false;
    const haystack = [entry.source, entry.componentTag, entry.tracePoint, entry.message, entry.details, entry.objectId, entry.sessionId].join(' ');
    if (regex && !regex.test(haystack)) return false;
    if (query && !regex && !haystack.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
}

export function formatDiagnosticReport(entries, session = {}) {
  const lines = [
    'NEXUS3D RDS — DIAGNOSTIC REPORT',
    `Generated: ${new Date().toISOString()}`,
    `Session: ${session.sessionId || 'ALL'}`,
    `Events included: ${entries.length}`,
    'Fields: timestamp | session | sequence | interaction ID | level | trace point | component tag | source | message | details',
    '',
    ...entries.map(entry => [
      entry.timestampISO || entry.time || 'UNKNOWN_TIME',
      entry.sessionId || 'UNKNOWN_SESSION',
      entry.sequence ?? '?',
      entry.interactionId || '-',
      normalizeDiagnosticLevel(entry.level),
      entry.tracePoint || 'UNKNOWN_TRACE_POINT',
      entry.componentTag || entry.source || 'UNKNOWN_COMPONENT',
      entry.source || 'UNKNOWN_SOURCE',
      entry.message || '',
      entry.details || ''
    ].join(' | '))
  ];
  return lines.join('\n');
}

export function summarizeFrameTimes(samples = []) {
  if (!samples.length) return { samples: 0, averageMs: null, p95Ms: null, maxMs: null, slowFrames: 0 };
  const sorted = samples.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return { samples: 0, averageMs: null, p95Ms: null, maxMs: null, slowFrames: 0 };
  return {
    samples: sorted.length,
    averageMs: Number((sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(2)),
    p95Ms: Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)].toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
    slowFrames: sorted.filter(value => value > 33.33).length
  };
}
