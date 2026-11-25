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
} = {}) {
  const pointers = new Map();
  let session = null;
  let lastTouchTap = null;
  let lastWheelAt = -Infinity;

  function publish(event, extra = {}) {
    emit({ interactionId: session?.id || null, event, ...extra });
  }

  function start(gesture, pointerType, viewport, inputType = 'pointer') {
    session = {
      id: createId(),
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
    };
    return session;
  }

  function ensurePointerSession(event, viewport) {
    if (!session || session.firstRenderedAt !== null || session.endedAt !== null) {
      return start(classifyCameraPointer(event, pointers.size), event?.pointerType, viewport);
    }
    if (pointers.size > 1) session.gesture = 'PINCH';
    session.lastInputAt = now();
    return session;
  }

  function onPointerDown(event, viewport) {
    const point = { x: finite(event?.clientX), y: finite(event?.clientY), pointerType: event?.pointerType || 'unknown' };
    pointers.set(event?.pointerId ?? 0, point);
    const current = ensurePointerSession(event, viewport);
    if (pointers.size > 1) current.gesture = 'PINCH';
    current.pointerType = point.pointerType;
    return current.id;
  }

  function onPointerMove(event) {
    const point = pointers.get(event?.pointerId ?? 0);
    if (!point) return;
    point.x = finite(event?.clientX);
    point.y = finite(event?.clientY);
    if (session) session.lastInputAt = now();
  }

  function onPointerUp(event, status = 'completed') {
    const pointerId = event?.pointerId ?? 0;
    const point = pointers.get(pointerId);
    if (!point) return null;
    pointers.delete(pointerId);
    if (!session) return null;
    const endedAt = now();
    const distancePx = Math.round(Math.hypot(finite(event?.clientX) - point.x, finite(event?.clientY) - point.y));
    if (session.pointerType === 'touch' && pointers.size === 0 && distancePx < TAP_DISTANCE_PX && status !== 'cancelled') {
      const tap = { at: endedAt, x: finite(event?.clientX), y: finite(event?.clientY) };
      if (lastTouchTap && endedAt - lastTouchTap.at <= DOUBLE_TAP_WINDOW_MS &&
          Math.hypot(tap.x - lastTouchTap.x, tap.y - lastTouchTap.y) <= DOUBLE_TAP_DISTANCE_PX) {
        session.gesture = 'DOUBLE_TAP';
        lastTouchTap = null;
      } else {
        lastTouchTap = tap;
      }
    }
    session.lastInputAt = endedAt;
    if (pointers.size === 0) {
      session.endedAt = endedAt;
      publish('CAMERA_GESTURE_COMPLETE', {
        gesture: session.gesture,
        pointerType: session.pointerType,
        viewport: session.viewport,
        status: status === 'cancelled' ? 'CANCELLED' : session.cameraUpdateAt === null ? 'NO_CAMERA_UPDATE' : 'INPUT_RECEIVED',
        durationMs: Number(Math.max(0, endedAt - session.startedAt).toFixed(2)),
        inputType: session.inputType,
      });
      if (session.cameraUpdateAt === null) session = null;
    } else if (pointers.size === 1 && session.gesture === 'PINCH') {
      session.gesture = 'ORBIT';
    }
    return true;
  }

  function onWheel(event, viewport) {
    const at = now();
    if (!session || session.firstRenderedAt !== null || session.inputType !== 'wheel' || at - lastWheelAt > WHEEL_GROUP_WINDOW_MS) {
      start('ZOOM', 'wheel', viewport, 'wheel');
    }
    lastWheelAt = at;
    session.lastInputAt = at;
    return session.id;
  }

  function cameraChanged(controller, viewport, isActive = true) {
    if (!isActive || !session || session.viewport !== viewport || session.cameraUpdateAt !== null) return null;
    const at = now();
    session.cameraUpdateAt = at;
    session.controller = controller || 'OrbitControls';
    session.changeCount += 1;
    publish('CAMERA_UPDATE', {
      gesture: session.gesture,
      viewport: session.viewport,
      controller: session.controller,
      status: 'MEASURED',
      inputToCameraUpdateMs: Number(Math.max(0, at - session.startedAt).toFixed(2)),
      changeCount: session.changeCount,
    });
    return session.id;
  }

  function markRendered(viewport) {
    if (!session || session.viewport !== viewport || session.cameraUpdateAt === null || session.firstRenderedAt !== null) return null;
    const at = now();
    session.firstRenderedAt = at;
    publish('CAMERA_FIRST_RENDERED_FRAME', {
      gesture: session.gesture,
      viewport: session.viewport,
      controller: session.controller,
      status: 'MEASURED',
      inputToFirstRenderedFrameMs: Number(Math.max(0, at - session.startedAt).toFixed(2)),
      cameraUpdateToFirstRenderedFrameMs: Number(Math.max(0, at - session.cameraUpdateAt).toFixed(2)),
    });
    const id = session.id;
    if (pointers.size === 0) session = null;
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

  return { onPointerDown, onPointerMove, onPointerUp, onWheel, cameraChanged, markRendered, attach };
}
