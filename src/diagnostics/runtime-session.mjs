export function createRuntimeSession(now = Date.now(), random = Math.random) {
  const timePart = Number(now).toString(36);
  const randomPart = Number(random()).toString(36).slice(2, 9).padEnd(7, '0');
  return `N3D-${timePart}-${randomPart}`;
}

export const RUNTIME_SESSION_ID = createRuntimeSession();
export const RUNTIME_SESSION_STARTED_AT = new Date().toISOString();

let runtimeEventSequence = 0;

export function createRuntimeEventMetadata(source, message, timestamp = new Date()) {
  const sourceText = String(source || '');
  const messageText = String(message || '');
  let origin = 'SYSTEM';
  if (sourceText === 'Interaction Trace') origin = 'USER_ACTION';
  else if (/project|archive/i.test(sourceText) && /restore|load|import/i.test(messageText)) origin = 'RESTORE';
  else if (/monitor|performance|resource|webgl/i.test(sourceText)) origin = 'AUTO_PROCESS';

  runtimeEventSequence += 1;
  return {
    sessionId: RUNTIME_SESSION_ID,
    sequence: runtimeEventSequence,
    timestampISO: timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString(),
    origin,
  };
}

export function formatRuntimeTraceReport(entries, session = {}) {
  const sessionId = session.sessionId || RUNTIME_SESSION_ID;
  const startedAt = session.startedAt || RUNTIME_SESSION_STARTED_AT;
  const current = entries.filter(entry => entry.sessionId === sessionId).length;
  const previous = entries.length - current;
  const lines = [
    'NEXUS3D RDS · RUNTIME INTERACTION TRACE',
    `Current session: ${sessionId}`,
    `Session started: ${startedAt}`,
    `Events: ${entries.length} · Current session: ${current} · Previous/legacy: ${previous}`,
    'Origin labels: USER_ACTION = direct interaction trace; AUTO_PROCESS = runtime monitor; RESTORE = project restore/import; SYSTEM = other runtime event.',
    '',
    ...entries.map(entry => {
      const sessionLabel = entry.sessionId === sessionId ? 'CURRENT_SESSION' : entry.sessionId ? 'PREVIOUS_SESSION' : 'LEGACY_UNKNOWN_SESSION';
      const timestamp = entry.timestampISO || entry.time || 'UNKNOWN_TIME';
      const sequence = Number.isFinite(entry.sequence) ? entry.sequence : '?';
      const origin = entry.origin || 'UNKNOWN_ORIGIN';
      return `[${timestamp}] [${sessionLabel}] [${origin}] [seq:${sequence}] [${entry.level}] [${entry.source}] ${entry.message}${entry.details ? '\n' + entry.details : ''}`;
    }),
    '',
    'LEGACY NOTE: Entries without a session ID or ISO timestamp were retained from an older RDS format and cannot be attributed to this app session with certainty.'
  ];
  return lines.join('\n\n');
}
