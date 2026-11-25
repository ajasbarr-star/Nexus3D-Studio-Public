const ACTIONS = {
  'Runtime / Main Scene': { priority: 'CRITICAL', action: 'Restore runtime scene/renderer initialization, then rerun the Full Core Scan.' },
  'Viewport & Camera': { priority: 'HIGH', action: 'Inspect main, active, and IK camera registration and viewport switching.' },
  'Transform / Orbit Controls': { priority: 'HIGH', action: 'Inspect TransformControls and both orbit-controller references and their ownership.' },
  'Scene Tree Integrity': { priority: 'HIGH', action: 'Review duplicate editor IDs, non-finite transforms, and meshes missing geometry or material.' },
  'IK / Rig Inventory': { priority: 'MEDIUM', action: 'Confirm whether this project is expected to contain a rig; if so, inspect skinned meshes and bone hierarchy.' },
  'Modeling / Resource Inventory': { priority: 'LOW', action: 'Review renderer resource counts if they are unexpectedly unavailable or unstable.' },
  'Memory Leak Trend': { priority: 'LOW', action: 'Run another scan after repeated create/delete cycles; compare resource counts before diagnosing a leak.' },
  'Animation / Keyframe State': { priority: 'INFO', action: 'Inventory only; deep clip validation is outside this scan.' },
  'Project / Asset Integrity': { priority: 'INFO', action: 'Run a separate project/archive integrity check when saved project contents need validation.' },
  'Offline / Storage': { priority: 'MEDIUM', action: 'Inspect local storage availability if project persistence is expected to use it.' },
  'Device / WebGL Capability': { priority: 'MEDIUM', action: 'Review WebGL context availability and device limits if rendering is impaired.' },
  'Module API Contract': { priority: 'HIGH', action: 'Restore missing runtime entry points and rerun regression tests.' },
  'Regression Safety': { priority: 'INFO', action: 'No action; this check confirms the scan was read-only.' }
};
const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

export function buildRdsNoticeSection(checks = []) {
  const findings = checks.filter(item => item && item.status !== 'PASS').map(item => {
    const configured = ACTIONS[item.name] || { priority: item.status === 'ERROR' ? 'HIGH' : 'MEDIUM', action: 'Review the diagnostic evidence and run a focused test before changing code.' };
    const priority = item.status === 'ERROR' && configured.priority === 'INFO' ? 'HIGH' : configured.priority;
    return {
      name: String(item.name || 'Unknown check'), status: item.status, priority,
      evidence: String(item.detail || 'No diagnostic detail was provided.'),
      action: configured.action,
      result: item.status === 'ERROR' ? 'ERROR DETECTED · ROOT CAUSE NOT CONFIRMED' : 'REVIEW RECOMMENDED · ROOT CAUSE NOT CONFIRMED'
    };
  }).sort((a, b) => rank[a.priority] - rank[b.priority]);

  const lines = [
    'NOTICE · AUTOMATED FINDINGS & RECOMMENDED ACTIONS',
    findings.length ? `Findings requiring attention: ${findings.length}` : 'NO ACTION REQUIRED',
    findings.length ? 'Priority reflects the check category and status, not a confirmed root cause.' : 'No non-PASS findings were returned by the checks performed.',
    ''
  ];
  if (!findings.length) {
    lines.push('NOTICE: No confirmed issues detected in the checks performed. This does not certify systems outside the scan scope.');
  } else {
    findings.forEach((item, index) => lines.push(
      `${index + 1}. [${item.priority}] ${item.name} · ${item.status}`,
      `   Evidence: ${item.evidence}`,
      `   Recommended action: ${item.action}`,
      `   Status: ${item.result}`,
      ''
    ));
  }
  lines.push(
    'SAFETY: NOTICE is advisory and read-only. It does not modify or repair the project.',
    'CONFIDENCE: A warning is not proof of a defect. Verify root cause with focused reproduction, source inspection, or device logs.',
    'NEXT STEP: Address CRITICAL/HIGH findings first, rerun the relevant scan, and compare the new report.'
  );
  return lines.join('\n');
}
