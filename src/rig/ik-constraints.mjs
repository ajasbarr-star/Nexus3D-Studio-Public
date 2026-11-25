export function isIkBoneLocked(bone) {
  return Boolean(bone?.userData?.locked || bone?.userData?.objectManagerLocked);
}

/**
 * Receives a root-to-end bone path. If any bone is locked, the deepest
 * locked bone becomes the fixed IK anchor and only its descendants are solved.
 * Without a lock, preserve the existing chainLength behavior.
 */
export function getIkSolvePath(rootToEndPath, chainLength = 3) {
  const path = Array.isArray(rootToEndPath) ? rootToEndPath : [];
  if (!path.length) return [];

  let lockedAnchorIndex = -1;
  for (let index = 0; index < path.length; index += 1) {
    if (isIkBoneLocked(path[index])) lockedAnchorIndex = index;
  }
  if (lockedAnchorIndex >= 0) return path.slice(lockedAnchorIndex);

  const requestedBones = Number.isFinite(chainLength)
    ? Math.max(1, Math.min(Math.floor(chainLength) + 1, path.length))
    : path.length;
  return path.slice(-requestedBones);
}
