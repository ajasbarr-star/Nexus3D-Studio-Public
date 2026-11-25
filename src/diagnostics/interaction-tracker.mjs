const MAX_LABEL = 72;
const MAX_SAMPLES = 8;

function clean(value, limit = MAX_LABEL) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function nodeLabel(node) {
  if (!node || node.nodeType !== 1) return '';
  const element = node;
  const control = element.closest?.('button,[role="button"],[role="menuitem"],input,select,textarea,[aria-label],[title]') || element;
  return clean(
    control.getAttribute?.('aria-label') ||
    control.getAttribute?.('data-rit-label') ||
    control.getAttribute?.('title') ||
    control.getAttribute?.('data-tool') ||
    control.getAttribute?.('data-object-name') ||
    control.textContent
  );
}

function closestValue(target, selector, attribute) {
  const node = target?.closest?.(selector);
  return node ? clean(node.getAttribute(attribute)) : '';
}

export function describeInteractionTarget(target) {
  const tool = closestValue(target, '[data-rit-tool]', 'data-rit-tool');
  const panel = closestValue(target, '[data-rit-panel]', 'data-rit-panel');
  const action = closestValue(target, '[data-rit-action]', 'data-rit-action');
  const objectId = closestValue(target, '[data-object-id], [data-shape-id]', 'data-object-id') ||
    closestValue(target, '[data-shape-id]', 'data-shape-id');
  const chain = [];
  if (tool) chain.push({ type: 'tool', label: tool });
  if (panel) chain.push({ type: 'panel', label: panel });
  const label = nodeLabel(target);
  if (label) chain.push({ type: 'control', label });
  if (action) chain.push({ type: 'action', label: action });
  if (objectId) chain.push({ type: 'object', id: objectId });
  const viewport = target?.closest?.('[data-rit-viewport], canvas, .main-viewport, .ik-viewport');
  const region = viewport ? clean(viewport.getAttribute?.('data-rit-viewport') || viewport.className?.baseVal || viewport.className || 'VIEWPORT') : 'UI';
  return { tool, panel, action, objectId, label, region, hierarchy: chain };
}

export function createInteractionTracker({ emit = () => {}, now = () => 0, createId = () => 'interaction' } = {}) {
  const activePointers = new Map();
  const recentByPointer = new Map();
  let lastInteraction = null;

  function begin(event) {
    const target = describeInteractionTarget(event?.target);
    const active = {
      id: createId(),
      pointerId: Number.isFinite(event?.pointerId) ? event.pointerId : 0,
      pointerType: clean(event?.pointerType || 'unknown'),
      startedAt: now(),
      startX: Number(event?.clientX) || 0,
      startY: Number(event?.clientY) || 0,
      lastX: Number(event?.clientX) || 0,
      lastY: Number(event?.clientY) || 0,
      distance: 0,
      moves: 0,
      samples: [],
      target,
      multiTouch: activePointers.size > 0,
    };
    if (active.multiTouch) for (const pointer of activePointers.values()) pointer.multiTouch = true;
    activePointers.set(active.pointerId, active);
    return active.id;
  }

  function move(event) {
    const active = activePointers.get(event?.pointerId);
    if (!active) return;
    const x = Number(event.clientX) || 0;
    const y = Number(event.clientY) || 0;
    const dx = x - active.lastX;
    const dy = y - active.lastY;
    active.distance += Math.hypot(dx, dy);
    active.moves += 1;
    active.lastX = x;
    active.lastY = y;
    if (active.samples.length < MAX_SAMPLES && (active.moves === 1 || active.moves % 4 === 0)) {
      active.samples.push({ x: Math.round(x), y: Math.round(y) });
    }
  }

  function finish(event, status = 'completed') {
    const current = activePointers.get(event?.pointerId);
    if (!current) return null;
    activePointers.delete(current.pointerId);
    const endedAt = now();
    const durationMs = Math.max(0, endedAt - current.startedAt);
    const distancePx = Math.round(current.distance);
    const gesture = current.multiTouch ? 'MULTI_TOUCH' : distancePx < 8 && durationMs < 550 ? 'TAP' :
      distancePx < 8 ? 'LONG_PRESS' : durationMs < 450 ? 'SWIPE' : 'DRAG';
    const result = {
      interactionId: current.id,
      event: 'GESTURE_COMPLETE',
      gesture,
      status: status === 'cancelled' ? 'CANCELLED' : 'INPUT_RECEIVED',
      pointerType: current.pointerType,
      durationMs: Number(durationMs.toFixed(2)),
      distancePx,
      moveSamples: current.moves,
      sampledPoints: current.samples,
      start: { x: Math.round(current.startX), y: Math.round(current.startY) },
      end: { x: Math.round(current.lastX), y: Math.round(current.lastY) },
      target: current.target,
      monotonicStartMs: current.startedAt,
      monotonicEndMs: endedAt,
    };
    recentByPointer.set(current.pointerId, current.id);
    lastInteraction = { id: current.id, at: endedAt };
    emit(result);
    return result;
  }

  function action(event) {
    const target = describeInteractionTarget(event?.target);
    const pointerId = Number.isFinite(event?.pointerId) ? event.pointerId : 0;
    const at = now();
    const correlatedId = recentByPointer.get(pointerId) || (lastInteraction && at - lastInteraction.at <= 1500 ? lastInteraction.id : null);
    const interactionId = correlatedId || createId();
    recentByPointer.delete(pointerId);
    lastInteraction = { id: interactionId, at };
    emit({
      interactionId,
      event: event?.type === 'change' || event?.type === 'input' ? 'CONTROL_VALUE' : 'CONTROL_ACTIVATION',
      controlEvent: clean(event?.type || 'click'),
      valueType: event?.target?.type ? clean(event.target.type) : undefined,
      target,
      status: 'INPUT_RECEIVED',
      monotonicAtMs: at,
    });
  }

  function consumeLastInteractionId(maxAgeMs = 1500) {
    if (!lastInteraction) return null;
    const at = now();
    if (at - lastInteraction.at > maxAgeMs) { lastInteraction = null; return null; }
    const id = lastInteraction.id;
    lastInteraction = null;
    return id;
  }

  function attach(documentLike) {
    if (!documentLike?.addEventListener) return () => {};
    const onDown = event => begin(event);
    const onMove = event => move(event);
    const onUp = event => finish(event);
    const onCancel = event => finish(event, 'cancelled');
    const onAction = event => action(event);
    documentLike.addEventListener('pointerdown', onDown, true);
    documentLike.addEventListener('pointermove', onMove, true);
    documentLike.addEventListener('pointerup', onUp, true);
    documentLike.addEventListener('pointercancel', onCancel, true);
    documentLike.addEventListener('click', onAction, true);
    documentLike.addEventListener('change', onAction, true);
    documentLike.addEventListener('input', onAction, true);
    return () => {
      documentLike.removeEventListener('pointerdown', onDown, true);
      documentLike.removeEventListener('pointermove', onMove, true);
      documentLike.removeEventListener('pointerup', onUp, true);
      documentLike.removeEventListener('pointercancel', onCancel, true);
      documentLike.removeEventListener('click', onAction, true);
      documentLike.removeEventListener('change', onAction, true);
      documentLike.removeEventListener('input', onAction, true);
      activePointers.clear();
    };
  }

  return { begin, move, finish, action, attach, consumeLastInteractionId };
}
