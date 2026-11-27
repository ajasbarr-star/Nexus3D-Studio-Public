const LEVEL_ERROR = new Set(['ERROR', 'FATAL']);
const LEVEL_WARNING = new Set(['WARN', 'WARNING']);

function entryLevel(entry) {
  const level = String(entry?.level || 'INFO').toUpperCase();
  return level === 'WARNING' ? 'WARN' : level;
}

export function formatRdsEntries(entries = []) {
  if (!entries.length) return 'NO DATA CAPTURED — no matching diagnostic entries were recorded for this tool.';
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
    const details = parseEntryDetails(entry);
    if (!details) continue;
    const interactionId = entry.interactionId || details.interactionId;
    if (!interactionId) continue;
    const group = groups.get(interactionId) || { interactionId };
    if (entry.message === 'GESTURE_COMPLETE') {
      group.gesture = details;
      group.timestamp = entry.timestampISO || entry.time || group.timestamp || 'UNKNOWN_TIME';
    }
    if (entry.message === 'CAMERA_GESTURE_COMPLETE') group.cameraGesture = details;
    if (entry.message === 'CAMERA_UPDATE') group.cameraUpdate = details;
    if (entry.message === 'CAMERA_FIRST_RENDERED_FRAME') group.firstRenderedFrame = details;
    if (entry.message === 'CAMERA_GESTURE_COMPLETE' || entry.message === 'CAMERA_UPDATE' || entry.message === 'CAMERA_FIRST_RENDERED_FRAME') {
      group.timestamp = entry.timestampISO || entry.time || group.timestamp || 'UNKNOWN_TIME';
    }
    if (entry.message === 'CONTROL_ACTIVATION' || entry.message === 'CONTROL_VALUE') {
      group.control = details;
      group.timestamp = entry.timestampISO || entry.time || group.timestamp || 'UNKNOWN_TIME';
    }
    if (entry.message === 'SCENE_OBJECT_CREATE_RESULT' && details.object) {
      group.result = details;
      group.resultTimestamp = entry.timestampISO || entry.time || 'UNKNOWN_TIME';
    }
    groups.set(interactionId, group);
  }

  const lines = [];
  for (const group of groups.values()) {
    const gesture = group.gesture;
    const control = group.control;
    const target = control?.target || gesture?.target || {};
    const hierarchy = Array.isArray(target.hierarchy) ? target.hierarchy : [];
    if (!gesture && !control && !group.result && !group.cameraGesture && !group.cameraUpdate && !group.firstRenderedFrame) continue;
    lines.push('[' + (group.timestamp || group.resultTimestamp || 'UNKNOWN_TIME') + '] Interaction ID: ' + group.interactionId);
    if (gesture) {
      lines.push(
        '   Touch: ' + String(gesture.pointerType || 'unknown') + ' · ' + String(gesture.gesture || 'UNKNOWN') +
        ' · ' + String(gesture.status || 'UNKNOWN'),
        '   Duration: ' + (Number.isFinite(gesture.durationMs) ? gesture.durationMs + ' ms' : 'NOT_MEASURED') +
        ' | Distance: ' + (Number.isFinite(gesture.distancePx) ? gesture.distancePx + ' px' : 'NOT_MEASURED') +
        ' | Pointer ID: ' + String(gesture.pointerId ?? 'UNKNOWN')
      );
    }
    if (target.targetKind || target.region) {
      lines.push('   Target: ' + String(target.targetKind || 'UNKNOWN') + ' | Region: ' + String(target.region || 'UNKNOWN'));
    }
    for (const node of hierarchy) {
      const label = node.type === 'tool' ? 'Tool: ' : node.type === 'panel' ? 'Panel: ' :
        node.type === 'control' ? 'Inside: ' : node.type === 'action' ? 'Action: ' :
          node.type === 'object' ? 'Object target: ' : node.type === 'viewport' ? 'Viewport: ' : '';
      lines.push('   └─ ' + label + String(node.label || node.id || node.type || 'Unknown') +
        (node.targetKind ? ' [' + node.targetKind + ']' : ''));
    }
    if (control) {
      lines.push(
        '   Control event: ' + String(control.controlEvent || 'UNKNOWN') +
        ' | Status: ' + String(control.status || 'UNKNOWN') +
        (control.valueType ? ' | Value type: ' + String(control.valueType) : '')
      );
    }
    const cameraGesture = group.cameraGesture;
    const cameraUpdate = group.cameraUpdate;
    const firstFrame = group.firstRenderedFrame;
    if (cameraGesture || cameraUpdate || firstFrame) {
      const cameraTarget = cameraUpdate || firstFrame || cameraGesture || {};
      lines.push(
        '   Camera gesture: ' + String(cameraTarget.gesture || cameraGesture?.gesture || 'UNKNOWN') +
        ' | Viewport: ' + String(cameraTarget.viewport || cameraGesture?.viewport || 'UNKNOWN') +
        ' | Status: ' + String(cameraGesture?.status || (firstFrame ? 'RENDERED' : cameraUpdate ? 'CAMERA_UPDATED' : 'UNKNOWN'))
      );
      if (cameraUpdate) lines.push(
        '      Input to camera update: ' +
        (Number.isFinite(cameraUpdate.inputToCameraUpdateMs) ? cameraUpdate.inputToCameraUpdateMs + ' ms' : 'NOT_MEASURED')
      );
      if (firstFrame) lines.push(
        '      Input to first rendered frame: ' +
        (Number.isFinite(firstFrame.inputToFirstRenderedFrameMs) ? firstFrame.inputToFirstRenderedFrameMs + ' ms' : 'NOT_MEASURED') +
        ' | Camera update to rendered frame: ' +
        (Number.isFinite(firstFrame.cameraUpdateToFirstRenderedFrameMs) ? firstFrame.cameraUpdateToFirstRenderedFrameMs + ' ms' : 'NOT_MEASURED')
      );
      if (cameraUpdate?.controller || firstFrame?.controller) {
        lines.push('      Active controller: ' + String(cameraUpdate?.controller || firstFrame?.controller));
      }
    }
    if (group.result?.object) {
      const object = group.result.object;
      const timing = group.result.timing || {};
      const verification = group.result.verification || {};
      lines.push(
        '   Created object: ' + String(object.name || 'Unnamed object') +
          (object.id ? ' [ID: ' + String(object.id) + ']' : ''),
        '      Scene Tree: ' + String(verification.sceneTreeList || 'NOT_MEASURED') +
          ' | MainViewport: ' + String(verification.mainViewportScene || 'NOT_MEASURED'),
        '      Processing to scene update: ' +
          (Number.isFinite(timing.processingToSceneUpdateMs) ? timing.processingToSceneUpdateMs + ' ms' : 'NOT_MEASURED'),
        '      First rendered frame: ' + String(timing.firstRenderedFrame || 'NOT_MEASURED'),
        '   Creation result: ' + String(group.result.status || 'UNKNOWN')
      );
    }
    lines.push('');
  }
  return lines.length ? lines.join('\n').trimEnd() : 'NO DATA CAPTURED — no user interaction events were recorded.';
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
    ...severityLines(completeReport, /\b(ERROR|FATAL)\b/i)
  ])];
  const warningLines = [...new Set([
    ...formatRdsEntries(warnings).split('\n').filter(Boolean).filter(line => line !== 'No matching diagnostic entries were captured.'),
    ...severityLines(completeReport, /\b(WARN|WARNING)\b/i)
  ])];
  // Count diagnostic records, not formatted text lines: a single entry may contain
  // multiple detail/stack lines. Fall back to report severity lines for report-only tools.
  const errorCount = errors.length || severityLines(completeReport, /\b(ERROR|FATAL)\b/i).length;
  const warningCount = warnings.length || severityLines(completeReport, /\b(WARN|WARNING)\b/i).length;
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
    'Full report characters: ' + completeReport.length,
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
