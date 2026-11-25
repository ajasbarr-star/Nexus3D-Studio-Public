const LEVEL_ERROR = new Set(['ERROR', 'FATAL']);
const LEVEL_WARNING = new Set(['WARN', 'WARNING']);

function entryLevel(entry) {
  const level = String(entry?.level || 'INFO').toUpperCase();
  return level === 'WARNING' ? 'WARN' : level;
}

export function formatRdsEntries(entries = []) {
  if (!entries.length) return 'No matching diagnostic entries were captured.';
  return entries.map(entry => {
    const timestamp = entry.timestampISO || entry.time || 'UNKNOWN_TIME';
    const level = entryLevel(entry);
    const source = entry.source || entry.componentTag || 'UNKNOWN_SOURCE';
    const message = entry.message || '';
    const details = entry.details ? '\n' + entry.details : '';
    return '[' + timestamp + '] [' + level + '] [' + source + '] ' + message + details;
  }).join('\n\n');
}


function parseEntryDetails(entry) {
  if (!entry?.details) return null;
  try { return JSON.parse(entry.details); } catch { return null; }
}

export function formatInteractionHierarchy(entries = []) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry?.interactionId) continue;
    const details = parseEntryDetails(entry);
    if (!details) continue;
    const group = groups.get(entry.interactionId) || { interactionId: entry.interactionId };
    if (entry.message === 'CONTROL_ACTIVATION' || entry.message === 'CONTROL_VALUE') {
      const hierarchy = details.target?.hierarchy;
      if (Array.isArray(hierarchy) && hierarchy.length) {
        group.hierarchy = hierarchy;
        group.timestamp = entry.timestampISO || entry.time || group.timestamp || 'UNKNOWN_TIME';
      }
    }
    if (entry.message === 'SCENE_OBJECT_CREATE_RESULT' && details.object) {
      group.result = details;
      group.resultTimestamp = entry.timestampISO || entry.time || 'UNKNOWN_TIME';
    }
    groups.set(entry.interactionId, group);
  }

  const lines = [];
  for (const group of groups.values()) {
    if (!group.hierarchy?.length || !group.result?.object) continue;
    const object = group.result.object;
    const timing = group.result.timing || {};
    const verification = group.result.verification || {};
    lines.push(
      '[' + (group.timestamp || group.resultTimestamp || 'UNKNOWN_TIME') + '] Interaction ID: ' + group.interactionId,
      ...group.hierarchy.filter(node => node.type !== 'object').map((node, index, nodes) => {
        const prefix = index === nodes.length - 1 ? '   └─ ' : '   ├─ ';
        const label = node.type === 'tool' ? 'Tool: ' : node.type === 'panel' ? 'Panel: ' :
          node.type === 'control' ? 'Inside: ' : node.type === 'action' ? 'Action: ' : '';
        return prefix + label + (node.label || node.type || 'Unknown');
      }),
      '   └─ Object: ' + String(object.name || 'Unnamed object') +
        (object.id ? ' [ID: ' + String(object.id) + ']' : ''),
      '      ├─ Scene Tree: ' + String(verification.sceneTreeList || 'NOT_MEASURED') +
        ' | MainViewport: ' + String(verification.mainViewportScene || 'NOT_MEASURED'),
      '      ├─ Processing to scene update: ' +
        (Number.isFinite(timing.processingToSceneUpdateMs) ? timing.processingToSceneUpdateMs + ' ms' : 'NOT_MEASURED'),
      '      └─ First rendered frame: ' + String(timing.firstRenderedFrame || 'NOT_MEASURED'),
      '   Result: ' + String(group.result.status || 'UNKNOWN')
    );
  }
  return lines.length ? lines.join('\n') : 'No complete tool-to-created-object interaction chains were captured.';
}

function severityLines(report, matcher) {
  return String(report || '').split(/\r?\n/).filter(line => matcher.test(line)).map(line => line.trim()).filter(Boolean);
}

export function buildRdsExportFiles({ tool, fullReport, entries = [], metadata = {} }) {
  const report = String(fullReport || 'No report content was available for this tool.')
    // Normalize only current-session section separators from the App export builder.
    // Escaped newlines inside diagnostic details and stack traces are preserved.
    .replace(/\\n(?=Historical (?:LogCat|RIT-Trace) entries excluded:)/g, '\n')
    .replace(/\\n(?=NEXUS3D RDS)/g, '\n');
  const workflow = String(tool || '').toLowerCase().includes('rit trace')
    ? '\n\n[USER WORKFLOW HIERARCHY]\n' + formatInteractionHierarchy(entries)
    : '';
  const completeReport = report + workflow;
  const errors = entries.filter(entry => LEVEL_ERROR.has(entryLevel(entry)));
  const warnings = entries.filter(entry => LEVEL_WARNING.has(entryLevel(entry)));
  const errorLines = [...new Set([
    ...formatRdsEntries(errors).split('\n').filter(Boolean).filter(line => line !== 'No matching diagnostic entries were captured.'),
    ...severityLines(report, /\b(ERROR|FATAL)\b/i)
  ])];
  const warningLines = [...new Set([
    ...formatRdsEntries(warnings).split('\n').filter(Boolean).filter(line => line !== 'No matching diagnostic entries were captured.'),
    ...severityLines(report, /\b(WARN|WARNING)\b/i)
  ])];
  // Count diagnostic records, not formatted text lines: a single entry may contain
  // multiple detail/stack lines. Fall back to report severity lines for report-only tools.
  const errorCount = errors.length || severityLines(report, /\b(ERROR|FATAL)\b/i).length;
  const warningCount = warnings.length || severityLines(report, /\b(WARN|WARNING)\b/i).length;
  const generatedAt = metadata.generatedAt || new Date().toISOString();
  const summary = [
    'NEXUS3D RDS TOOL SUMMARY',
    'Tool: ' + tool,
    'Generated: ' + generatedAt,
    'Captured entries: ' + entries.length,
    'Errors: ' + errorCount,
    'Warnings: ' + warningCount,
    ...(metadata.sceneVerificationSummary ? ['Scene verification: ' + metadata.sceneVerificationSummary] : []),
    ...(metadata.historicalLogcatEntriesExcluded !== undefined ? ['Historical LogCat entries excluded: ' + metadata.historicalLogcatEntriesExcluded] : []),
    ...(metadata.historicalRitEntriesExcluded !== undefined ? ['Historical RIT-Trace entries excluded: ' + metadata.historicalRitEntriesExcluded] : []),
    'Full report characters: ' + report.length,
    '',
    'This package contains the complete report plus separate error and warning extracts.',
    'An empty error or warning file means no matching entries were captured in this report.'
  ].join('\n');
  const metadataText = [
    'NEXUS3D RDS EXPORT METADATA',
    ...Object.entries({ tool, ...metadata }).map(([key, value]) =>
      key + ': ' + (typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')))
  ].join('\n');
  return {
    'Full_Report.txt': completeReport,
    'Errors.txt': errorLines.length ? errorLines.join('\n') : 'No ERROR or FATAL entries were captured for this tool.\n',
    'Warnings.txt': warningLines.length ? warningLines.join('\n') : 'No WARN or WARNING entries were captured for this tool.\n',
    'Summary.txt': summary,
    'Metadata.txt': metadataText
  };
}
