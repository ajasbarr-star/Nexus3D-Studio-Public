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

function severityLines(report, matcher) {
  return String(report || '').split(/\r?\n/).filter(line => matcher.test(line)).map(line => line.trim()).filter(Boolean);
}

export function buildRdsExportFiles({ tool, fullReport, entries = [], metadata = {} }) {
  const report = String(fullReport || 'No report content was available for this tool.');
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
    'Full_Report.txt': report,
    'Errors.txt': errorLines.length ? errorLines.join('\n') : 'No ERROR or FATAL entries were captured for this tool.\n',
    'Warnings.txt': warningLines.length ? warningLines.join('\n') : 'No WARN or WARNING entries were captured for this tool.\n',
    'Summary.txt': summary,
    'Metadata.txt': metadataText
  };
}
