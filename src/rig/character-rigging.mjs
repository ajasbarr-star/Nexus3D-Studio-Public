const PART_RULES = [
  { part: 'head', tokens: ['head', 'skull', 'face'] },
  { part: 'neck', tokens: ['neck'] },
  { part: 'chest', tokens: ['chest', 'torso', 'upperbody', 'ribcage'] },
  { part: 'pelvis', tokens: ['pelvis', 'hips', 'hip', 'waist'] },
  { part: 'shoulder', tokens: ['shoulder', 'clavicle'] },
  { part: 'upperArm', tokens: ['upperarm', 'bicep', 'armupper'] },
  { part: 'forearm', tokens: ['forearm', 'lowerarm', 'elbow', 'ulna'] },
  { part: 'hand', tokens: ['hand', 'palm', 'wrist'] },
  { part: 'thigh', tokens: ['thigh', 'upperleg', 'legupper'] },
  { part: 'shin', tokens: ['shin', 'calf', 'lowerleg', 'kneelower'] },
  { part: 'foot', tokens: ['foot', 'feet', 'ankle', 'toe'] }
];

const BONE_ALIASES = {
  head: ['head'],
  neck: ['neck'],
  chest: ['chest', 'spine', 'upperchest'],
  pelvis: ['pelvis', 'hips', 'hip', 'root'],
  shoulder: ['shoulder', 'clavicle'],
  upperArm: ['upperarm', 'arm', 'bicep'],
  forearm: ['forearm', 'lowerarm', 'elbow'],
  hand: ['hand', 'wrist'],
  thigh: ['thigh', 'upperleg'],
  shin: ['shin', 'calf', 'lowerleg'],
  foot: ['foot', 'ankle', 'toe']
};

export function normalizeRigName(value) {
  return String(value || '').toLowerCase().replace(/left/g, 'l').replace(/right/g, 'r')
    .replace(/[^a-z0-9]/g, '');
}

export function inferCharacterPart(name) {
  const normalized = normalizeRigName(name);
  const side = /(?:\.l|_l|left|\bl$)/i.test(String(name || '')) || /(?:^|[^a-z])l(?:$|[^a-z])/i.test(String(name || ''))
    ? 'L'
    : /(?:\.r|_r|right|\br$)/i.test(String(name || '')) || /(?:^|[^a-z])r(?:$|[^a-z])/i.test(String(name || ''))
      ? 'R' : null;
  for (const rule of PART_RULES) {
    if (rule.tokens.some(token => normalized.includes(token))) return { part: rule.part, side, source: 'name' };
  }
  return { part: null, side, source: 'unknown' };
}

export function isCharacterMeshCandidate(mesh) {
  return Boolean(mesh && mesh.isMesh !== false && mesh.geometry &&
    (mesh.geometry.getAttribute ? mesh.geometry.getAttribute('position') : mesh.geometry.attributes?.position) &&
    !mesh.userData?.nexusJointVisual && !mesh.userData?.rigControlMarker &&
    !mesh.userData?.nexusRigHelper && mesh.userData?.kind !== 'IK Target' &&
    mesh.userData?.kind !== 'IK Pole');
}

function readVector(value) {
  if (Array.isArray(value)) return value.slice(0, 3).map(Number);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) return [value.x, value.y, value.z];
  return [0, 0, 0];
}

function bonePart(name) {
  const info = inferCharacterPart(name);
  if (info.part) return info;
  const normalized = normalizeRigName(name);
  for (const [part, aliases] of Object.entries(BONE_ALIASES)) {
    if (aliases.some(alias => normalized.includes(alias))) return { part, side: info.side, source: 'bone-name' };
  }
  return { part: null, side: info.side, source: 'unknown' };
}

export function chooseBoneForMesh(mesh, bones, options = {}) {
  const meshInfo = inferCharacterPart(mesh?.name);
  const candidates = (bones || []).map((bone, index) => ({
    bone, index, info: bonePart(bone?.name),
    position: readVector(bone?.worldPosition || bone?.position)
  }));
  if (!candidates.length) return { bone: null, confidence: 0, reason: 'no-bones', needsReview: true, part: meshInfo.part };
  const named = candidates.filter(item => meshInfo.part && item.info.part === meshInfo.part &&
    (!meshInfo.side || !item.info.side || meshInfo.side === item.info.side));
  if (named.length) {
    const meshPosition = readVector(mesh?.worldPosition || mesh?.center);
    named.sort((a, b) => {
      const da = a.position.reduce((sum, value, i) => sum + (value - meshPosition[i]) ** 2, 0);
      const db = b.position.reduce((sum, value, i) => sum + (value - meshPosition[i]) ** 2, 0);
      return da - db;
    });
    return { bone: named[0].bone, confidence: meshInfo.side && named[0].info.side === meshInfo.side ? 0.98 : 0.9,
      reason: 'semantic-name-match', needsReview: false, part: meshInfo.part, side: meshInfo.side };
  }
  const meshPosition = readVector(mesh?.worldPosition || mesh?.center);
  const meshX = meshPosition[0];
  const sided = candidates.filter(item => !meshInfo.side || !item.info.side || item.info.side === meshInfo.side);
  const pool = sided.length ? sided : candidates;
  pool.sort((a, b) => {
    const score = item => {
      const distance = item.position.reduce((sum, value, i) => sum + (value - meshPosition[i]) ** 2, 0);
      const sidePenalty = meshInfo.side && item.info.side && meshInfo.side !== item.info.side ? 1000 : 0;
      const semanticPenalty = meshInfo.part && item.info.part && meshInfo.part !== item.info.part ? 100 : 0;
      const xPenalty = !meshInfo.side && Math.sign(item.position[0]) !== Math.sign(meshX) ? 0.15 : 0;
      return distance + sidePenalty + semanticPenalty + xPenalty;
    };
    return score(a) - score(b);
  });
  const chosen = pool[0];
  const distance = Math.sqrt(chosen.position.reduce((sum, value, i) => sum + (value - meshPosition[i]) ** 2, 0));
  const confidence = Math.max(0.2, Math.min(0.72, 0.72 - distance * 0.08));
  return { bone: chosen.bone, confidence, reason: 'spatial-fallback', needsReview: true, part: meshInfo.part, side: meshInfo.side };
}

export function buildCharacterMeshAssignments(meshes, bones, options = {}) {
  const assignments = [];
  for (const mesh of meshes || []) {
    if (!isCharacterMeshCandidate(mesh)) continue;
    const result = chooseBoneForMesh(mesh, bones, options);
    assignments.push({ mesh, ...result, mode: options.mode === 'skinning' ? 'skinning' : 'rigid' });
  }
  return assignments;
}

export function summarizeCharacterAssignments(assignments) {
  return (assignments || []).reduce((summary, assignment) => {
    if (!assignment.bone) summary.unassigned += 1;
    else if (assignment.needsReview) summary.review += 1;
    else summary.ready += 1;
    if (assignment.mode === 'skinning') summary.skinning += 1;
    else summary.rigid += 1;
    return summary;
  }, { ready: 0, review: 0, unassigned: 0, rigid: 0, skinning: 0 });
}
