const TAP_DISTANCE_PX = 8;
const DOUBLE_TAP_WINDOW_MS = 320;
const DOUBLE_TAP_DISTANCE_PX = 36;
const WHEEL_GROUP_WINDOW_MS = 180;

function finite(value) {
  return Number.isFinite(value) ? value : 0;
}

export function classifyCameraPointer(event, activePointerCount = 1) {
  if (activePointerCount > 1) return 'PINCH';
  if (event?.pointerType === 'touch') return 'ORBIT';
  if (event?.button === 2 || event?.shiftKey || event?.ctrlKey) return 'PAN';
  if (event?.button === 1) return 'ZOOM';
  return 'ORBIT';
}

export function createCameraInteractionTracker({
  emit = () => {},
  now = () => 0,
  createId = () => 'camera-interaction',
  resolveInteractionId = () => null,
  enabled = () => true,
  getCameraState = () => null,
} = {}) {
  const pointers = new Map();
  let session = null;
  let lastTouchTap = null;
  let lastWheelAt = -Infinity;

  function publish(event, extra = {}) {
    emit({ interactionId: session?.id || null, event, ...extra });
  }

  function readCameraState(viewport) {
    try {
      const state = getCameraState(viewport);
      return state ? JSON.parse(JSON.stringify(state)) : null;
    } catch {
      return null;
    }
  }

  function vectorDistance(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return null;
    const values = [0, 1, 2].map(index => Number(b[index]) - Number(a[index]));
    if (!values.every(Number.isFinite)) return null;
    return Number(Math.hypot(...values).toFixed(4));
  }

  function quaternionDeltaDegrees(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 4 || b.length < 4) return null;
    const av = a.slice(0, 4).map(Number), bv = b.slice(0, 4).map(Number);
    if (![...av, ...bv].every(Number.isFinite)) return null;
    const al = Math.hypot(...av), bl = Math.hypot(...bv);
    if (!al || !bl) return null;
    const dot = Math.min(1, Math.max(-1, Math.abs(av.reduce((sum, value, index) => sum + value * bv[index], 0) / (al * bl))));
    return Number((2 * Math.acos(dot) * 180 / Math.PI).toFixed(4));
  }

  function start(gesture, pointerType, viewport, inputType = 'pointer', pointerId = null) {
    session = {
      id: (pointerId !== null && pointerId !== undefined ? resolveInteractionId(pointerId) : null) || createId(),
      gesture,
      pointerType: pointerType || 'unknown',
      viewport: viewport || 'UNKNOWN_VIEWPORT',
      inputType,
      startedAt: now(),
      lastInputAt: now(),
      cameraUpdateAt: null,
      firstRenderedAt: null,
      controller: null,
      endedAt: null,
      changeCount: 0,
      multiTouch: false,
      framesAfterEnd: 0,
      completionEmitted: false,
      initialCameraState: readCameraState(viewport),
      lastFrameAt: null,
      frameTimes: [],
    };
    return session;
  }

  function ensurePointerSession(event, viewport) {
    if (session?.endedAt !== null && session?.endedAt !== undefined && session.cameraUpdateAt === null) {
      completeWithoutCameraUpdate();
    }
    if (!session || session.firstRenderedAt !== null || session.endedAt !== null) {
      return start(classifyCameraPointer(event, pointers.size), event?.pointerType, viewport, 'pointer', event?.pointerId ?? 0);
    }
    if (pointers.size > 1) session.gesture = 'PINCH';
    session.lastInputAt = now();
    return session;
  }

  function onPointerDown(event, viewport) {
    if (!enabled()) return null;
    const point = { startX: finite(event?.clientX), startY: finite(event?.clientY), x: finite(event?.clientX), y: finite(event?.clientY), pointerType: event?.pointerType || 'unknown' };
    pointers.set(event?.pointerId ?? 0, point);
    const current = ensurePointerSession(event, viewport);
    if (pointers.size > 1) {
      current.gesture = 'PINCH';
      current.multiTouch = true;
    }
    current.pointerType = point.pointerType;
    return current.id;
  }

  function onPointerMove(event) {
    if (!enabled()) return;
    const point = pointers.get(event?.pointerId ?? 0);
    if (!point) return;
    point.x = finite(event?.clientX);
    point.y = finite(event?.clientY);
    if (session) session.lastInputAt = now();
  }

  function onPointerUp(event, status = 'completed') {
    if (!enabled()) { pointers.delete(event?.pointerId ?? 0); if (!pointers.size) session = null; return null; }
    const pointerId = event?.pointerId ?? 0;
    const point = pointers.get(pointerId);
    if (!point) return null;
    pointers.delete(pointerId);
    if (!session) return null;
    const endedAt = now();
    const distancePx = Math.round(Math.hypot(finite(event?.clientX) - point.startX, finite(event?.clientY) - point.startY));
    const pointerDurationMs = Math.max(0, endedAt - session.startedAt);
    if (!session.multiTouch && session.pointerType === 'touch' && pointers.size === 0 &&
        distancePx < TAP_DISTANCE_PX && pointerDurationMs < 550 && status !== 'cancelled') {
      const tap = { at: endedAt, x: finite(event?.clientX), y: finite(event?.clientY) };
      if (lastTouchTap && endedAt - lastTouchTap.at <= DOUBLE_TAP_WINDOW_MS &&
          Math.hypot(tap.x - lastTouchTap.x, tap.y - lastTouchTap.y) <= DOUBLE_TAP_DISTANCE_PX) {
        session.gesture = 'DOUBLE_TAP';
        lastTouchTap = null;
      } else {
        lastTouchTap = tap;
      }
    }
    if (session.pointerType === 'touch' &&
        (session.multiTouch || distancePx >= TAP_DISTANCE_PX || pointerDurationMs >= 550 || status === 'cancelled')) {
      lastTouchTap = null;
    }
    session.lastInputAt = endedAt;
    if (pointers.size === 0) {
      session.endedAt = endedAt;
      if (status === 'cancelled') {
        completeGesture('CANCELLED');
        session = null;
      } else if (session.cameraUpdateAt !== null) {
        completeGesture('CAMERA_UPDATED');
        if (session.firstRenderedAt !== null) session = null;
      }
    }
    return true;
  }

  function completeGesture(status) {
    if (!session || session.completionEmitted) return;
    session.completionEmitted = true;
    const frameTimes = session.frameTimes || [];
    const frameAverageMs = frameTimes.length ? frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length : null;
    const frameVariance = frameTimes.length && frameAverageMs !== null
      ? frameTimes.reduce((sum, value) => sum + Math.pow(value - frameAverageMs, 2), 0) / frameTimes.length : null;
    const frameMaxMs = frameTimes.length ? Math.max(...frameTimes) : null;
    const droppedFrameEstimate60Hz = frameTimes.reduce((sum, value) => sum + Math.max(0, Math.round(value / 16.67) - 1), 0);
    publish('CAMERA_GESTURE_COMPLETE', {
      gesture: session.gesture,
      pointerType: session.pointerType,
      viewport: session.viewport,
      status,
      durationMs: Number(Math.max(0, (session.endedAt ?? now()) - session.startedAt).toFixed(2)),
      inputType: session.inputType,
      frameMetricStatus: frameTimes.length ? 'MEASURED' : 'NOT_MEASURED',
      frameTimeSamples: frameTimes.length,
      frameTimeAverageMs: frameAverageMs === null ? null : Number(frameAverageMs.toFixed(2)),
      frameTimeMaxMs: frameMaxMs === null ? null : Number(frameMaxMs.toFixed(2)),
      frameTimeJitterStdDevMs: frameVariance === null ? null : Number(Math.sqrt(frameVariance).toFixed(2)),
      droppedFrameEstimate60Hz: frameTimes.length ? droppedFrameEstimate60Hz : null,
      droppedFrameEstimateBasis: '60Hz target interval 16.67ms; estimate only',
    });
  }

  function completeWithoutCameraUpdate() {
    if (!session || session.cameraUpdateAt !== null) return;
    completeGesture('NO_CAMERA_UPDATE');
    session = null;
  }

  function onWheel(event, viewport) {
    if (!enabled()) return null;
    const at = now();
    if (session?.endedAt !== null && session?.endedAt !== undefined && session.cameraUpdateAt === null) {
      completeWithoutCameraUpdate();
    }
    if (!session || session.firstRenderedAt !== null || session.inputType !== 'wheel' || at - lastWheelAt > WHEEL_GROUP_WINDOW_MS) {
      start('ZOOM', 'wheel', viewport, 'wheel');
    }
    lastWheelAt = at;
    session.lastInputAt = at;
    return session.id;
  }

  function cameraChanged(controller, viewport, isActive = true) {
    if (!enabled() || !isActive || !session || session.viewport !== viewport || session.cameraUpdateAt !== null) return null;
    const at = now();
    session.cameraUpdateAt = at;
    session.controller = controller || 'OrbitControls';
    session.changeCount += 1;
    const currentCameraState = readCameraState(viewport);
    const initialCameraState = session.initialCameraState;
    const movement = {
      cameraPositionDeltaUnits: vectorDistance(initialCameraState?.position, currentCameraState?.position),
      cameraRotationDeltaDegrees: quaternionDeltaDegrees(initialCameraState?.quaternion, currentCameraState?.quaternion),
      cameraTargetDeltaUnits: vectorDistance(initialCameraState?.target, currentCameraState?.target),
      movementAccuracy: 'NOT_MEASURED — no expected camera path or target was supplied',
    };
    publish('CAMERA_UPDATE', {
      gesture: session.gesture,
      viewport: session.viewport,
      controller: session.controller,
      status: 'MEASURED',
      inputToCameraUpdateMs: Number(Math.max(0, at - session.startedAt).toFixed(2)),
      changeCount: session.changeCount,
      ...movement,
    });
    return session.id;
  }

  function markRendered(viewport) {
    if (!enabled() || !session || session.viewport !== viewport) return null;
    const at = now();
    if (session.cameraUpdateAt === null) {
      if (session.endedAt !== null || session.inputType === 'wheel') {
        session.framesAfterEnd += 1;
        if (session.framesAfterEnd >= 2) completeWithoutCameraUpdate();
      }
      return null;
    }
    if (session.firstRenderedAt !== null) {
      if (session.lastFrameAt !== null) {
        const frameTimeMs = Math.max(0, at - session.lastFrameAt);
        if (frameTimeMs > 0) session.frameTimes.push(Number(frameTimeMs.toFixed(2)));
      }
      session.lastFrameAt = at;
      return null;
    }
    session.firstRenderedAt = at;
    session.lastFrameAt = at;
    publish('CAMERA_FIRST_RENDERED_FRAME', {
      gesture: session.gesture,
      viewport: session.viewport,
      controller: session.controller,
      status: 'MEASURED',
      inputToFirstRenderedFrameMs: Number(Math.max(0, at - session.startedAt).toFixed(2)),
      cameraUpdateToFirstRenderedFrameMs: Number(Math.max(0, at - session.cameraUpdateAt).toFixed(2)),
    });
    const id = session.id;
    if (session.inputType === 'wheel') {
      session.endedAt = at;
      completeGesture('CAMERA_UPDATED');
      session = null;
    } else if (pointers.size === 0 && session.endedAt !== null) {
      completeGesture('CAMERA_UPDATED');
      session = null;
    }
    return id;
  }

  function attach({ element, controls = [], getViewport = () => 'UNKNOWN_VIEWPORT' } = {}) {
    if (!element?.addEventListener) return () => {};
    const down = event => onPointerDown(event, getViewport());
    const move = event => onPointerMove(event);
    const up = event => onPointerUp(event);
    const cancel = event => onPointerUp(event, 'cancelled');
    const wheel = event => onWheel(event, getViewport());
    const controlListeners = controls.map(item => {
      const listener = () => cameraChanged(item.name, getViewport(), item.isActive ? item.isActive() : true);
      item.controls?.addEventListener?.('change', listener);
      return () => item.controls?.removeEventListener?.('change', listener);
    });
    element.addEventListener('pointerdown', down, true);
    element.addEventListener('pointermove', move, true);
    element.addEventListener('pointerup', up, true);
    element.addEventListener('pointercancel', cancel, true);
    element.addEventListener('wheel', wheel, { capture: true, passive: true });
    return () => {
      element.removeEventListener('pointerdown', down, true);
      element.removeEventListener('pointermove', move, true);
      element.removeEventListener('pointerup', up, true);
      element.removeEventListener('pointercancel', cancel, true);
      element.removeEventListener('wheel', wheel, true);
      controlListeners.forEach(remove => remove());
      pointers.clear();
      session = null;
    };
  }

  function reset() {
    pointers.clear();
    session = null;
    lastTouchTap = null;
    lastWheelAt = -Infinity;
  }

  return { onPointerDown, onPointerMove, onPointerUp, onWheel, cameraChanged, markRendered, attach, reset };
}
